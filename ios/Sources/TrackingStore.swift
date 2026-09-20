import Foundation
import CoreLocation
import UIKit

/// How position uploads are paced.
enum SendMode: String { case time, distance }

/// User-facing preset that maps to a sendMode + value. `.custom` = manual.
enum SendProfile: String { case balanced, saver, precision, custom }

/// Orchestrates a live-sharing session: creates it on the backend, then pings
/// the latest GPS fix at the chosen interval. Location updates arrive
/// continuously (foreground + background); we upload only once per interval.
@MainActor
final class TrackingStore: ObservableObject {
    @Published var isSharing = false
    /// Armed-but-idle: the session exists and counts down, but we keep location
    /// in ultra-low-power standby and upload nothing until ~the planned start.
    @Published var isStandby = false
    @Published var sessionToken: String?
    /// User-facing preset (default = the recommended balanced profile).
    @Published var profile: SendProfile = .balanced
    @Published var sendMode: SendMode = .distance {
        didSet { applyLocationConfig() }
    }
    @Published var intervalSeconds: Double = 15 {
        didSet { applyLocationConfig() }
    }
    /// Distance-mode threshold in metres (send every X m moved).
    @Published var distanceMeters: Double = 100 {
        didSet { applyLocationConfig() }
    }
    @Published var lastSentAt: Date?
    @Published var pingCount = 0
    @Published var lastError: String?
    /**
     Otra baliza de la misma cuenta está viva ahora mismo y hay que preguntar
     antes de quitársela.

     El servidor solo admite UNA sesión por cuenta y cierra la anterior al crear
     otra, sin avisar. Con dos móviles —cosa normal: uno de reserva, el del
     acompañante, el viejo con más batería— eso significaba que arrancar aquí
     dejaba la otra muda sin que nadie lo dijera, y encima la otra seguía
     enseñando "armado" porque una baliza armada no habla con el servidor.
     */
    /**
     Ha llegado al final del recorrido.

     No para la baliza sola —hay quien sigue andando hasta el coche, y cortarle
     la traza sería decidir por él— pero lo dice y ofrece el botón, que es lo que
     se busca al cruzar el arco.
     */
    @Published var atFinish = false

    /// El recorrido de esta salida y el último kilómetro conocido sobre él.
    private var routeGeometry: PlanGeometry.Route?
    private var lastRouteKm: Double?

    @Published var takeoverAsk: TrackSessionSummary?
    /**
     La nota que queda en el móvil al que le quitaron la baliza.

     No es un aviso de los que se van solos: quien coge este móvil dos horas más
     tarde se encuentra una baliza apagada y merece saber por qué sin tener que
     deducirlo. Sobrevive a cerrar la app —se guarda en disco— y solo se va
     cuando se lee y se descarta.
     */
    @Published var takeoverNote: String? = UserDefaults.standard.string(forKey: "takeoverNote") {
        didSet {
            if let takeoverNote { UserDefaults.standard.set(takeoverNote, forKey: "takeoverNote") }
            else { UserDefaults.standard.removeObject(forKey: "takeoverNote") }
        }
    }
    @Published var lastLocation: CLLocation?
    @Published var authStatus: CLAuthorizationStatus = .notDetermined
    @Published var plans: [PlanSummary] = []
    /// Name of the route linked to the CURRENT live/armed session (persists while
    /// sharing, incl. continued sessions where selectedPlanId isn't known).
    @Published var activePlanName: String? = nil
    /// El NOMBRE que se le puso a esta salida. Vive aquí y no en la vista porque
    /// la vista muere con el proceso: el nombre lo escribe quien sale, es lo que
    /// ve quien abre el enlace, y perderlo al reabrir la app —que es lo que
    /// pasaba— deja la salida llamándose "Sin nombre" a mitad de carrera.
    /// Espejo de `Estado.titulo` en Android, que sí lo guardaba.
    @Published var activeTitle: String? = nil
    @Published var selectedPlanId: String? = nil {
        didSet { applyPlanStart() }
    }
    /// Movement type of the beacon (nil = "Automático" → the viewer infers it from
    /// the trail). Chosen before/while sharing; drives the viewer's speed unit,
    /// the activity icon and the impossible-speed filter.
    @Published var activity: BeaconActivity? = nil
    /// Planned departure time = reference for paces/predictions. Defaults to the
    /// selected plan's start (so predictions follow the plan), else now.
    @Published var startAt: Date = Date()
    /// Si la salida la fijó alguien (la ruta, el evento o la mano). Sin tocar,
    /// la salida es EL MOMENTO DE PULSAR "Empezar", no el de abrir la pantalla.
    /// Solo lo cambia el store: la vista pasa por `setStartAt` / `clearStartAt`.
    @Published private(set) var startAtTouched = false

    /// Grabando en local y todavía sin alta en el servidor: hay traza, pero aún
    /// no hay enlace que compartir. Ver `intentaAlta`.
    @Published private(set) var pendienteDeAlta = false

    /// Clave provisional de la sesión mientras el servidor no ha contestado.
    ///
    /// Sin ella, lo grabado sin cobertura vivía SOLO en memoria: todos los
    /// guardados se salían por `sessionToken == nil`, así que un cierre de la
    /// app —o el sistema matándola— se llevaba la ruta entera, y el visor
    /// offline no tenía nada que servir, de ahí la pantalla en negro. Con ella,
    /// grabar sin enlace es tan sólido como grabar con él: los ficheros se
    /// escriben bajo esta clave y, en cuanto el alta entra, se reescriben bajo
    /// la de verdad y esta desaparece.
    @Published private(set) var claveLocal: String?

    /// La clave con la que se guarda y se sirve la sesión de ahora: la del
    /// servidor si ya contestó; la provisional, si todavía no.
    var claveDeDatos: String? { sessionToken ?? claveLocal }

    /// Cuándo se grabó el punto más viejo que todavía no ha subido (epoch ms),
    /// o nil si no hay cola. Es lo que de verdad dice si hay cobertura: no
    /// "cuánto hace que se envió" —parado y sin nada que mandar, eso envejece
    /// solo— sino "cuánto lleva esperando algo que ya está grabado".
    @Published private(set) var colaDesdeMs: Double?

    /// Cómo va la emisión ahora mismo. Vive aquí, y no en la pantalla, para que
    /// el mapa y la pantalla principal no puedan contar cosas distintas.
    enum EstadoDeEmision: String {
        /// Esperando la hora de salida: ni graba ni envía, y así debe ser.
        case armada
        /// Graba, pero el servidor aún no le ha dado identificador: todavía no
        /// la ve nadie.
        case sinEnlace
        /// Todo lo grabado está subido.
        case enDirecto
        /// Graba y guarda, pero hace un rato que no consigue subir.
        case rezagada
        /// Lleva mucho sin subir nada.
        case perdida
    }

    func estadoDeEmision(_ ahora: Date = Date()) -> EstadoDeEmision {
        if isStandby { return .armada }
        if sessionToken == nil { return .sinEnlace }
        guard let desdeMs = colaDesdeMs else { return .enDirecto }
        let espera = ahora.timeIntervalSince1970 - desdeMs / 1000
        // Margen sobre la propia cadencia: en modo tiempo, una cola de menos de
        // dos ciclos es el funcionamiento normal, no una pérdida de cobertura.
        if espera < max(90, intervalSeconds * 2) { return .enDirecto }
        // La misma escala que el resumen de la pantalla principal.
        if espera < 360 { return .rezagada }
        return .perdida
    }
    private var altaPendiente: AltaPendiente?
    /// La hora que dejó puesta la RUTA (o el evento a través de ella). Sirve
    /// para saber si la que hay es suya y se la tiene que llevar al quitarla, o
    /// si la puso alguien a mano y entonces se queda.
    private var startAtFromPlan: Date? = nil
    @Published var sessions: [TrackSessionSummary] = []
    /// Eventos en los que participo que TODAVÍA admiten baliza: los que se
    /// pueden elegir al salir.
    @Published var events: [EventSummary] = []
    /// Las carreras ya terminadas por su organizador. No se pueden emitir —por
    /// eso van aparte de `events`, que es lo que alimenta el selector— pero se
    /// siguen corriendo: su parrilla es donde están los resultados, y perder el
    /// atajo a ella justo cuando se quieren mirar no tenía sentido. En pantalla
    /// van plegadas, para no hacer ruido.
    @Published var pastEvents: [EventSummary] = []
    /// Nombre de cada evento visto, TERMINADOS INCLUIDOS, para poder etiquetar
    /// salidas viejas: `events` solo lleva los que aún admiten emitir.
    private var eventNames: [String: String] = [:]
    /// Evento al que se atribuye esta salida. nil = baliza suelta, que es lo
    /// normal: los eventos son la excepción, no el modo por defecto.
    @Published var selectedEventId: String? = nil
    /// El evento lo propuso la app (es el de HOY), no lo eligió su dueño. Se
    /// dice en pantalla: atribuir una salida a una carrera sin avisar sería
    /// decidir por él. Ver `autoSelectTodaysEvent()`.
    @Published var eventPickedAutomatically = false
    /// El evento que la app propuso y su dueño quitó. En `UserDefaults` —como
    /// `takeoverNote`— y por lo mismo: sin esto, cerrar y volver a abrir la app
    /// el día de la carrera devolvería el evento que se acaba de quitar, y una
    /// propuesta que no acepta un "no" deja de ser una propuesta.
    private var rejectedEventId: String? {
        get { UserDefaults.standard.string(forKey: "rejectedEventId") }
        set {
            if let newValue { UserDefaults.standard.set(newValue, forKey: "rejectedEventId") }
            else { UserDefaults.standard.removeObject(forKey: "rejectedEventId") }
        }
    }
    /// How long a finished route stays viewable (hours). Sent to the backend on stop.
    /// Cuánto se conserva la ruta al terminar. Treinta días, el mismo plazo
    /// que aplica el servidor cuando nadie le dice otra cosa: la enhorabuena
    /// llega durante días y un enlace pegado en un grupo se sigue abriendo
    /// mucho después. Eran 48 h, y como el plazo que manda la app pisa al del
    /// servidor, una salida del sábado aparecía "Caducada" el lunes.
    @Published var retainHours: Double = 720
    /// GPS fixes recorded but not yet uploaded (offline backlog, e.g. no coverage).
    @Published var pendingCount = 0
    /// Field notes anchored during the current session (count, for the UI).
    @Published var noteCount = 0
    /// The user's server-side note-media use and per-user budget (bytes), for the
    /// storage meter. nil until first fetched (or offline); refreshed on demand.
    @Published var storageUsedBytes: Int64?
    @Published var storageQuotaBytes: Int64?
    /// Active followers currently watching (from the ping response); nil until the
    /// first successful upload, or against a server that doesn't report it.
    @Published var activeViewers: Int?
    /// Whether iOS Low Power Mode is on (reflected live). It extends autonomy and
    /// does NOT disable our active background location session or uploads.
    @Published var lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled

    // MARK: Battery telemetry (measured, not theoretical)
    /// Current charge 0…1, or -1 if unknown (e.g. simulator).
    @Published var batteryLevel: Double = -1
    @Published var isCharging = false
    /// Real measured drain over a rolling window (% per hour); nil until enough
    /// has elapsed to be meaningful or while charging.
    @Published var batteryDrainPerHour: Double?
    /// Estimated autonomy at the current measured drain (hours); nil if unknown.
    @Published var estimatedHoursRemaining: Double?
    /// Recent (time, level) samples since the last unplug, for the drain estimate.
    private var batterySamples: [(t: Date, level: Double)] = []
    /// Battery level is coarse and changes slowly, so sampling every ~2 min is
    /// plenty; reading it is free, but this keeps the sample history tidy.
    private let batterySampleInterval: TimeInterval = 120
    private var lastBatterySampleAt: Date = .distantPast

    /// App-level singleton so a headless background relaunch (iOS reviving the app
    /// for a significant-location-change) can resume the beacon with no UI.
    static let shared = TrackingStore()
    /// The auth bearer token, set once known (login / relaunch from Keychain).
    private(set) var token: String = ""
    private let location = LocationManager()
    private var lastSendAttempt: Date = .distantPast
    private var pending: [Fix] = []
    private var isFlushing = false
    private var flushTimer: Timer?

    /// All field notes of the CURRENT session (uploaded + not), retained locally so
    /// the embedded offline viewer can draw them. Persisted to disk like `trail`.
    private var notes: [Note] = []
    var currentNotes: [Note] { notes.sorted { $0.createdAt > $1.createdAt } }
    /// Notes not yet uploaded (offline backlog), retried on the flush timer. Kept
    /// separate from `notes` and persisted to UserDefaults like `pending`.
    private var pendingNotes: [Note] = []
    private var isFlushingNotes = false
    /// Note ids deleted locally but not yet confirmed deleted by the backend.
    private var pendingNoteDeletes: [String] = []
    private var isFlushingNoteDeletes = false

    /// One not-yet-uploaded media file for a note (audio/photo), referencing a file
    /// in the session's media dir. Uploaded once its note row exists server-side.
    private struct MediaUpload: Codable { var noteId: String; var kind: String; var file: String }
    private var pendingMedia: [MediaUpload] = []
    private var isFlushingMedia = false

    /// Full recorded trail of the CURRENT session (sent + unsent), retained locally
    /// so the embedded offline viewer can draw the whole route even for fixes that
    /// were already uploaded and dropped from `pending`. Bounded like the server.
    private var trail: [TrailPoint] = []
    private let trailMax = 2000 // mirror PATH_MAX in functions/api/track/[id]/ping.ts
    /// The most recent fix recorded locally (the REAL position, known even offline).
    private var lastRecordedFix: Fix?
    /// The last position taken as good. Movement is judged against it — not the
    /// previous reading — so a slow real advance accumulates until detected
    /// instead of being lost step by step (mirror of Android's `anclaPosicion`).
    private var anchorFix: Fix?
    /// Readings that didn't clear the GPS noise and were recorded holding the
    /// anchored position. Shown so the threshold can be judged with data: many
    /// of these while walking means it's set too high.
    @Published var heldReadings = 0
    /// The most recent fix actually UPLOADED to the server — i.e. what followers
    /// currently see. Frozen while offline; catches up when the backlog flushes.
    private var lastReportedFix: TrackFixWire?
    /// Follower display name for the local viewer (set from the auth user).
    var viewerUsername: String? { didSet { ViewerDataProvider.shared.setUsername(viewerUsername) } }

    /// Straight-line gap (metres) between the real current position and the last
    /// position uploaded to the server (what followers see). nil until both exist.
    /// Grows while in a no-coverage zone; collapses to ~0 once the backlog flushes.
    var followerGapMeters: Double? {
        guard let loc = lastLocation, let r = lastReportedFix else { return nil }
        return CLLocation(latitude: r.lat, longitude: r.lon).distance(from: loc)
    }

    /// Set the auth token once it's known (login, or restored from the Keychain at
    /// launch). Safe to call repeatedly with the same token.
    func configure(token: String) { self.token = token }

    // MARK: Storage meter

    /// Bytes the CURRENT session's media occupies locally (== what it uploads).
    var sessionMediaBytes: Int64 { claveDeDatos.map { LocalStore.mediaBytes($0) } ?? 0 }
    /// Photo/audio counts for the current session (for the storage summary line).
    var sessionMediaCounts: (photos: Int, audios: Int) {
        claveDeDatos.map { LocalStore.mediaCounts($0) } ?? (0, 0)
    }

    /// Refresh the user's server-side media use vs budget. Best-effort: leaves the
    /// last known values untouched offline / on error (never crashes, never clears).
    func refreshStorage() async {
        guard !token.isEmpty else { return }
        if let info = try? await API.fetchStorage(token: token) {
            storageUsedBytes = info.usedBytes
            storageQuotaBytes = info.quotaBytes
        }
    }

    private init() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(
            forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled }
        }
        authStatus = location.authorizationStatus
        location.onLocation = { [weak self] loc in
            Task { @MainActor in self?.handleLocation(loc) }
        }
        location.onAuthChange = { [weak self] status in
            Task { @MainActor in self?.authStatus = status }
        }
    }

    var shareLink: String? {
        guard let t = sessionToken else { return nil }
        return Config.shareLink(for: t)
    }

    /// El conversor de GPX (un visor web oculto). Se crea al primer uso.
    private var conversorGpx: GpxImporter?

    /**
     Carga un GPX como ruta nueva de la cuenta y la deja elegida.

     La ruta nace a secas —solo el recorrido, sin previsión ni hora prevista—:
     es para empezar ya sobre ella, y la previsión se le puede añadir después
     en la web. Convertirla es local (ver `GpxImporter`); guardarla en la cuenta
     necesita red, porque la baliza se une a la ruta por su identificador del
     servidor. Devuelve el nombre de la ruta, o lanza con un mensaje para
     enseñar tal cual.
     */
    @discardableResult
    func importaGpx(_ url: URL) async throws -> String {
        let accedido = url.startAccessingSecurityScopedResource()
        defer { if accedido { url.stopAccessingSecurityScopedResource() } }
        let datos = try Data(contentsOf: url)
        guard let texto = String(data: datos, encoding: .utf8) ?? String(data: datos, encoding: .isoLatin1) else {
            throw GpxImporter.Fallo.conversion("Ese fichero no es un GPX que se pueda leer.")
        }
        let conversor = conversorGpx ?? GpxImporter()
        conversorGpx = conversor
        let ruta = try await conversor.convierte(texto: texto, fichero: url.lastPathComponent, actividad: activity?.rawValue)
        let plan: PlanSummary
        do {
            plan = try await API.createPlan(
                token: token, cuerpo: ruta.cuerpo, nombre: ruta.nombre,
                distanciaKm: ruta.distanciaKm, desnivelM: ruta.desnivelM, actividad: activity?.rawValue,
            )
        } catch let e as APIError where e.status == 0 {
            throw GpxImporter.Fallo.conversion("Sin cobertura: el GPX está leído, pero guardarlo como ruta necesita red. Vuelve a intentarlo cuando la tengas.")
        }
        await loadPlans()
        // Elegida, para empezar ya. No trae hora: la baliza sale al pulsar.
        selectedPlanId = plan.id
        return plan.name
    }

    func loadPlans() async {
        // Best-effort: if it fails we simply offer "Sin ruta"; never crash.
        if let result = try? await API.listPlans(token: token) {
            plans = result
            applyPlanStart() // if a plan was already selected, pick up its start
            // Si la carrera se eligió antes de que llegaran las previsiones
            // (la de hoy se propone sola al abrir), ahora sí se puede coger la suya.
            applyEventPlan()
        }
    }

    /// Picking an event defaults the departure to the event's OFFICIAL start,
    /// the same way picking a plan defaults it to the plan's. It is what the
    /// organisation already knows, and nobody should have to type it again on
    /// the start line with gloves on — and if the gun is still ahead, the beacon
    /// stays ARMED and silent instead of burning GPS and showing where you
    /// parked.
    ///
    /// A hand-set time is never overwritten: whoever touched it has a reason
    /// (an earlier wave, an organiser who hasn't fixed the time yet), and an app
    /// that undoes your choice when you switch events is one you stop trusting.
    /// The exception is a time this same mechanism put there — that one belongs
    /// to the event, so it leaves with it.
    /// Para qué carrera se buscó ya previsión, y cuál se puso sola. Con esto no
    /// se vuelve a poner la que alguien acaba de quitar a mano.
    private var planAppliedForEventId: String? = nil
    private var planPickedForEvent: String? = nil

    /// Al elegir una carrera, su PREVISIÓN va sola.
    ///
    /// Quien se ha hecho sus ritmos para la carrera —desde "Mi plan" en la
    /// web— tenía además que acordarse de elegirlos aquí como ruta, y si no, la
    /// baliza corría con los del evento sin decir nada. Se coge la más reciente
    /// de esa carrera (el servidor las da de la más nueva a la más vieja), solo
    /// antes de salir y solo si no hay otra elegida a mano.
    private func applyEventPlan() {
        guard !isSharing, let ev = selectedEventId, planAppliedForEventId != ev,
              let plan = plans.first(where: { $0.eventId == ev }) else { return }
        guard selectedPlanId == nil || selectedPlanId == planPickedForEvent else { return }
        planAppliedForEventId = ev
        planPickedForEvent = plan.id
        selectedPlanId = plan.id
    }

    private func applyEventStart(previous: String?) {
        let cameFromEvent = startAtTouched
            && events.contains { $0.id == previous && $0.startsAt.map { Date(timeIntervalSince1970: $0 / 1000) } == startAt }
        guard !startAtTouched || cameFromEvent else { return }
        if let id = selectedEventId,
           let ev = events.first(where: { $0.id == id }),
           let ms = ev.startsAt, ms > 0 {
            startAt = Date(timeIntervalSince1970: ms / 1000)
            startAtTouched = true
        } else if cameFromEvent {
            startAt = Date()
            startAtTouched = false
        }
        applyEventActivity()
    }

    /// The ACTIVITY is inherited from the event too: the race knows whether it
    /// is a walk, a run or a ride, and the beacon has no business guessing it —
    /// the guess is a p85 of GPS speeds, which is exactly what goes wrong on a
    /// phone with a poor fix. It matters for the impossible-reading filter (12
    /// km/h is a GPS jump on foot and a gentle pace on a bike) and for the pace
    /// shown.
    ///
    /// Only fills in "Automático": whoever picked one by hand had a reason (a
    /// ride on a running event to sweep the course, walking it with a child),
    /// and an app that undoes your choice is one you stop trusting.
    private func applyEventActivity() {
        guard activity == nil,
              let id = selectedEventId,
              let ev = events.first(where: { $0.id == id }),
              let a = ev.activity.flatMap(BeaconActivity.init(rawValue:)) else { return }
        setActivity(a)
    }

    /// When a plan is selected, default the departure to the PLAN's start so all
    /// paces/predictions follow the plan (not the activation moment). Adjustable.
    ///
    /// Y al QUITAR la ruta, la hora que puso se va con ella. Antes se quedaba
    /// huérfana: elegías una previsión con salida a las 08:45, la quitabas
    /// porque al final salías sin ruta, y las 08:45 seguían ahí sin forma de
    /// volver a "ahora" salvo pelearse con el selector de fecha. Una hora puesta
    /// A MANO sí se queda: quien la tocó tenía un motivo.
    private func applyPlanStart() {
        let cameFromPlan = startAtTouched && startAtFromPlan == startAt
        guard let id = selectedPlanId,
              let p = plans.first(where: { $0.id == id }) else {
            if cameFromPlan { resetStartAt() }
            startAtFromPlan = nil
            return
        }
        // La actividad viene del plan igual que la hora: es la que se eligió al
        // planificar, con el recorrido delante. Solo rellena "Automático".
        if activity == nil, let a = p.activity.flatMap(BeaconActivity.init(rawValue:)) {
            setActivity(a)
        }
        // La hora la pone la RUTA si la trae y, si no, el EVENTO. Una ruta sin
        // hora es lo normal —se planifica el recorrido, no el día—, y sin este
        // respaldo elegirla dejaba la salida en "ahora": la baliza salía
        // emitiendo desde el aparcamiento en vez de quedarse armada y en
        // silencio hasta el disparo. El orden es ese porque una ruta CON hora es
        // más concreta que la carrera: quien sale en otra tanda la planifica con
        // la suya.
        if let iso = p.startTime, let d = Self.parseISO(iso) {
            startAt = d
            startAtTouched = true
            startAtFromPlan = d
        } else if let ms = activeEvent?.startsAt, ms > 0 {
            let d = Date(timeIntervalSince1970: ms / 1000)
            startAt = d
            startAtTouched = true
            startAtFromPlan = d
        } else if cameFromPlan {
            // De una ruta con hora a otra sin ella: la hora era de la primera.
            resetStartAt()
            startAtFromPlan = nil
        }
    }

    /// A lo que vuelve la salida cuando se va lo que la había puesto: la
    /// oficial del evento si hay uno, y si no "ahora", que se resuelve al
    /// pulsar Empezar.
    private func resetStartAt() {
        if let ms = activeEvent?.startsAt, ms > 0 {
            startAt = Date(timeIntervalSince1970: ms / 1000)
            startAtTouched = true
        } else {
            startAt = Date()
            startAtTouched = false
        }
    }

    /// La hora puesta A MANO desde el selector. Es el único camino por el que
    /// la vista toca la salida: antes un `.onChange` marcaba "tocada" ante
    /// cualquier cambio del valor, también los que hacía el propio store, así
    /// que en cuanto se fijaba una hora ya no había forma de volver a "ahora".
    func setStartAt(_ d: Date) {
        startAt = d
        startAtTouched = true
    }

    /// "Salgo ya": fuera la hora prevista, sea de quien sea. La salida vuelve a
    /// ser el momento de pulsar Empezar, y la baliza no se queda armada
    /// esperando una hora que ya no va.
    /// Si la hora de salida puesta se va a respetar al empezar: elegida y dentro
    /// de la ventana que acepta el servidor. La MISMA cuenta que usa
    /// `startSharing`, para que lo que dice un botón y lo que hace la baliza no
    /// puedan separarse.
    private var horaHeredadaValida: Bool {
        let ahora = Date()
        return startAtTouched
            && startAt <= ahora.addingTimeInterval(TrackingRules.salidaMaxAdelante)
            && startAt >= ahora.addingTimeInterval(-TrackingRules.salidaMaxAtras)
    }

    /// La hora para la que quedaría ARMADA la baliza si se empezase ahora, o
    /// nil si saldría en el acto. Es lo que decide si hay que preguntar
    /// "¿empiezo ya o a la hora prevista?".
    var salidaQueArmaria: Date? {
        guard !isSharing, horaHeredadaValida,
              startAt.timeIntervalSinceNow > TrackingRules.startLeadSeconds else { return nil }
        return startAt
    }

    /// Si la carrera elegida impone su hora: está a menos de 18 h (o empezó
    /// hace menos de un día) y el servidor pondrá su salida oficial.
    var carreraImponeHora: Bool {
        guard let ms = activeEvent?.startsAt, ms > 0 else { return false }
        let desde = Date(timeIntervalSince1970: ms / 1000).timeIntervalSinceNow
        return desde <= TrackingRules.carreraImponeHora && desde >= -TrackingRules.salidaMaxAtras
    }

    func clearStartAt() {
        startAt = Date()
        startAtTouched = false
        startAtFromPlan = nil
    }

    /**
     "Salgo YA" con la baliza ya abierta y esperando su hora.

     Faltaba, y se notó: una baliza armada solo sale de la espera cuando llega su
     hora, y la hora solo se cambia desde una sección que se ESCONDE mientras se
     comparte. Con una hora heredada de una carrera lejana —que es justo como se
     cuela— la baliza se quedaba sin grabar y sin forma de despertarla: había que
     pararla y volver a empezar, y el tiempo de espera no se recuperaba.
     */
    func empiezaYa() {
        guard isSharing, isStandby else { return }
        clearStartAt()
        maybeBeginFromStandby()
    }

    private static func parseISO(_ s: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: s) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        return f2.date(from: s)
    }

    /// Refresca mis eventos. Al mejor esfuerzo: si falla, la baliza funciona
    /// igual que siempre y el selector simplemente no aparece.
    func loadEvents() async {
        if let result = try? await API.listEvents(token: token) {
            // Las que vienen, la más cercana primero: es el orden en que se
            // miran. Las que no tienen hora, al final —no compiten con una que
            // sale mañana—. Las terminadas al revés: la última corrida arriba.
            events = result.filter { !$0.isOver }
                .sorted { ($0.startsAt ?? .greatestFiniteMagnitude) < ($1.startsAt ?? .greatestFiniteMagnitude) }
            pastEvents = result.filter { $0.isOver }
                .sorted { ($0.startsAt ?? 0) > ($1.startsAt ?? 0) }
            // Los terminados NO se ofrecen para emitir —de ahí el filtro— pero
            // sus nombres siguen haciendo falta: el listado de seguimientos
            // trae el id del evento, y sin esto una salida pasaba a leerse
            // "Sin nombre" en cuanto el organizador cerraba la carrera.
            for ev in result { eventNames[ev.id] = ev.name }
            // Y lo que el widget necesita, al cajón compartido: su cuenta
            // atrás sale de aquí (ver `ContadoresDeCarreras`).
            ContadoresDeCarreras.sincroniza(result)
            autoSelectTodaysEvent()
        }
    }

    /// Deja puesto el evento de HOY al abrir la baliza, si hay uno.
    ///
    /// Quien abre la baliza el día de su carrera la abre PARA su carrera. Qué
    /// carrera es lo decide `TrackingRules.todaysEvent`; aquí está cuándo se
    /// puede proponer, que es lo delicado:
    ///
    /// - **Nunca con una salida en marcha o armada**: la sesión ya existe con su
    ///   evento (o sin él), y cambiárselo por detrás mandaría al servidor una
    ///   unión que nadie ha pedido.
    /// - **Nunca si ya hay evento elegido**: lo eligió alguien y manda.
    /// - **Nunca el que se acaba de quitar** (`rejectedEventId`, que sobrevive a
    ///   cerrar la app).
    ///
    /// Se llama al refrescar la lista, tirón hacia abajo incluido: los tres
    /// candados hacen que repetirlo no sea repetirse.
    func autoSelectTodaysEvent() {
        guard !isSharing, !isStandby, selectedEventId == nil,
              let ev = TrackingRules.todaysEvent(events),
              ev.id != rejectedEventId else { return }
        setEvent(ev.id, auto: true)
    }

    /// Las previsiones hechas SOBRE el recorrido del evento elegido: las únicas
    /// que cuadran con la carrera que se va a correr.
    var plansOfEvent: [PlanSummary] {
        guard let ev = selectedEventId else { return [] }
        return plans.filter { $0.eventId == ev }
    }

    /// El resto. No se esconden —una previsión vieja puede ser justo la que
    /// quieres— pero van aparte y avisadas.
    var plansNotOfEvent: [PlanSummary] {
        guard let ev = selectedEventId else { return plans }
        return plans.filter { $0.eventId != ev }
    }

    /// ¿La previsión elegida es de otra cosa que el evento que se va a correr?
    /// Solo con evento y previsión elegidos: sin previsión se hereda la del
    /// evento, que es exactamente lo correcto.
    var planMismatchesEvent: Bool {
        guard selectedEventId != nil, let planId = selectedPlanId else { return false }
        return plans.first { $0.id == planId }?.eventId != selectedEventId
    }

    /// El evento de la salida en curso, para enseñarlo mientras se emite.
    var activeEvent: EventSummary? {
        guard let id = selectedEventId else { return nil }
        return events.first { $0.id == id }
    }

    /**
     * Cambia el evento al que se atribuye la salida.
     *
     * Antes de salir es solo una elección local (viaja al crear la sesión). En
     * marcha, en cambio, hay que decírselo al servidor: la sesión ya existe, y
     * obligar a pararla y volver a empezar para corregir el evento partiría la
     * traza en dos. Es el mismo camino que usa el lobby de la web.
     */
    func setEvent(_ eventId: String?, auto: Bool = false) {
        let previous = selectedEventId
        // La mano manda sobre la propuesta, y se recuerda: quitar el evento que
        // propuso la app es decirle que hoy no, y volver a proponerlo al abrir
        // otra vez sería no haber escuchado. Elegir uno a mano borra el rechazo:
        // ya no hay nada que evitar.
        if !auto { rejectedEventId = eventId == nil ? previous : nil }
        // Elegir (o soltar) una carrera se SIENTE, y solo cuando lo hace la mano:
        // la que se propone sola al abrir no se anuncia con un golpecito.
        if !auto && previous != eventId { Vibra.eleccion() }
        selectedEventId = eventId
        eventPickedAutomatically = auto && eventId != nil
        applyEventStart(previous: previous)
        if !isSharing && previous != eventId {
            // La previsión que se puso sola era de la carrera de antes: se va con ella.
            if let puesta = planPickedForEvent, selectedPlanId == puesta { selectedPlanId = nil }
            planPickedForEvent = nil
            planAppliedForEventId = nil
            applyEventPlan()
        }
        guard isSharing else { return }
        Task {
            // Quitar primero del anterior: una sesión pertenece a un evento, no
            // a dos, y el servidor solo conoce la petición que le llega.
            if let previous, previous != eventId {
                try? await API.attachBeacon(token: token, eventId: previous, attach: false)
            }
            if let eventId {
                do { try await API.attachBeacon(token: token, eventId: eventId, attach: true) }
                catch {
                    // Sin baliza viva o sin permiso: se deshace la elección para
                    // no enseñar un evento al que en realidad no se está unido.
                    selectedEventId = previous
                    lastError = "No se pudo unir la baliza al evento."
                }
            }
        }
    }

    func loadSessions() async {
        // Best-effort: if it fails we keep whatever we had; never crash.
        if let result = try? await API.listSessions(token: token) {
            // La más reciente arriba, SIEMPRE, chincheta o no.
            //
            // Antes las fijadas subían al principio, y eso confundía dos cosas
            // distintas: la chincheta dice "esta no caduca", no "esta importa
            // más que la de hoy". El resultado era que la salida de esta mañana
            // aparecía por debajo de una de hace meses, justo cuando es la que
            // se viene a buscar. Que no caduque se sigue viendo en su fila.
            sessions = result.sorted { Self.finishKey($0) > Self.finishKey($1) }
            // Drop local trail/plan files for sessions the server no longer lists
            // (keep the current one even if it hasn't surfaced in the list yet).
            var keep = Set(result.map { $0.id })
            keep.formUnion(GuideLibrary.shared.storageIds)
            if let t = sessionToken { keep.insert(t) }
            if let t = claveLocal { keep.insert(t) }
            LocalStore.prune(keep: keep)
        }
    }

    /// Recency key for ordering "Mis seguimientos": most recently finished first.
    /// Active (ongoing) sessions have no end yet, so they float to the top; ended
    /// ones sort by when they finished, falling back to last position / planned start.
    private static func finishKey(_ s: TrackSessionSummary) -> Double {
        if s.status == "active" { return .greatestFiniteMagnitude }
        return s.endedAt ?? s.updatedAt ?? s.startedAt
    }

    /// Toggle the "chincheta" so a session is kept indefinitely (or released back
    /// to the normal time-based expiry). Refreshes the list to reflect the change.
    func setPinned(_ id: String, _ pinned: Bool) async {
        await API.setPinned(token: token, id: id, pinned: pinned)
        await loadSessions()
    }

    /// Rename a finished/pinned session so it's identifiable later in the list
    /// (pass nil/empty to clear it). Refreshes to reflect the new label.
    func rename(_ id: String, _ title: String?) async {
        // Si es la salida EN MARCHA, el nombre nuevo es el suyo aquí también:
        // si no, seguiría emitiendo con el viejo hasta parar y volver a abrir.
        if id == sessionToken {
            activeTitle = title
            persistActive()
            ViewerDataProvider.shared.setTitle(token: id, title: title)
        }
        await API.rename(token: token, id: id, title: title)
        await loadSessions()
    }

    /// Public follower link for a session, so the owner can recover it and open
    /// the route later without having to reanudar (the viewer serves finished
    /// and pinned sessions too).
    func shareLink(for id: String) -> String { Config.shareLink(for: id) }

    func isActive(_ s: TrackSessionSummary) -> Bool { s.status == "active" }

    /// A session whose route has already been purged server-side: not pinned and
    /// past its retention window. Its public link is dead (the viewer returns a
    /// "caducado" page), so the app hides link-sharing and flags it as expired.
    /// Pinned sessions are exempt — they're kept indefinitely.
    func isPurged(_ s: TrackSessionSummary) -> Bool {
        !s.isPinned && Date().timeIntervalSince1970 * 1000 > s.expiresAt
    }

    /// Resume broadcasting to an EXISTING active session without creating a new
    /// one. The ping endpoint already accepts an owned, active session.
    func continueSession(_ id: String) {
        lastError = nil
        sessionToken = id
        // A continued session keeps its route name from the backend summary
        // (selectedPlanId isn't known for a session we didn't just create).
        let summary = sessions.first(where: { $0.id == id })
        activePlanName = summary?.planName
        activeTitle = summary?.title
        activity = summary?.activity
        // El evento viene de la sesión, no de lo que estuviera elegido: al
        // retomar una salida de ayer, el evento es el suyo —y por tanto ya no
        // es una propuesta de la app.
        selectedEventId = summary?.eventId
        eventPickedAutomatically = false
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
        anchorFix = nil
        heldReadings = 0
        loadPending(id)
        // Re-hydrate the full trail from disk so the offline viewer shows the whole
        // route (and last position) immediately, before the next fix arrives.
        loadTrail(id)
        loadNotes(id)
        loadPendingNotes(id)
        loadPendingNoteDeletes(id)
        loadPendingMedia(id)
        ViewerDataProvider.shared.register(token: id, title: summary?.title, startedAt: summary?.startedAt ?? Date().timeIntervalSince1970 * 1000, expiresAt: summary?.expiresAt ?? 0, status: "active")
        ViewerDataProvider.shared.setActivity(token: id, activity: summary?.activity)
        let lastFix = trail.last.map { TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil, accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t) }
        // The reported position is unknown for a continued session until the next
        // successful upload; the offline gap simply won't show until then.
        lastReportedFix = nil
        ViewerDataProvider.shared.update(token: id, fix: lastFix, reportedFix: nil, trail: trail)
        ViewerDataProvider.shared.setNotes(token: id, notes: notes)
        applyLocationConfig()
        location.requestAuthorization()
        location.start()
        startFlushTimer()
        persistActive()
    }

    /// Re-activate an ended session on the backend, then resume broadcasting to
    /// it (same link). Lets the user "dejar de compartir y volver a compartir".
    func resumeSession(_ id: String) {
        lastError = nil
        Task {
            do {
                _ = try await API.reopen(token: token, id: id)
                await loadSessions()        // refresh status + route name
                continueSession(id)
            } catch {
                lastError = (error as? APIError)?.errorDescription ?? "No se pudo reanudar el seguimiento."
            }
        }
    }

    func deleteSession(_ id: String) async {
        await API.deleteSession(token: token, id: id)
        LocalStore.remove(id) // drop the local trail + cached plan for good
        if id == sessionToken {
            location.stop()
            isSharing = false
            sessionToken = nil
            clearActive()
        }
        await loadSessions()
    }

    /// Bulk-delete (the "Limpiar" sweep over expired sessions with nothing kept
    /// locally): one list refresh at the end instead of one per deletion.
    func deleteSessions(_ ids: [String]) async {
        for id in ids {
            await API.deleteSession(token: token, id: id)
            LocalStore.remove(id)
        }
        await loadSessions()
    }

    /// Serve a FINISHED session's locally kept trail, notes and plan to the
    /// embedded viewer, so "Ver mapa" works with no coverage (mirror of
    /// Android's `ViewerData.abreConsulta`; same mechanism as an imported
    /// guide). Registered as "ended" and never expiring — what you're
    /// reviewing shouldn't die under you.
    func prepareOfflineReview(_ session: TrackSessionSummary) throws {
        let trailData = try Data(contentsOf: LocalStore.trailURL(session.id))
        let localTrail = try JSONDecoder().decode([TrailPoint].self, from: trailData)
        let localNotes = (try? Data(contentsOf: LocalStore.notesURL(session.id)))
            .flatMap { try? JSONDecoder().decode([Note].self, from: $0) } ?? []
        let fix = localTrail.last.map {
            TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil,
                         accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t)
        }
        ViewerDataProvider.shared.register(
            token: session.id, title: session.title, startedAt: session.startedAt,
            expiresAt: .greatestFiniteMagnitude, status: "ended"
        )
        ViewerDataProvider.shared.setActivity(token: session.id, activity: session.activity)
        ViewerDataProvider.shared.update(token: session.id, fix: fix, reportedFix: nil, trail: localTrail)
        ViewerDataProvider.shared.setNotes(token: session.id, notes: localNotes)
    }

    /// Empezar a compartir. `force` salta el aviso de relevo: lo pone la vista
    /// cuando quien usa la app ya ha dicho que sí a quitarle la baliza al otro
    /// móvil.
    /// El nombre de una salida a la que no se le puso ninguno: la marca y
    /// cuándo empezó.
    ///
    /// "Sin nombre" no distingue una salida de otra en la lista de seguimientos
    /// ni en el enlace que se comparte, y ponerle nombre es justo lo que no se
    /// hace con prisa. Espejo de `nombrePorDefecto` en Android.
    static func nombrePorDefecto(_ inicio: Date) -> String {
        "SiLoSeNoSalgo · " + inicio.formatted(.dateTime.day().month(.abbreviated).year().hour().minute())
    }

    func startSharing(title: String?, force: Bool = false) async {
        lastError = nil
        // ¿Hay otra baliza viva en esta cuenta? Se pregunta ANTES de crear la
        // sesión: después ya está hecho, y "acabo de dejar mudo el otro móvil"
        // no es algo que se pueda deshacer con un botón de atrás.
        if !force, let otra = await activeElsewhere() {
            takeoverAsk = otra
            return
        }
        takeoverAsk = nil
        location.requestAuthorization()
        // La hora real de la salida es el momento de PULSAR, no el de la
        // respuesta del servidor. Y con la misma ventana que aplica el servidor:
        // una hora heredada de una carrera que ya no está elegida dejaba la
        // baliza "armada" en la pantalla —esperando una salida a quince días—
        // mientras el servidor, que descarta lo que se pasa de catorce, la había
        // creado con "ahora". Dos verdades a la vez y ninguna forma de
        // arreglarlo desde la app.
        let heredadaValida = horaHeredadaValida
        if startAtTouched && !heredadaValida {
            // Y se limpia, para que la pantalla deje de enseñar una hora que ya
            // no se está usando.
            startAt = Date()
            startAtTouched = false
        }
        let start = heredadaValida ? startAt : Date()
        // Sin nombre puesto, uno con la marca y la hora: en la lista de
        // seguimientos y en el enlace, "Sin nombre" no distingue nada.
        let nombre = title ?? Self.nombrePorDefecto(start)

        // 1) GRABAR YA, sin esperar a nadie.
        empiezaEnLocal(desde: start, nombre: nombre)

        // 2) El alta en el servidor, que es lo único que necesita red: de ahí
        //    salen el identificador y el enlace. Si no hay cobertura queda
        //    pendiente y se reintenta sola en cada tic; mientras tanto la traza
        //    se guarda, y al darse de alta se sube entera con su hora real.
        altaPendiente = AltaPendiente(
            startAtMs: start.timeIntervalSince1970 * 1000,
            title: nombre,
            planId: selectedPlanId,
            eventId: selectedEventId,
            activity: activity?.rawValue,
            clave: claveLocal,
        )
        guardaAltaPendiente()
        await intentaAlta()
    }

    /**
     Arranca la grabación en LOCAL: buffers limpios, GPS en marcha y reloj de
     envío. No necesita servidor, y por eso puede ir por delante de él.

     Esto es lo que hace que pulsar "compartir" sin cobertura no sea una pantalla
     esperando: la ruta empieza a contar en el momento de pulsar, que es lo que
     su dueño espera, y el enlace aparece cuando haya red.
     */
    private func empiezaEnLocal(desde start: Date, nombre: String) {
        activePlanName = plans.first(where: { $0.id == selectedPlanId })?.name
        sessionToken = nil
        // La clave con la que se guarda TODO hasta que el servidor conteste.
        limpiaLocal()
        claveLocal = Self.genId()
        isSharing = true
        pingCount = 0
        activeViewers = nil
        lastSentAt = nil
        lastSendAttempt = .distantPast
        pending = []
        persistPending()
        // Fresh local trail for the in-app offline viewer.
        trail = []
        lastRecordedFix = nil
        lastReportedFix = nil
        anchorFix = nil
        heldReadings = 0
        persistTrail()
        notes = []
        pendingNotes = []
        pendingNoteDeletes = []
        pendingMedia = []
        noteCount = 0
        persistNotes()
        persistPendingNotes()
        persistPendingNoteDeletes()
        persistPendingMedia()
        activeTitle = nombre
        // El visor offline, dado de alta con la clave provisional: el mapa de
        // "ver mi ruta" tiene que funcionar desde el primer segundo, que es
        // justo cuando no hay enlace todavía.
        if let clave = claveLocal {
            ViewerDataProvider.shared.register(
                token: clave, title: nombre,
                startedAt: start.timeIntervalSince1970 * 1000, expiresAt: 0, status: "active",
            )
            ViewerDataProvider.shared.setActivity(token: clave, activity: activity)
        }
        // If the planned start is still ahead (beyond the lead margin), arm in
        // low-power standby: keep the app alive with coarse location but upload
        // nothing until ~2 min before the start, to save battery.
        if start.timeIntervalSinceNow > TrackingRules.startLeadSeconds {
            isStandby = true
            location.configureStandby()
        } else {
            isStandby = false
            applyLocationConfig()
        }
        // Y los avisos de la salida, que son la red debajo del arranque
        // automático: si el sistema durmió la app y no arrancó sola, el de las
        // 5 min avisa a tiempo de abrirla. Ver `AvisosDeCarrera`.
        AvisosDeCarrera.programaSalida(start, carrera: nombre)
        location.start()
        startFlushTimer()
    }

    /**
     Da de alta en el servidor una baliza que ya está grabando.

     Se llama al pulsar y, si falla, en cada tic hasta que entra: sin red no hay
     nada que avisar —se reintenta sola— y por eso un fallo de conexión no
     escribe error en pantalla; uno del servidor, sí.

     Al entrar, `flush()` sube de golpe todo lo grabado mientras tanto, con la
     hora de cada punto: el seguimiento no empieza cuando hubo cobertura, empieza
     cuando su dueño pulsó.
     */
    private func intentaAlta() async {
        guard isSharing, sessionToken == nil, let alta = altaPendiente else { return }
        do {
            let res = try await API.createTrack(
                token: token, title: alta.title, planId: alta.planId,
                startAt: alta.startAtMs,
                activity: alta.activity.flatMap(BeaconActivity.init(rawValue:)),
                eventId: alta.eventId, device: Self.deviceName,
            )
            let provisional = claveLocal
            sessionToken = res.id
            claveLocal = nil
            pendienteDeAlta = false
            altaPendiente = nil
            UserDefaults.standard.removeObject(forKey: altaKey)
            ViewerDataProvider.shared.register(
                token: res.id, title: alta.title, startedAt: alta.startAtMs,
                expiresAt: res.expiresAt, status: "active", aliasDe: provisional,
            )
            ViewerDataProvider.shared.setActivity(token: res.id, activity: activity)
            cachePlanBytes(for: res.id, planId: alta.planId)
            // Lo grabado sin enlace se reescribe bajo el identificador bueno y
            // se tira lo provisional: a partir de aquí hay una sola copia.
            reescribeBajoLaClaveBuena(desde: provisional)
            persistActive() // remember the "last known state" so a relaunch resumes it
            lastError = nil
            await flush()
        } catch {
            pendienteDeAlta = true
            // `status == 0` es "no se pudo ni preguntar": sin cobertura, y eso no
            // es un error que haya que gritar. Lo que responde el servidor sí.
            if let api = error as? APIError, api.status != 0 {
                lastError = api.errorDescription
            }
        }
    }

    /**
     Cuánto se pausa de una vez: diez minutos, lo que dura un avituallamiento
     largo o un cambio de ropa.
     */
    static let pausaMax = 10

    /**
     Lo que suma cada pulsación de "+5", y hasta dónde se puede llegar sumando.

     Se añade desde el propio botón en vez de tener que esperar a que venza y
     volver a pausar: quien se para a comer no va a estar pulsando cada diez
     minutos con las manos frías. Con techo —una hora— porque una pausa
     indefinida es otra forma de no saber nada, y quien se baja de verdad tiene
     el otro botón para decirlo. `pausaTope` es espejo de `PAUSA_MAX_MIN` en el
     servidor, que recorta cualquier cosa mayor.
     */
    static let pausaPaso = 5
    static let pausaTope = 60

    /// Hasta cuándo está pausada esta baliza, si lo está.
    @Published var pausadaHasta: Date?

    /// Si todavía cabe otro "+5" sin pasarse del techo.
    var puedeAlargar: Bool {
        guard let hasta = pausadaHasta, hasta > Date() else { return false }
        return hasta.timeIntervalSinceNow / 60 + Double(Self.pausaPaso) <= Double(Self.pausaTope)
    }

    /**
     "Me paro un rato, no me ha pasado nada."

     Pararse en una carrera larga es normal —un avituallamiento, una siesta, una
     necesidad— y quien mira no podía distinguirlo de una avería: el punto deja
     de moverse y al rato el mapa anuncia "sin cobertura", que es justo el
     mensaje que no hay que mandarle a una familia.

     Se avisa al servidor con la posición de ahora y se deja de emitir: el GPS
     se relaja, la batería lo agradece y a quien sigue la carrera le sale "en
     pausa" con los minutos que quedan. Al terminar, la baliza vuelve sola.
     */
    func pausa(minutos: Int = pausaMax) async {
        guard isSharing, !isStandby else { return }
        let hasta = Date().addingTimeInterval(Double(minutos) * 60)
        pausadaHasta = hasta
        API.pausaMin = minutos
        // Una posición ahora mismo lleva el aviso; después ya no hace falta
        // insistir, que de eso va la pausa.
        if let loc = lastLocation { ingest(loc) } else { await flush() }
        API.pausaMin = nil
        location.stop()
    }

    /**
     Cinco minutos más, sin salir de la pausa.

     Se suman a lo que QUEDA, no a los diez de partida: pulsarlo con tres
     minutos por delante deja ocho, que es lo que espera quien lo pulsa. El
     servidor recibe el total, no el incremento, porque una pausa es una hora
     límite y no una cuenta de minutos sueltos.
     */
    func alarga() async {
        guard isSharing, let hasta = pausadaHasta, hasta > Date() else { return }
        let total = min(Double(Self.pausaTope), hasta.timeIntervalSinceNow / 60 + Double(Self.pausaPaso))
        await pausa(minutos: max(1, Int(total.rounded())))
    }

    /**
     Se acabó el rato: la baliza vuelve sola.

     Hasta ahora la pantalla lo prometía y no pasaba —nadie reanudaba al vencer
     el plazo—, así que la baliza se quedaba muda hasta que alguien se acordaba
     de pulsar "seguir": exactamente el silencio que la pausa venía a evitar.
     Lo mira el mismo pulso de 20 s que ya corre durante la pausa.
     */
    private func reanudaSiVencioLaPausa() {
        guard let hasta = pausadaHasta, hasta <= Date() else { return }
        Task { await reanuda() }
    }

    /// Vuelve de la pausa: se acabó el rato, o se ha pulsado "seguir".
    func reanuda() async {
        guard isSharing, pausadaHasta != nil else { return }
        pausadaHasta = nil
        API.pausaMin = 0        // cancela la pausa en el servidor
        applyLocationConfig()
        location.start()
        lastSendAttempt = .distantPast
        if let loc = lastLocation { ingest(loc) } else { await flush() }
        API.pausaMin = nil
    }

    /**
     Bajarse de la carrera, dicho por quien la corre.

     No es lo mismo que apagar la baliza: apagarla deja a quien mira con la
     duda —¿se ha quedado sin batería?— y la hora que queda registrada es la de
     cuando uno se acuerda del móvil, en el coche o al día siguiente. Esto dice
     "lo dejo AHORA", queda en la clasificación con su hora y su kilómetro, y de
     paso cierra la baliza.
     */
    func abandona() async {
        // Si esta baliza corre una carrera, queda dicho AHÍ: es lo que pone su
        // hora y su kilómetro en la clasificación.
        if let ev = selectedEventId, !token.isEmpty {
            try? await API.marcaRetirado(token: token, eventId: ev)
        }
        await stopSharing()
    }

    func stopSharing() async {
        // Se acabó: los avisos de una salida que ya no va a ocurrir sobran.
        AvisosDeCarrera.borra()
        flushTimer?.invalidate()
        flushTimer = nil
        location.stop()
        isSharing = false
        isStandby = false
        activePlanName = nil
        activeTitle = nil
        clearActive() // explicit stop (or server-ended): don't resume on relaunch
        // Y si se paró antes de que el alta llegara a entrar, que no entre
        // después: una baliza que su dueño apagó no puede aparecer en el mapa
        // media hora más tarde porque volvió la cobertura.
        olvidaAltaPendiente()
        // Keep serving the just-finished session to a still-open offline viewer,
        // now flagged as ended (its trail file is kept for later review).
        ViewerDataProvider.shared.updateStatus("ended")
        let t = sessionToken
        sessionToken = nil
        limpiaLocal()
        if let t {
            // Best-effort: push any remaining backlog before ending (direct, so
            // it can't recurse through flush()).
            if !pending.isEmpty { _ = try? await API.pingBatch(token: token, id: t, fixes: pending) }
            for note in pendingNotes { _ = try? await API.createNote(token: token, sessionId: t, note: note) }
            for noteId in pendingNoteDeletes {
                _ = try? await API.deleteNote(token: token, sessionId: t, noteId: noteId)
            }
            for item in pendingMedia {
                if let data = try? Data(contentsOf: LocalStore.mediaFileURL(t, item.file)) {
                    let ct = item.kind == "audio" ? "audio/mp4" : "image/jpeg"
                    _ = try? await API.uploadNoteMedia(token: token, sessionId: t, noteId: item.noteId, kind: item.kind, data: data, contentType: ct)
                }
            }
            // Snapshot the activity at stop time: if it was left on "Automático",
            // persist the type inferred from the trail so "Mis seguimientos" shows
            // what it was when it last stopped (declared types are already stored).
            if activity == nil, let inferred = effectiveActivity {
                await API.setActivity(token: token, id: t, activity: inferred)
            }
            await API.end(token: token, id: t, retainHours: retainHours)
            UserDefaults.standard.removeObject(forKey: pendingKey(t))
            UserDefaults.standard.removeObject(forKey: notesPendingKey(t))
            UserDefaults.standard.removeObject(forKey: noteDeletesPendingKey(t))
            UserDefaults.standard.removeObject(forKey: mediaPendingKey(t))
        }
        pending = []
        pendingCount = 0
        pendingNotes = []
        pendingNoteDeletes = []
        pendingMedia = []
        activeViewers = nil
        // The backend keeps the just-ended session for the chosen retention;
        // refresh so it appears in "Mis seguimientos".
        await loadSessions()
    }

    private func handleLocation(_ loc: CLLocation) {
        lastLocation = loc
        // Sin exigir identificador de sesión: una baliza puede estar grabando
        // antes de que el servidor la dé de alta (ver `intentaAlta`), y esos
        // primeros puntos son justo los que no se pueden perder.
        guard isSharing else { return }
        // Armed standby: don't record/upload anything; just check if it's time to
        // wake into live tracking (a coarse fix arrived, use it as the trigger).
        if isStandby { maybeBeginFromStandby(); return }
        // Time mode: throttle by interval.
        if sendMode == .time {
            guard Date().timeIntervalSince(lastSendAttempt) >= intervalSeconds else { return }
        } else if !tocaGrabarPorDistancia(loc) {
            // Modo distancia: las lecturas llegan todas (ver `configureDistance`)
            // y es AQUÍ donde se decide cuáles se graban. Las que se descartan no
            // se pierden del todo: han servido para lo que más importa, que es
            // mantener la app despierta.
            return
        }
        ingest(loc)
    }

    /**
     Modo distancia: ¿toca grabar esta lectura?

     Sí cuando se han hecho los metros del perfil desde el último punto GRABADO.
     Y sí también cuando ha pasado el latido sin grabar nada —"sigo aquí"—,
     porque un punto cada cinco minutos es lo que hace que el mapa parezca
     congelado y acabe diciendo "sin cobertura" de alguien que está perfectamente.

     El latido vive aquí y no solo en el temporizador de 20 s a propósito: aquel
     se congela con la app suspendida, que es exactamente lo que pasa cuando
     nadie se mueve. A este lo dispara la llegada de una lectura, que es lo único
     que sigue ocurriendo. El temporizador se queda como red de apoyo.
     */
    private func tocaGrabarPorDistancia(_ loc: CLLocation) -> Bool {
        guard let ultimo = lastRecordedFix else { return true }
        // `fixAt` es opcional: sin hora en el punto anterior no hay latido que
        // medir, y la decisión se queda en los metros.
        if let desde = ultimo.fixAt,
           loc.timestamp.timeIntervalSince1970 * 1000 - desde >= heartbeatSeconds * 1000 { return true }
        return TrackingRules.distanceMeters(ultimo.lat, ultimo.lon,
                                            loc.coordinate.latitude, loc.coordinate.longitude) >= distanceMeters
    }

    /// Quality-gate a raw location and record it (the same filters, in the same
    /// order, as Android's `alLlegarLectura`): drop warm-up readings with
    /// hundreds of metres of error, duplicate deliveries, and physically
    /// impossible jumps; and while the displacement stays under the GPS noise,
    /// record the anchored position — "still here, still alive" — instead of
    /// drawing followers a walk that never happened.
    private func ingest(_ loc: CLLocation) {
        let accuracy = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
        guard TrackingRules.acceptableAccuracy(accuracy, hasAny: !trail.isEmpty) else { return }
        let fix = makeFix(from: loc)
        if TrackingRules.isRepeated(previous: lastRecordedFix, new: fix) { return }
        if TrackingRules.impossibleJump(previous: lastRecordedFix, new: fix,
                                        activity: effectiveActivity, declared: activity != nil) { return }
        let toRecord: Fix
        // Primero, ¿manda la nueva por ser mucho mejor? Un ancla puesta con una
        // lectura de antena congela la baliza hasta que su dueño está a dos
        // kilómetros: en la CanFranc eso fue una hora de punto clavado donde no
        // estaba. Ver `TrackingRules.shouldReanchor`.
        if TrackingRules.shouldReanchor(anchor: anchorFix, new: fix) {
            anchorFix = fix
            recordFix(fix)
            Task { await flush() }
            return
        }
        if TrackingRules.hasMovement(anchor: anchorFix, new: fix) {
            anchorFix = fix
            toRecord = fix
        } else {
            heldReadings += 1
            toRecord = TrackingRules.holdPosition(anchor: anchorFix!, new: fix)
        }
        recordFix(toRecord)
        Task { await flush() }
    }

    private func makeFix(from loc: CLLocation) -> Fix {
        // El kilómetro sobre el RECORRIDO, con ventana móvil: sin esto viajaba
        // siempre a nil y nadie —ni el mapa del evento ni los resultados— podía
        // saber por dónde iba nadie ni quién había terminado.
        let km = routeGeometry.flatMap {
            PlanGeometry.projectKm($0, lat: loc.coordinate.latitude, lon: loc.coordinate.longitude,
                                   previousKm: lastRouteKm)
        }
        if let km {
            lastRouteKm = km
            // Meta con margen: el GPS no clava el último metro y el arco nunca
            // cae en el punto exacto del GPX, así que exigir el 100% sería no
            // detectarla nunca.
            if let total = routeGeometry?.totalKm, total > 0.5, km >= total * 0.99, !atFinish {
                atFinish = true
            }
        }
        return Fix(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            trackKm: km,
            speed: loc.speed >= 0 ? loc.speed : nil,
            heading: loc.course >= 0 ? loc.course : nil,
            accuracy: loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil,
            altitude: loc.verticalAccuracy >= 0 ? loc.altitude : nil,
            fixAt: loc.timestamp.timeIntervalSince1970 * 1000
        )
    }

    /// Queue a (already quality-gated) fix: recorded locally first; the upload
    /// is a separate, retried step so nothing is lost without coverage.
    private func recordFix(_ fix: Fix) {
        lastSendAttempt = Date()
        pending.append(fix)
        if pending.count > 10_000 { pending.removeFirst(pending.count - 10_000) }
        persistPending()
        appendTrail(fix)
    }

    /// Append the fix to the retained full trail (bounded like the server), persist
    /// it, and push the fresh snapshot to the local offline viewer.
    private func appendTrail(_ fix: Fix) {
        lastRecordedFix = fix
        trail.append(TrailPoint(
            t: fix.fixAt ?? Date().timeIntervalSince1970 * 1000,
            lat: fix.lat, lon: fix.lon,
            a: fix.accuracy.map { Int($0.rounded()) }
        ))
        downsampleTrail()
        persistTrail()
        publishToViewer()
    }

    /// Halve the trail keeping the newest point, mirroring the server's downsample
    /// (functions/api/track/[id]/ping.ts) so the local route matches followers'.
    private func downsampleTrail() {
        while trail.count > trailMax {
            let latest = trail.last
            trail = trail.enumerated().filter { $0.offset % 2 == 0 }.map { $0.element }
            if let l = latest, trail.last?.t != l.t { trail.append(l) }
        }
    }

    private func wireFix(_ f: Fix) -> TrackFixWire {
        TrackFixWire(
            lat: f.lat, lon: f.lon, trackKm: f.trackKm, speed: f.speed,
            heading: f.heading, accuracy: f.accuracy, altitude: f.altitude,
            fixAt: f.fixAt, updatedAt: f.fixAt ?? Date().timeIntervalSince1970 * 1000
        )
    }

    /// Push the real position, the last reported position, and the full trail to
    /// the local viewer (so the map can show the offline gap between the two).
    /// Cómo va la emisión, para el punto de la pastilla del visor (ver
    /// `emisionVista` en `LiveViewer.tsx`). Se refresca con cada punto, con
    /// cada cambio de la cola y en cada tic del reloj de envío, porque además
    /// envejece sola.
    private func publicaEmision() {
        guard let t = claveDeDatos else { return }
        ViewerDataProvider.shared.setEmision(token: t, isSharing ? estadoDeEmision().rawValue : nil)
    }

    private func publishToViewer() {
        publicaEmision()
        guard let t = claveDeDatos else { return }
        ViewerDataProvider.shared.update(token: t, fix: lastRecordedFix.map(wireFix), reportedFix: lastReportedFix, trail: trail)
    }

    private func persistTrail() {
        guard let t = claveDeDatos else { return }
        if let data = try? JSONEncoder().encode(trail) {
            try? data.write(to: LocalStore.trailURL(t), options: .atomic)
        }
    }

    private func loadTrail(_ token: String) {
        if let data = try? Data(contentsOf: LocalStore.trailURL(token)),
           let arr = try? JSONDecoder().decode([TrailPoint].self, from: data) {
            trail = arr
        } else {
            trail = []
        }
    }

    // MARK: Field notes

    /// URL-safe random id (mirrors shared `genId`): 16 random bytes as base64url.
    /// Client-generated so the note id passes the server regex and the create is
    /// idempotent across offline retries.
    private static func genId(_ bytes: Int = 16) -> String {
        let raw = Data((0..<bytes).map { _ in UInt8.random(in: 0...255) })
        return raw.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Cumulative distance travelled so far (metres), summed over the retained
    /// trail with the shared noise rule — a segment under the GPS uncertainty
    /// of its two readings adds nothing, so a note's km mark doesn't inflate
    /// while standing still (mirror of Android's `distanciaTraza`).
    private func trailDistanceMeters() -> Double {
        TrackingRules.trailDistanceMeters(trail)
    }

    /// Anchor a note to the CURRENT position and queue it (recorded locally first;
    /// the upload is retried like fixes, so a note taken with no coverage isn't
    /// lost). `text` may be empty when the note is just a typed POI (e.g. "Agua").
    /// Optional `audioURL` (a temp .m4a recording) / `photoData` (JPEG) are stored
    /// locally and uploaded after the note row exists server-side.
    func addNote(text: String, type: String, audioURL: URL? = nil, photoData: Data? = nil) {
        guard let t = claveDeDatos else { return }
        let loc = lastLocation
        guard let lat = loc?.coordinate.latitude ?? lastRecordedFix?.lat,
              let lon = loc?.coordinate.longitude ?? lastRecordedFix?.lon else {
            lastError = "Aún no hay posición GPS para anclar la nota."
            return
        }
        let acc = loc.flatMap { $0.horizontalAccuracy >= 0 ? $0.horizontalAccuracy : nil } ?? lastRecordedFix?.accuracy
        let alt = loc.flatMap { $0.verticalAccuracy >= 0 ? $0.altitude : nil } ?? lastRecordedFix?.altitude
        let noteId = Self.genId()
        let audioKey = audioURL.flatMap { saveMedia(noteId: noteId, kind: "audio", sourceFile: $0, data: nil) }
        let photoKey = photoData.flatMap { saveMedia(noteId: noteId, kind: "photo", sourceFile: nil, data: $0) }
        let note = Note(
            id: noteId,
            createdAt: Date().timeIntervalSince1970 * 1000,
            fixAt: loc.map { $0.timestamp.timeIntervalSince1970 * 1000 } ?? lastRecordedFix?.fixAt,
            lat: lat, lon: lon,
            accuracy: acc, altitude: alt,
            trackKm: nil,
            distM: trailDistanceMeters(),
            title: nil,
            body: text.isEmpty ? nil : text,
            poiType: type,
            poiSym: nil,
            audioKey: audioKey, photoKey: photoKey
        )
        notes.append(note)
        pendingNotes.append(note)
        noteCount = notes.count
        persistNotes()
        persistPendingNotes()
        ViewerDataProvider.shared.setNotes(token: t, notes: notes)
        Task { await flushNotes(); await flushMedia() }
    }

    /// Remove a note immediately from local UI/storage and queue the owner-only
    /// backend deletion. The tombstone prevents an in-flight offline create from
    /// making the note reappear when coverage returns.
    func deleteNote(_ note: Note) async {
        guard let id = claveDeDatos else { return }
        notes.removeAll { $0.id == note.id }
        pendingNotes.removeAll { $0.id == note.id }
        pendingMedia.removeAll { $0.noteId == note.id }
        if !pendingNoteDeletes.contains(note.id) { pendingNoteDeletes.append(note.id) }

        for kind in ["audio", "photo"] {
            let file = LocalStore.mediaFileURL(id, "\(note.id)_\(kind).\(mediaExt(kind))")
            try? FileManager.default.removeItem(at: file)
        }

        noteCount = notes.count
        persistNotes()
        persistPendingNotes()
        persistPendingMedia()
        persistPendingNoteDeletes()
        ViewerDataProvider.shared.setNotes(token: id, notes: notes)
        await flushNoteDeletes()
    }

    private func mediaExt(_ kind: String) -> String { kind == "audio" ? "m4a" : "jpg" }

    /// Persist a note's media locally and queue it for upload. Audio comes as a
    /// temp file (moved in); photo as in-memory bytes (written out).
    private func saveMedia(noteId: String, kind: String, sourceFile: URL?, data: Data?) -> String? {
        guard let t = claveDeDatos else { return nil }
        let name = "\(noteId)_\(kind).\(mediaExt(kind))"
        let dest = LocalStore.mediaFileURL(t, name)
        do {
            try? FileManager.default.removeItem(at: dest)
            if let sourceFile {
                try FileManager.default.copyItem(at: sourceFile, to: dest)
                try? FileManager.default.removeItem(at: sourceFile)
            } else if let data {
                try data.write(to: dest, options: .atomic)
            } else {
                return nil
            }
        } catch {
            return nil  // media failed to save; the note text/type is still queued
        }
        pendingMedia.append(MediaUpload(noteId: noteId, kind: kind, file: name))
        persistPendingMedia()
        return name
    }

    private func mediaPendingKey(_ token: String) -> String { "pendingMedia-\(token)" }

    private func persistPendingMedia() {
        guard let t = claveDeDatos else { return }
        if let data = try? JSONEncoder().encode(pendingMedia) {
            UserDefaults.standard.set(data, forKey: mediaPendingKey(t))
        }
    }

    private func loadPendingMedia(_ token: String) {
        if let data = UserDefaults.standard.data(forKey: mediaPendingKey(token)),
           let arr = try? JSONDecoder().decode([MediaUpload].self, from: data) {
            pendingMedia = arr
        } else {
            pendingMedia = []
        }
    }

    /// Upload queued media whose note row already exists server-side (i.e. not in
    /// pendingNotes). Drop each queue item on success, retaining the local file for
    /// the offline viewer; keep failures to retry. A 410 means the session ended.
    private func flushMedia() async {
        guard isSharing, let id = sessionToken, !isFlushingMedia, !pendingMedia.isEmpty else { return }
        isFlushingMedia = true
        defer { isFlushingMedia = false }
        let notCreated = Set(pendingNotes.map { $0.id })
        let batch = pendingMedia
        var uploaded = false
        for item in batch where !notCreated.contains(item.noteId) {
            let fileURL = LocalStore.mediaFileURL(id, item.file)
            guard let data = try? Data(contentsOf: fileURL) else {
                pendingMedia.removeAll { $0.noteId == item.noteId && $0.kind == item.kind }
                persistPendingMedia()
                continue
            }
            do {
                let ct = item.kind == "audio" ? "audio/mp4" : "image/jpeg"
                try await API.uploadNoteMedia(token: token, sessionId: id, noteId: item.noteId, kind: item.kind, data: data, contentType: ct)
                pendingMedia.removeAll { $0.noteId == item.noteId && $0.kind == item.kind }
                persistPendingMedia()
                uploaded = true
            } catch {
                if let e = error as? APIError, e.status == 410 {
                    await stopSharing()
                    return
                }
                break  // no coverage / transient — keep for retry
            }
        }
        // A completed upload changed our server-side use; refresh the meter once.
        if uploaded { await refreshStorage() }
    }

    private func persistNotes() {
        guard let t = claveDeDatos else { return }
        if let data = try? JSONEncoder().encode(notes) {
            try? data.write(to: LocalStore.notesURL(t), options: .atomic)
        }
    }

    private func loadNotes(_ token: String) {
        if let data = try? Data(contentsOf: LocalStore.notesURL(token)),
           let arr = try? JSONDecoder().decode([Note].self, from: data) {
            notes = arr
        } else {
            notes = []
        }
        noteCount = notes.count
    }

    private func notesPendingKey(_ token: String) -> String { "pendingNotes-\(token)" }

    private func persistPendingNotes() {
        guard let t = claveDeDatos else { return }
        if let data = try? JSONEncoder().encode(pendingNotes) {
            UserDefaults.standard.set(data, forKey: notesPendingKey(t))
        }
    }

    private func loadPendingNotes(_ token: String) {
        if let data = UserDefaults.standard.data(forKey: notesPendingKey(token)),
           let arr = try? JSONDecoder().decode([Note].self, from: data) {
            pendingNotes = arr
        } else {
            pendingNotes = []
        }
    }

    private func noteDeletesPendingKey(_ token: String) -> String { "pendingNoteDeletes-\(token)" }

    private func persistPendingNoteDeletes() {
        guard let token = claveDeDatos else { return }
        UserDefaults.standard.set(pendingNoteDeletes, forKey: noteDeletesPendingKey(token))
    }

    private func loadPendingNoteDeletes(_ token: String) {
        pendingNoteDeletes = UserDefaults.standard.stringArray(forKey: noteDeletesPendingKey(token)) ?? []
    }

    private func flushNoteDeletes() async {
        guard isSharing, let id = sessionToken,
              !isFlushingNotes, !isFlushingNoteDeletes, !pendingNoteDeletes.isEmpty else { return }
        isFlushingNoteDeletes = true
        defer { isFlushingNoteDeletes = false }

        for noteId in pendingNoteDeletes {
            do {
                try await API.deleteNote(token: token, sessionId: id, noteId: noteId)
                pendingNoteDeletes.removeAll { $0 == noteId }
                persistPendingNoteDeletes()
            } catch {
                if let apiError = error as? APIError, apiError.status == 404 {
                    pendingNoteDeletes.removeAll { $0 == noteId }
                    persistPendingNoteDeletes()
                    continue
                }
                break
            }
        }
    }

    /// Upload queued notes one by one; drop each on success, keep the rest on
    /// failure (no coverage) to retry next tick. A 410 means the session ended.
    private func flushNotes() async {
        guard isSharing, let id = sessionToken, !isFlushingNotes, !pendingNotes.isEmpty else { return }
        isFlushingNotes = true
        defer { isFlushingNotes = false }
        let batch = pendingNotes
        for note in batch {
            do {
                try await API.createNote(token: token, sessionId: id, note: note)
                pendingNotes.removeAll { $0.id == note.id }
                persistPendingNotes()
            } catch {
                if let e = error as? APIError, e.status == 410 {
                    await stopSharing()
                    return
                }
                break  // no coverage / transient — keep the rest queued
            }
        }
    }

    /// Fetch + decode a saved plan's route polyline so its map corridor can be
    /// pre-downloaded BEFORE sharing (the night before). Needs connectivity; nil
    /// offline or on error.
    /// El recorrido del EVENTO elegido (la base que publicó la organización).
    /// Sirve para preparar el mapa cuando no se ha elegido previsión propia:
    /// "la del evento" es un recorrido como cualquier otro, solo que vive en el
    /// evento y no en tus previsiones.
    func eventPolyline() async -> [(lat: Double, lon: Double)]? {
        guard let shareId = activeEvent?.planShareId ?? events.first(where: { $0.id == selectedEventId })?.planShareId,
              let bytes = try? await API.fetchSharePayload(shareId: shareId) else { return nil }
        refreshSessionPlan(bytes)
        return PlanGeometry.polyline(fromGzip: bytes)
    }

    func planPolyline(for planId: String) async -> [(lat: Double, lon: Double)]? {
        guard let bytes = try? await API.fetchPlanPayload(token: token, planId: planId) else { return nil }
        refreshSessionPlan(bytes)
        return PlanGeometry.polyline(fromGzip: bytes)
    }

    /// Guarda como recorrido de la sesión en marcha el que se acaba de bajar.
    ///
    /// Los dos de arriba solo se llaman desde la pantalla del mapa offline, que
    /// para calcular el corredor de teselas necesita el recorrido VIGENTE y se
    /// lo baja de todas formas. Aprovecharlo sale gratis y arregla un caso real:
    /// si la organización cambia el trazado —la alternativa por mal tiempo— la
    /// baliza se quedaba con el viejo, porque lo guarda al abrir la sesión y no
    /// lo vuelve a mirar. Así basta con entrar a preparar el mapa, que es lo que
    /// vas a hacer igualmente, en vez de cerrar la baliza y volverla a abrir.
    ///
    /// Android hace esto desde siempre, sin pretenderlo. Esto es igualarlo: dos
    /// apps que se usan en la misma carrera no pueden pedir cosas distintas.
    private func refreshSessionPlan(_ bytes: Data) {
        guard let sessionId = sessionToken else { return }
        try? bytes.write(to: LocalStore.planURL(sessionId), options: .atomic)
        loadRouteGeometry(for: sessionId)
    }

    /// Best-effort: fetch the linked plan's gzipped bytes once (online) and cache
    /// them so the offline viewer can overlay the planned route. Never blocks
    /// sharing; if offline it simply won't be available until refetched.
    private func cachePlanBytes(for sessionId: String, planId: String?) {
        Task {
            // La previsión propia manda; si no hay, la del evento, que es un
            // recorrido como cualquier otro solo que vive en la carrera. Antes
            // solo se guardaba la propia, así que quien corría "con la del
            // evento" se quedaba sin recorrido con el que medir nada.
            var bytes: Data?
            if let planId {
                bytes = try? await API.fetchPlanPayload(token: token, planId: planId)
            } else if let shareId = activeEvent?.planShareId {
                bytes = try? await API.fetchSharePayload(shareId: shareId)
            }
            guard let bytes else { return }
            try? bytes.write(to: LocalStore.planURL(sessionId), options: .atomic)
            await MainActor.run { self.loadRouteGeometry(for: sessionId) }
        }
    }

    /**
     Deja el recorrido en memoria para poder decir por qué kilómetro va quien
     corre.

     Se hace una vez por sesión: descomprimir el trazado y acumular kilómetros
     en cada lectura del GPS sería tirar batería justo en lo que más la cuida.
     */
    private func loadRouteGeometry(for sessionId: String) {
        routeGeometry = PlanGeometry.route(forSession: sessionId)
        lastRouteKm = nil
    }

    // MARK: Resume-on-relaunch ("last known state")

    /// The "last known state" of an active beacon, persisted so a relaunch (app
    /// killed by iOS, phone restart, cold start with no coverage) resumes it — the
    /// beacon must survive without the user re-doing anything. Cleared only on an
    /// explicit stop / delete.
    private struct ActiveSessionState: Codable {
        let token: String
        let sendMode: String
        let intervalSeconds: Double
        let distanceMeters: Double
        let profile: String
        let retainHours: Double
        let startAtMs: Double
        let planName: String?
        /// El nombre de la salida. Opcional para que un estado guardado antes de
        /// que esto existiera siga decodificando (→ nil).
        let title: String?
        let savedAtMs: Double
        /// Movement type (raw value), nil = Automático. Optional so states saved
        /// before this field decode fine (→ nil).
        let activity: String?
    }

    private let activeKey = "activeSession"
    private var lastActivePersistAt: Date = .distantPast

    /**
     Lo que hace falta para dar de alta una baliza que YA está grabando.

     Se guarda en disco porque el alta puede tardar lo que tarde la cobertura, y
     entre medias el sistema puede matar la app: al volver, se retoma la
     grabación y se sigue insistiendo, sin perder ni la hora de salida ni el
     nombre ni la carrera elegida.
     */
    private struct AltaPendiente: Codable {
        let startAtMs: Double
        let title: String
        let planId: String?
        let eventId: String?
        let activity: String?
        /// Dónde está lo grabado mientras no hay identificador de servidor.
        /// Opcional: las altas guardadas por versiones anteriores no la traen.
        var clave: String?
    }

    private static let altaKeyValor = "baliza.altaPendiente"
    private var altaKey: String { Self.altaKeyValor }

    private func guardaAltaPendiente() {
        guard let alta = altaPendiente, let data = try? JSONEncoder().encode(alta) else { return }
        UserDefaults.standard.set(data, forKey: altaKey)
    }

    private func cargaAltaPendiente() -> AltaPendiente? {
        guard let data = UserDefaults.standard.data(forKey: altaKey) else { return nil }
        return try? JSONDecoder().decode(AltaPendiente.self, from: data)
    }

    /// Reescribe bajo el identificador del servidor lo que se grabó bajo la
    /// clave provisional, y borra esta. Los datos ya están en memoria, así que
    /// basta con volver a guardarlos; no hay que mover ficheros.
    private func reescribeBajoLaClaveBuena(desde provisional: String?) {
        persistPending()
        persistTrail()
        persistNotes()
        persistPendingNotes()
        persistPendingNoteDeletes()
        persistPendingMedia()
        guard let provisional else { return }
        // El media sí son ficheros: se mueven uno a uno al directorio bueno.
        if let t = sessionToken {
            let fm = FileManager.default
            let origen = LocalStore.mediaDir(provisional)
            for url in (try? fm.contentsOfDirectory(at: origen, includingPropertiesForKeys: nil)) ?? [] {
                let destino = LocalStore.mediaFileURL(t, url.lastPathComponent)
                try? fm.removeItem(at: destino)
                try? fm.moveItem(at: url, to: destino)
            }
        }
        borraRastroLocal(provisional)
    }

    /// Olvida la clave provisional y todo lo que dejó en disco.
    private func limpiaLocal() {
        guard let clave = claveLocal else { return }
        claveLocal = nil
        borraRastroLocal(clave)
    }

    private func borraRastroLocal(_ clave: String) {
        LocalStore.remove(clave)
        UserDefaults.standard.removeObject(forKey: pendingKey(clave))
        UserDefaults.standard.removeObject(forKey: notesPendingKey(clave))
        UserDefaults.standard.removeObject(forKey: noteDeletesPendingKey(clave))
        UserDefaults.standard.removeObject(forKey: mediaPendingKey(clave))
    }

    private func olvidaAltaPendiente() {
        altaPendiente = nil
        pendienteDeAlta = false
        UserDefaults.standard.removeObject(forKey: altaKey)
    }

    private func persistActive() {
        guard isSharing, let t = sessionToken else { return }
        lastActivePersistAt = Date()
        let s = ActiveSessionState(
            token: t, sendMode: sendMode.rawValue, intervalSeconds: intervalSeconds,
            distanceMeters: distanceMeters, profile: profile.rawValue, retainHours: retainHours,
            startAtMs: startAt.timeIntervalSince1970 * 1000, planName: activePlanName,
            title: activeTitle,
            savedAtMs: Date().timeIntervalSince1970 * 1000, activity: activity?.rawValue)
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: activeKey) }
    }

    /// Keep `savedAt` fresh through a long outing (so the staleness guard doesn't
    /// drop a genuinely long race). Cheap; throttled well below the flush cadence.
    private func persistActiveIfDue() {
        guard isSharing, Date().timeIntervalSince(lastActivePersistAt) >= 120 else { return }
        persistActive()
    }

    private func clearActive() { UserDefaults.standard.removeObject(forKey: activeKey) }

    /// On launch, resume the last active beacon (if it wasn't explicitly stopped),
    /// restoring cadence/mode/route and reconnecting to the SAME session. Offline
    /// it buffers; if the server already ended the session a ping's 410 stops it.
    func restoreActiveSession() {
        guard !isSharing, sessionToken == nil else { return } // don't clobber a live one

        // ¿Una baliza que arrancó sin cobertura y a la que el sistema mató antes
        // de que entrara el alta? Se retoma la grabación y se sigue insistiendo.
        // NO se tocan los buffers: lo grabado hasta ahora es exactamente lo que
        // hay que subir cuando el alta entre.
        if UserDefaults.standard.data(forKey: activeKey) == nil, let alta = cargaAltaPendiente() {
            let inicio = Date(timeIntervalSince1970: alta.startAtMs / 1000)
            // Más allá de una salida larga, se abandona: reanudar una baliza de
            // anteayer no es continuar nada.
            guard Date().timeIntervalSince(inicio) < 20 * 3600 else {
                if let clave = alta.clave { borraRastroLocal(clave) }
                olvidaAltaPendiente(); return
            }
            altaPendiente = alta
            pendienteDeAlta = true
            activeTitle = alta.title
            // La misma clave de antes: de ahí salen los puntos grabados sin
            // cobertura que todavía no ha visto el servidor.
            claveLocal = alta.clave
            if let clave = alta.clave {
                loadPending(clave)
                loadTrail(clave)
                loadNotes(clave)
                loadPendingNotes(clave)
                loadPendingNoteDeletes(clave)
                loadPendingMedia(clave)
                pendingCount = pending.count
                noteCount = notes.count
                ViewerDataProvider.shared.register(
                    token: clave, title: alta.title,
                    startedAt: alta.startAtMs, expiresAt: 0, status: "active",
                )
                ViewerDataProvider.shared.setNotes(token: clave, notes: notes)
                let ultimo = trail.last.map {
                    TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil,
                                 accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t)
                }
                ViewerDataProvider.shared.update(token: clave, fix: ultimo, reportedFix: nil, trail: trail)
            }
            isSharing = true
            isStandby = false
            applyLocationConfig()
            location.requestAuthorization()
            location.start()
            startFlushTimer()
            Task { await intentaAlta() }
            return
        }
        guard let data = UserDefaults.standard.data(forKey: activeKey),
              let s = try? JSONDecoder().decode(ActiveSessionState.self, from: data) else { return }
        // Past any plausible outing → drop it (avoids resuming a days-old session).
        if Date().timeIntervalSince1970 * 1000 - s.savedAtMs > 20 * 3600 * 1000 { clearActive(); return }

        // Restore the exact cadence/mode it was running with.
        sendMode = SendMode(rawValue: s.sendMode) ?? .distance
        intervalSeconds = s.intervalSeconds
        distanceMeters = s.distanceMeters
        profile = SendProfile(rawValue: s.profile) ?? .custom
        retainHours = s.retainHours
        startAt = Date(timeIntervalSince1970: s.startAtMs / 1000)
        startAtTouched = true
        activePlanName = s.planName
        activeTitle = s.title
        activity = s.activity.flatMap(BeaconActivity.init(rawValue:))

        sessionToken = s.token
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
        lastReportedFix = nil
        anchorFix = nil
        heldReadings = 0
        loadPending(s.token)   // offline backlog recorded before the relaunch
        loadTrail(s.token)     // full route for the offline viewer
        loadNotes(s.token)
        loadPendingNotes(s.token)
        loadPendingNoteDeletes(s.token)
        loadPendingMedia(s.token)
        ViewerDataProvider.shared.register(token: s.token, title: s.title, startedAt: s.startAtMs, expiresAt: 0, status: "active")
        ViewerDataProvider.shared.setActivity(token: s.token, activity: activity)
        let lastFix = trail.last.map { TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil, accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t) }
        ViewerDataProvider.shared.update(token: s.token, fix: lastFix, reportedFix: nil, trail: trail)
        ViewerDataProvider.shared.setNotes(token: s.token, notes: notes)

        // El recorrido ya está en disco de cuando empezó: sin esto, reanudar
        // tras un cierre de la app dejaba de calcular el kilómetro a mitad de
        // carrera.
        loadRouteGeometry(for: s.token)

        // Re-arm standby if the planned start is still ahead; else resume live.
        if startAt.timeIntervalSinceNow > TrackingRules.startLeadSeconds {
            isStandby = true
            location.configureStandby()
            // Reanudar tras un cierre de la app rehace también los avisos: los
            // programados antes siguen en pie —son del sistema— pero volver a
            // ponerlos es idempotente y cubre el caso de que se cambiara la hora.
            AvisosDeCarrera.programaSalida(startAt, carrera: s.title)
        } else {
            isStandby = false
            applyLocationConfig()
        }
        location.requestAuthorization()
        location.start()
        startFlushTimer()
        persistActive()
    }

    /// Upload the whole buffered backlog in one batch. On failure (no coverage)
    /// the backlog is KEPT and retried; on success only the sent prefix is removed
    /// (fixes appended during the upload stay queued).
    private func flush() async {
        guard isSharing, let id = sessionToken, !isFlushing, !pending.isEmpty else { return }
        isFlushing = true
        defer { isFlushing = false }
        let batch = pending
        do {
            let viewers = try await API.pingBatch(token: token, id: id, fixes: batch)
            if pending.count >= batch.count { pending.removeFirst(batch.count) } else { pending.removeAll() }
            persistPending()
            lastSentAt = Date()
            pingCount += batch.count
            activeViewers = viewers
            lastError = nil
            // The newest fix in the delivered batch is now what followers see.
            if let last = batch.last {
                var rf = wireFix(last)
                rf.updatedAt = Date().timeIntervalSince1970 * 1000
                lastReportedFix = rf
                publishToViewer()
            }
        } catch {
            if let e = error as? APIError, e.status == 410 {
                await stopSharing() // session ended/expired on the server
            } else {
                lastError = "Sin cobertura: \(pending.count) posiciones en cola; se enviarán al recuperarla."
            }
        }
    }

    private func pendingKey(_ token: String) -> String { "pendingFixes-\(token)" }

    private func persistPending() {
        pendingCount = pending.count
        colaDesdeMs = pending.first?.fixAt
        publicaEmision()
        guard let t = claveDeDatos else { return }
        if let data = try? JSONEncoder().encode(pending) {
            UserDefaults.standard.set(data, forKey: pendingKey(t))
        }
    }

    private func loadPending(_ token: String) {
        if let data = UserDefaults.standard.data(forKey: pendingKey(token)),
           let arr = try? JSONDecoder().decode([Fix].self, from: data) {
            pending = arr
        } else {
            pending = []
        }
        pendingCount = pending.count
    }

    /// Distance-mode heartbeat: still emit at least this often when stationary,
    /// so followers don't see a frozen "lost signal".
    private let heartbeatSeconds: TimeInterval = 150

    /**
     Cómo se llama una sesión cuando hay que hablar de ella.

     Manda el EVENTO por encima de la ruta: una baliza unida a una carrera es
     "la Urbión", no "urbion-37k-v3.gpx". El nombre de la ruta es de archivo
     —lleva versiones, fechas y la coletilla de la organización— y no es como se
     llama esa salida entre quienes la corren.
     */
    /**
     Cómo se llama este aparato, para que el otro móvil sepa quién le quitó la
     baliza.

     Desde iOS 16 el sistema no da el nombre que le puso su dueño salvo con un
     permiso especial: `UIDevice.name` devuelve el modelo ("iPhone"). Se le pega
     el identificador de hardware, que sí distingue un iPhone 14 de un 16 —que
     es de lo que se trata cuando alguien tiene dos—.
     */
    static let deviceName: String = {
        var sys = utsname()
        uname(&sys)
        let modelo = withUnsafePointer(to: &sys.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(validatingUTF8: $0) ?? "" }
        }
        let nombre = UIDevice.current.name
        return modelo.isEmpty || nombre.contains(modelo) ? nombre : "\(nombre) (\(modelo))"
    }()

    /// Cómo se llama una salida en el listado. El título mandado por el dueño
    /// va primero: desde que el servidor hereda el nombre del evento al crear
    /// la sesión, ese título YA es el de la carrera, y renombrar a mano tiene
    /// que poder ganarle. El evento queda de respaldo para las sesiones
    /// anteriores a la herencia, y el nombre del recorrido para las sueltas.
    /// `fallback`: qué poner cuando la salida no tiene de dónde sacar nombre.
    /// En el listado es "Sin nombre" —ahí la falta de nombre es el dato—, pero
    /// como título de una pantalla de mapa eso se lee mal.
    func labelForSession(_ s: TrackSessionSummary, fallback: String = "Sin nombre") -> String {
        if let t = s.title, !t.isEmpty { return t }
        if let id = s.eventId, let name = eventNames[id] { return name }
        return s.planName ?? fallback
    }

    /// La sesión viva de esta cuenta que NO es la de este móvil, si la hay.
    ///
    /// Sale del listado propio del dueño, que ya se usa en "Mis seguimientos":
    /// una petición pequeña y sin GPS. Si no hay cobertura no se inventa nada
    /// —devuelve nil— y se arranca: quedarse sin salir por no poder comprobar
    /// algo sería el peor de los dos fallos.
    private func activeElsewhere() async -> TrackSessionSummary? {
        guard let all = try? await API.listSessions(token: token) else { return nil }
        return all.first { $0.status == "active" && $0.id != sessionToken }
    }

    /**
     Mientras está ARMADA, comprobar de vez en cuando que la sesión sigue siendo
     suya.

     Una baliza armada calla a propósito hasta la hora de salida, así que nunca
     recibe el 410 que le diría que el servidor la cerró —lo que pasa en cuanto
     otro móvil de la misma cuenta arma la suya—. Sin esto se queda enseñando
     "armado" para siempre mientras el mapa la da por desconectada, que es
     justo lo que no puede pasar en la línea de salida.

     Cada dos minutos y sin GPS: no rompe el ahorro de batería que justifica el
     modo armado.
     */
    private func checkStillOurs() async {
        guard isSharing, isStandby, let id = sessionToken else { return }
        guard Date().timeIntervalSince(lastArmedCheck) >= armedCheckSeconds else { return }
        lastArmedCheck = Date()
        guard let all = try? await API.listSessions(token: token) else { return }
        guard let mine = all.first(where: { $0.id == id }) else { return }
        if mine.status != "active" {
            // Quién se la quitó: la sesión viva de la cuenta, que es la que la
            // cerró. Con su nombre de aparato la nota deja de ser un misterio
            // —"¿desde dónde me la he quitado?"— y pasa a ser un dato.
            let quien = all.first { $0.status == "active" }?.device
            await stopSharing()
            takeoverNote = quien != nil
                ? "Otra baliza tomó el relevo desde «\(quien!)» y esta dejó de emitir."
                : "Otra baliza tuya tomó el relevo y esta dejó de emitir."
        }
    }

    /// Cada cuánto comprueba una baliza armada que sigue siendo la buena.
    private let armedCheckSeconds: TimeInterval = 120
    private var lastArmedCheck = Date.distantPast

    /// How early (before the planned start) standby switches to live tracking.
    /// A small margin absorbs clock drift between the phone and the organisation.

    /// While armed, switch to live tracking once we're within the lead margin of
    /// the planned start: apply the real profile and push an immediate first fix.
    private func maybeBeginFromStandby() {
        guard isStandby else { return }
        guard Date() >= startAt.addingTimeInterval(-TrackingRules.startLeadSeconds) else { return }
        isStandby = false
        applyLocationConfig()           // full profile (GPS + interval/distance)
        lastSendAttempt = .distantPast  // don't throttle the first live fix
        anchorFix = nil                 // the standby fix is coarse; re-anchor live
        // Y la de espera NO se ingiere si es basta, que es lo normal: el modo
        // espera posiciona por antena y entrega errores de cientos de metros o
        // de kilómetros. Ingerirla aquí deshacía el `anchorFix = nil` de la
        // línea de arriba —volvía a anclar con ella— y dejaba la baliza
        // congelada justo en la salida. Si es buena, se aprovecha: adelanta la
        // primera posición sin esperar al GPS.
        if let loc = lastLocation,
           loc.horizontalAccuracy >= 0,
           loc.horizontalAccuracy <= TrackingRules.anchorMaxAccuracyM {
            ingest(loc)
        }
    }

    /// Sample the battery and update the measured drain + autonomy estimate.
    /// Battery level on iOS is coarse (~5% steps), so we average over a rolling
    /// window and smooth, and only publish a rate once it's meaningful. While
    /// charging we reset the baseline (drain isn't meaningful plugged in).
    /// Throttled wrapper for the periodic timer: only actually samples every
    /// `batterySampleInterval`, so the 20 s flush tick doesn't oversample.
    private func sampleBatteryIfDue() {
        guard Date().timeIntervalSince(lastBatterySampleAt) >= batterySampleInterval else { return }
        sampleBattery()
    }

    private func sampleBattery() {
        lastBatterySampleAt = Date()
        let device = UIDevice.current
        let level = Double(device.batteryLevel) // -1 if unknown
        let charging = device.batteryState == .charging || device.batteryState == .full
        batteryLevel = level
        isCharging = charging
        // Y viaja en el ping: en el móvil solo sirve para mirarla, y la pregunta
        // "¿le va a durar?" se la hace quien sigue la carrera, no quien corre.
        API.bateria = level >= 0 ? Int((level * 100).rounded()) : nil
        guard level >= 0 else { batteryDrainPerHour = nil; estimatedHoursRemaining = nil; return }
        let now = Date()
        if charging {
            batterySamples = [(now, level)]
            batteryDrainPerHour = nil
            estimatedHoursRemaining = nil
            return
        }
        batterySamples.append((now, level))
        let cutoff = now.addingTimeInterval(-45 * 60) // rolling 45-min window
        batterySamples.removeAll { $0.t < cutoff }
        guard let first = batterySamples.first, batterySamples.count >= 2 else { return }
        let hours = now.timeIntervalSince(first.t) / 3600
        let dropPct = (first.level - level) * 100
        // Need ≥10 min and a measurable drop, else the coarse steps give noise.
        guard hours >= 10.0 / 60.0, dropPct >= 1 else { return }
        let rate = dropPct / hours
        let smoothed = batteryDrainPerHour.map { $0 * 0.6 + rate * 0.4 } ?? rate
        batteryDrainPerHour = smoothed
        estimatedHoursRemaining = smoothed > 0 ? (level * 100) / smoothed : nil
    }

    /**
     Los perfiles, y por qué el de ahorro ya no manda cada quinientos metros.

     Lo que gasta batería es **tener el receptor encendido y afinado**, no
     cuántas veces te entrega una posición: el `distanceFilter` solo decide
     cuándo te avisa, no apaga el GPS. El ahorro de verdad está en la PRECISIÓN
     pedida —con `HundredMeters` el sistema se apoya en antenas y wifi y dosifica
     el GPS—, y eso lo decide `configureDistance` a partir de los metros.

     Los dos ajustes iban juntos en el mismo botón sin necesidad, y el resultado
     se vio en la CanFranc: una baliza en ahorro mandó 35 posiciones en catorce
     horas, con 501 m de mediana entre ellas. Con eso no se sabe por dónde va
     nadie —su último punto quedó casi un kilómetro por detrás de donde dio la
     vuelta— y encima el mapa la daba por perdida cada rato.

     Ciento cincuenta metros conserva TODO el ahorro (misma precisión pedida,
     misma dosificación del GPS) y multiplica por tres la traza: a 4 km/h son
     poco más de dos minutos entre lecturas. Lo que cuesta son unos cientos de
     peticiones más en una ultra, que al lado del receptor es calderilla.
     */
    func selectProfile(_ p: SendProfile) {
        profile = p
        switch p {
        case .balanced: sendMode = .distance; distanceMeters = 100
        case .saver: sendMode = .distance; distanceMeters = 150
        case .precision: sendMode = .time; intervalSeconds = 10
        case .custom: break
        }
    }

    // MARK: Activity type

    /// Set/clear the beacon's movement type (works before AND during sharing).
    /// Persists it, tells the server when live, and refreshes the embedded viewer
    /// so it reformats the speed and shows the icon immediately.
    func setActivity(_ newActivity: BeaconActivity?) {
        activity = newActivity
        guard isSharing, let t = sessionToken else { return }
        ViewerDataProvider.shared.setActivity(token: t, activity: newActivity)
        persistActive()
        Task { await API.setActivity(token: token, id: t, activity: newActivity) }
    }

    /// The activity shown in the UI: the declared one, or — when "Automático" —
    /// one inferred from the recorded trail (nil until there's enough moving data).
    var effectiveActivity: BeaconActivity? { activity ?? Self.inferActivity(from: trail) }

    /// Best-effort movement type from trail speeds, mirroring
    /// src/lib/activityInference.ts: p85 of the moving-segment speeds, mapped to
    /// walk/run/bike/transport bands. Keeps the on-device "auto" icon in step with
    /// what the viewer would infer.
    private static func inferActivity(from trail: [TrailPoint]) -> BeaconActivity? {
        guard trail.count >= 7 else { return nil }
        var speeds: [Double] = []
        for i in 1..<trail.count {
            let dtH = (trail[i].t - trail[i - 1].t) / 3_600_000 // ms → hours
            guard dtH > 0 else { continue }
            let a = CLLocation(latitude: trail[i - 1].lat, longitude: trail[i - 1].lon)
            let b = CLLocation(latitude: trail[i].lat, longitude: trail[i].lon)
            let kmh = (b.distance(from: a) / 1000) / dtH
            if kmh < 1.5 || kmh > 430 { continue } // stopped or GPS teleport
            speeds.append(kmh)
        }
        guard speeds.count >= 6 else { return nil }
        speeds.sort()
        let p85 = speeds[min(speeds.count - 1, Int(Double(speeds.count) * 0.85))]
        if p85 < 8 { return .walk }
        if p85 < 16 { return .run }
        if p85 < 40 { return .bike }
        return .transport
    }

    private func applyLocationConfig() {
        if sendMode == .time {
            location.configure(interval: intervalSeconds)
        } else {
            location.configureDistance(distanceMeters)
        }
        // Y se le dice al servidor cada cuánto promete hablar esta baliza, para
        // que el mapa sepa cuánto silencio es normal en ella: una que manda cada
        // 500 m no manda nada mientras su dueño está parado, y con el plazo de
        // todos salía "sin cobertura" estando perfecta. Ver `shared/cadencia.ts`.
        API.cadencia = sendMode == .time
            ? "t\(Int(intervalSeconds.rounded()))"
            : "d\(Int(distanceMeters.rounded()))"
    }

    /// In distance mode, force a FRESH fix if we've been still longer than the
    /// heartbeat. We request a one-shot reading (not a resend of `lastLocation`):
    /// while stationary the distance filter delivers no callbacks, so the last
    /// known point can sit up to `distanceMeters` behind the real spot. The fresh
    /// fix arrives via `handleLocation` (which records it). `lastSendAttempt` is
    /// stamped optimistically so the 20 s timer doesn't re-fire every tick while
    /// the fix is in flight; a failed request simply retries at the next heartbeat.
    private func heartbeatTick() {
        guard isSharing, !isStandby, sendMode == .distance else { return }
        guard Date().timeIntervalSince(lastSendAttempt) >= heartbeatSeconds else { return }
        lastSendAttempt = Date()
        location.requestOneShot()
    }

    /// Periodic retry so a backlog flushes when coverage returns even if the
    /// runner is stationary, plus the distance-mode heartbeat.
    private func startFlushTimer() {
        flushTimer?.invalidate()
        batterySamples = []
        sampleBattery() // seed an immediate baseline reading
        flushTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in
                // Primary trigger to leave standby when stationary at the start
                // line (coarse location may deliver no callbacks while still).
                self?.maybeBeginFromStandby()
                self?.publicaEmision()
                await self?.checkStillOurs()
                self?.sampleBatteryIfDue()
                // Los ánimos vienen del servidor (los escriben los seguidores),
                // así que se traen con el mismo pulso que el resto.
                ViewerDataProvider.shared.refreshCheers()
                // Antes del latido: si la pausa venció, lo que toca es volver a
                // emitir, no seguir callado un ciclo más.
                self?.reanudaSiVencioLaPausa()
                // Si arrancó sin cobertura, aquí se insiste con el alta: en
                // cuanto entre, lo grabado se sube entero.
                await self?.intentaAlta()
                self?.heartbeatTick()
                self?.persistActiveIfDue()
                await self?.flush()
                await self?.flushNotes()
                await self?.flushNoteDeletes()
                await self?.flushMedia()
            }
        }
    }
}
