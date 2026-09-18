import SwiftUI
import CoreLocation
import UIKit

struct TrackingView: View {
    /// La sección de la web de una carrera abierta dentro de la app (ver `WebDelEvento`).
    @State private var webEvento: EnlaceWeb?
    /// Si el bloque de carreras terminadas está desplegado.
    @State private var terminadasAbiertas = false
    /// La carrera por la que se pregunta al pulsar "Compartir" sin ninguna elegida.
    @State private var carreraAPreguntar: EventSummary?

    /// Abre una sección de la carrera con la sesión de la app ya pasada a la web.
    private func abrirEvento(_ ev: EventSummary, _ vista: String) {
        Task {
            if let url = await WebDelEvento.enlace(eventId: ev.id, vista: vista, token: Keychain.load()) {
                webEvento = EnlaceWeb(url: url)
            }
        }
    }

    /// La próxima carrera que sale, la única que lleva la cuenta atrás en grande:
    /// con una en cada tarjeta, la lista sería un tablero de relojes.
    private var proximaCarreraId: String? {
        let ahora = Date().timeIntervalSince1970 * 1000
        return store.events
            .filter { ($0.startsAt ?? 0) > ahora }
            .min { ($0.startsAt ?? 0) < ($1.startsAt ?? 0) }?
            .id
    }

    /// "Abrir": las secciones de la carrera en la web, sin pasar por la parrilla.
    private func menuDeCarrera(_ ev: EventSummary) -> some View {
        Menu {
            ForEach(WebDelEvento.secciones(de: ev), id: \.self) { s in
                Button(s.texto) { abrirEvento(ev, s.vista) }
            }
        } label: {
            Text("Abrir").foregroundStyle(Theme.sky500)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Abrir \(ev.name)")
    }

    @EnvironmentObject var auth: AuthStore
    @ObservedObject private var store = TrackingStore.shared
    @ObservedObject private var guideLibrary = GuideLibrary.shared
    @ObservedObject private var net = Reachability.shared
    @State private var title = ""
    /// Renombrar la salida EN MARCHA, desde "En directo".
    @State private var renamingLive = false
    @State private var liveRenameText = ""
    @State private var pendingDelete: TrackSessionSummary?
    @State private var pendingRename: TrackSessionSummary?
    /// The expired-and-nothing-kept sessions queued for the bulk "Limpiar".
    @State private var pendingCleanup: [TrackSessionSummary]?
    /// Present the in-app viewer OFFLINE for a finished session whose trail is
    /// still on this device (its notes and photos included; no coverage needed).
    @State private var reviewSession: TrackSessionSummary?
    @State private var renameText = ""
    /// Present the in-app "live" viewer for the current (offline) session.
    @State private var showLiveMap = false
    /// Present the in-app viewer online for a finished session in the list.
    @State private var mapSession: TrackSessionSummary?
    /// Offline-map download reachable BEFORE sharing (prepare the map the night
    /// before), driven by the selected plan.
    @State private var showMapDownload = false
    @State private var downloadPolyline: [(lat: Double, lon: Double)]?
    @State private var downloadRouteName: String?
    @State private var resolvingRoute = false
    @State private var pendingLogout = false
    /// Cuántas salidas se enseñan sin tener que pedir más.
    private let salidasVisibles = 4
    @State private var verTodasLasSalidas = false
    /// Acuse de «Copiado» en el botón del enlace, un par de segundos.
    @State private var enlaceCopiado = false
    @State private var showGuideImporter = false
    @State private var selectedGuide: LocalGuide?
    @State private var guideShareItem: GuideShareItem?
    @State private var guideError: String?
    @State private var guideWorking = false
    /// Plegado de las dos secciones de decisiones. Las dos nacen cerradas: su
    /// resumen ya dice lo que hay puesto, que es lo que se viene a mirar, y
    /// abrir cuesta un toque.
    @State private var outingOpen = false
    @State private var recordingOpen = false
    /// Abandonar se pregunta: es lo único de esta pantalla que no se deshace.
    @State private var confirmandoAbandono = false
    /// Parar la baliza se pregunta: es el final de la grabación.
    @State private var confirmandoParada = false
    /// Carrera que se va a unir a una baliza YA en marcha (cambia su salida).
    @State private var carreraAUnir: EventSummary?

    private let intervalSteps: [Double] = [5, 10, 15, 30, 60, 120, 180, 300, 600]
    private let distanceSteps: [Double] = [25, 50, 100, 150, 250, 500]

    /// Maps the linear slider position (0…n) to/from the chosen interval.
    private var modeBinding: Binding<SendMode> {
        Binding(get: { store.sendMode }, set: { store.sendMode = $0; store.profile = .custom })
    }

    /// Activity selection (nil = Automático). Routes through `setActivity` so a
    /// change made while sharing also updates the server and the embedded viewer.
    private var activityBinding: Binding<BeaconActivity?> {
        Binding(get: { store.activity }, set: { store.setActivity($0) })
    }

    /// Elegir evento: antes de salir es local, en marcha lo negocia con el
    /// servidor (ver TrackingStore.setEvent).
    /**
     Un toque en una carrera de la lista.

     Con la baliza EMITIENDO, unirse no es un ajuste más: la hora oficial de la
     carrera pasa a ser la salida de lo que ya se está grabando, y con ella el
     ritmo, los cortes y el mapa en el que apareces. Un roce en la lista no puede
     hacer eso, así que se pregunta.

     Soltarla no se pregunta: deshacer nunca necesita permiso. Y con la baliza
     parada tampoco, porque ahí no hay nada grabado que cambiar.
     */
    private func tocaCarrera(_ ev: EventSummary) {
        if store.isSharing, store.selectedEventId != ev.id {
            carreraAUnir = ev
        } else {
            store.setEvent(store.selectedEventId == ev.id ? nil : ev.id)
        }
    }

    private var eventBinding: Binding<String?> {
        Binding(get: { store.selectedEventId }, set: { store.setEvent($0) })
    }

    /// ¿La carrera es HOY? Es lo que más se mira de la lista el día que toca.
    static func isToday(_ startsAtMs: Double?) -> Bool {
        guard let ms = startsAtMs, ms > 0 else { return false }
        return Calendar.current.isDateInToday(Date(timeIntervalSince1970: ms / 1000))
    }

    /// "sáb 13 sep · 08:00", o "hoy · 22:00" el día de la carrera. Sin hora
    /// puesta lo dice: es justo lo que impide que la baliza se quede armada.
    /// "a las 07:30" si es hoy; "el sáb 3 oct a las 05:30" si no.
    ///
    /// Decir solo la hora escondía lo único que importaba: que la espera no era
    /// de horas, sino de quince días. Con el día delante, una baliza armada por
    /// error se ve a la primera.
    private static func cuandoArranca(_ d: Date) -> String {
        let hora = d.formatted(date: .omitted, time: .shortened)
        return Calendar.current.isDateInToday(d)
            ? "a las \(hora)"
            : "el \(d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))) a las \(hora)"
    }

    static func whenLabel(_ startsAtMs: Double?) -> String {
        guard let ms = startsAtMs, ms > 0 else { return "Sin hora de salida" }
        let d = Date(timeIntervalSince1970: ms / 1000)
        let hora = d.formatted(date: .omitted, time: .shortened)
        let dia = isToday(ms)
            ? "hoy"
            : d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        // Pasada la hora se dice, en vez de dejar una fecha suelta que no aclara
        // si la carrera va o no: la cuenta atrás ya no puede decirlo.
        let salio = d < Date() ? " · ya ha salido" : ""
        return "\(dia) · \(hora)\(salio)"
    }

    /// "SiLoSeNoSalgo 1.0 (447)": el número corto y el de compilación, tal y
    /// como los lleva el paquete. El de compilación es el que distingue una
    /// versión de otra —es el número de commits—; el corto es el mismo siempre.
    private static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let corta = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "SiLoSeNoSalgo \(corta) (\(build))"
    }

    /// Lo que se lee sin desplegar "Qué salida es esta".
    ///
    /// Es la razón de ser de una sección plegada: si el resumen no dice lo que
    /// hay elegido, plegarla solo esconde información. Se nombran el evento, el
    /// recorrido y la hora, en ese orden, porque es el orden en que se decide.
    private var outingSummary: String {
        var parts: [String] = []
        if let ev = store.events.first(where: { $0.id == store.selectedEventId }) {
            // Con la marca por delante cuando la hay: plegado, esta línea es lo
            // último que se lee antes de salir, y "voy de 🦊 en Canfranc" es
            // justo lo que se quiere confirmar ahí.
            parts.append(ev.myEmoji.map { "\($0) \(ev.name)" } ?? "🏁 \(ev.name)")
        }
        if let plan = store.plans.first(where: { $0.id == store.selectedPlanId }) {
            parts.append(plan.name)
        } else if store.selectedEventId != nil {
            parts.append("Recorrido del evento")
        } else {
            parts.append("Sin ruta · trazado en vivo")
        }
        if store.startAtTouched {
            parts.append(store.startAt.formatted(date: .abbreviated, time: .shortened))
        }
        return parts.joined(separator: " · ")
    }

    /// El plazo de conservación, dicho como se dice en el selector.
    private var retencionLabel: String {
        store.retainHours >= 720 ? "30 días"
            : store.retainHours >= 168 ? "1 semana"
            : "\(Int(store.retainHours)) h"
    }

    /**
     La cabecera de una sección: icono, versalitas y un color más vivo.

     Todas se leían igual —gris pequeño— y en una pantalla con ocho apartados
     eso no separa nada: el ojo no encuentra dónde empieza cada cosa y acaba
     leyendo la lista entera como un churro. El icono es lo que de verdad
     distingue de un vistazo; el color solo acompaña.
     */
    private func cabecera(_ texto: String, _ icono: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icono).font(.caption2)
            Text(texto.uppercased())
                .font(.caption.weight(.bold))
                .kerning(0.8)
        }
        .foregroundStyle(Theme.sky500)
        .padding(.top, 2)
    }

    /// Lo que se lee sin desplegar "Cómo se registra".
    private var recordingSummary: String {
        let activity = store.effectiveActivity.map {
            "\($0.emoji) \($0.label)" + (store.activity == nil ? " · auto" : "")
        } ?? "🤖 Automático"
        let pace: String
        switch store.profile {
        case .balanced: pace = "Equilibrado"
        case .saver: pace = "Ahorro"
        case .precision: pace = "Alta precisión"
        case .custom:
            pace = store.sendMode == .distance
                ? "Cada \(distanceLabel(store.distanceMeters))"
                : "Cada \(intervalLabel(store.intervalSeconds))"
        }
        let keep = store.retainHours >= 720
            ? "30 días"
            : (store.retainHours >= 168 ? "1 semana" : "\(Int(store.retainHours)) h")
        return "\(activity) · \(pace) · \(keep)"
    }

    private var intervalIndexBinding: Binding<Double> {
        Binding(
            get: { Double(intervalSteps.firstIndex(of: store.intervalSeconds) ?? 2) },
            set: {
                store.intervalSeconds = intervalSteps[min(intervalSteps.count - 1, max(0, Int($0.rounded())))]
                store.profile = .custom
            }
        )
    }

    private var distanceIndexBinding: Binding<Double> {
        Binding(
            get: { Double(distanceSteps.firstIndex(of: store.distanceMeters) ?? 2) },
            set: {
                store.distanceMeters = distanceSteps[min(distanceSteps.count - 1, max(0, Int($0.rounded())))]
                store.profile = .custom
            }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                // Arriba, la MARCA y de quién es la baliza: el logo, el nombre
                // completo de la app y, debajo, "Baliza" con el usuario —el enlace
                // que se comparte lleva ese nombre—. Y "Salir" a la derecha.
                Section {
                    cabecera
                        .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 0, trailing: 4))
                        .listRowBackground(Color.clear)
                }
                Section {
                    // Si hay red o no. Va ARRIBA porque explica media pantalla:
                    // las previsiones, los eventos y los seguimientos viven en
                    // el servidor, así que sin cobertura salen vacíos y sin
                    // este aviso parece que no tienes nada. Solo aparece cuando
                    // falta: cuando hay red no hay nada que contar.
                    if !net.online {
                        HStack(spacing: 8) {
                            Text("📵")
                            Text("Sin conexión. Lo que ves es lo guardado en el móvil: las listas del servidor no se pueden consultar. La baliza SÍ funciona — las posiciones se guardan y se envían al recuperar cobertura.")
                                .font(.footnote)
                                .foregroundStyle(Theme.amber200)
                        }
                        .padding(10)
                        .background(Theme.amber950.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    }
                    // Meta. No se para la baliza sola —hay quien sigue andando
                    // hasta el coche— pero se dice y se ofrece el botón.
                    if store.isSharing && store.atFinish {
                        HStack(spacing: 8) {
                            Text("🏁")
                            Text("Has llegado al final del recorrido.")
                                .font(.footnote)
                                .foregroundStyle(Theme.emerald300)
                            Spacer(minLength: 4)
                            Button("Terminar") { Task { await store.stopSharing() } }
                                .font(.footnote.weight(.semibold))
                        }
                        .padding(10)
                        .background(Theme.emerald950.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    }
                    // Por qué esta baliza dejó de emitir, si fue otro móvil el
                    // que se la llevó. Va ARRIBA y con su botón de descartar:
                    // quien coge este teléfono más tarde se encuentra la baliza
                    // apagada y lo primero que necesita es la razón.
                    if let nota = store.takeoverNote {
                        HStack(alignment: .top, spacing: 8) {
                            Text("🔀")
                            Text(nota).font(.footnote).foregroundStyle(Theme.amber200)
                            Spacer(minLength: 4)
                            Button {
                                store.takeoverNote = nil
                            } label: {
                                Image(systemName: "xmark").font(.caption)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.slate400)
                        }
                        .padding(10)
                        .background(Theme.amber950.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    }
                    statusContent
                    // El ENLACE, a un toque: es lo que se busca en cuanto alguien
                    // pregunta "¿dónde te sigo?", y estaba al final de la pantalla.
                    if store.isSharing, let link = store.shareLink {
                        HStack(spacing: 8) {
                            ShareLink(item: link) {
                                Label("Compartir enlace", systemImage: "square.and.arrow.up")
                                    .font(.footnote.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 11)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.sky500)
                            .background(Theme.sky500.opacity(0.16))
                            .clipShape(RoundedRectangle(cornerRadius: 10))

                            // Copiar, AQUÍ. El enlace entero se enseñaba abajo,
                            // en un apartado propio al final de la pantalla, y
                            // eso no ayudaba a nadie: leer una URL de cuarenta
                            // caracteres no dice nada que no diga "tu enlace", y
                            // quien la quería no la quería para mirarla, sino
                            // para pegarla. Compartir y copiar son las dos cosas
                            // que se hacen con un enlace, y van juntas.
                            Button {
                                UIPasteboard.general.string = link
                                Vibra.eleccion()
                                enlaceCopiado = true
                                Task {
                                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                                    enlaceCopiado = false
                                }
                            } label: {
                                Label(enlaceCopiado ? "Copiado" : "Copiar",
                                      systemImage: enlaceCopiado ? "checkmark" : "doc.on.doc")
                                    .font(.footnote.weight(.semibold))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 11)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.sky500)
                            .background(Theme.sky500.opacity(0.16))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    }
                    // Bajarse o pararse: las dos cosas que se hacen EN CARRERA
                    // y que hasta ahora no se podían decir. Apagar la baliza
                    // valía para las dos, y no son lo mismo: quien la apaga deja
                    // a los suyos con la duda —¿se ha quedado sin batería?— y la
                    // hora que queda es la de cuando se acordó del móvil.
                    //
                    // Rojo lo definitivo y ámbar lo que se deshace solo, que es
                    // como se leen los botones sin pararse a leerlos.
                    if store.isSharing && !store.isStandby {
                        if let hasta = store.pausadaHasta, hasta > Date() {
                            // El MISMO botón, partido en dos. No aparece un
                            // cuadro nuevo en otro sitio: el dedo ya está aquí,
                            // y lo que se quiere hacer estando en pausa es
                            // alargarla un poco o volver a emitir. Nada más.
                            VStack(spacing: 6) {
                                HStack(spacing: 5) {
                                    Image(systemName: "pause.fill").font(.caption2)
                                    Text("En pausa · vuelve sola en \(max(1, Int(hasta.timeIntervalSinceNow / 60))) min")
                                }
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Theme.amber200)

                                HStack(spacing: 3) {
                                    // Ámbar el que sigue pausando, verde el que
                                    // devuelve la baliza a la carrera: el color
                                    // dice cuál es cuál antes de leerlos.
                                    Button {
                                        Task { await store.alarga() }
                                    } label: {
                                        Label("\(TrackingStore.pausaPaso) min", systemImage: "plus")
                                            .font(.footnote.weight(.semibold))
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                    }
                                    .buttonStyle(.plain)
                                    .background(Color(red: 0.85, green: 0.65, blue: 0.30)
                                        .opacity(store.puedeAlargar ? 1 : 0.4))
                                    .foregroundStyle(Theme.slate950)
                                    .cornerRadius(12)
                                    .disabled(!store.puedeAlargar)

                                    Button {
                                        Task { await store.reanuda() }
                                    } label: {
                                        Label("Continuar", systemImage: "play.fill")
                                            .font(.footnote.weight(.semibold))
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                    }
                                    .buttonStyle(.plain)
                                    .background(Theme.emerald300)
                                    .foregroundStyle(Theme.slate950)
                                    .cornerRadius(12)
                                }
                            }
                            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 0, trailing: 16))
                        } else {
                            Button {
                                Task { await store.pausa() }
                            } label: {
                                Label("Pausar \(TrackingStore.pausaMax) min", systemImage: "pause.fill")
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            }
                            .buttonStyle(.plain)
                            // Ámbar apagado, no el amarillo de aviso: es una
                            // acción normal, y al lado del rojo de parar no
                            // tiene que gritar más que él.
                            .background(Color(red: 0.85, green: 0.65, blue: 0.30))
                            .foregroundStyle(Theme.slate950)
                            .cornerRadius(12)
                            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 0, trailing: 16))
                        }
                    }
                    // CON QUÉ se va a salir, resumido justo encima del botón.
                    //
                    // Los ajustes viven plegados en dos secciones distintas y
                    // nadie las despliega para comprobarlos antes de pulsar: se
                    // salía en "Ahorro" o sin ruta sin haberlo querido, y eso no
                    // se descubre hasta mirar el mapa a mitad de carrera. Aquí
                    // no se toca nada —se lee—, y por eso va pequeño y en gris:
                    // es una confirmación, no un mando más.
                    if !store.isSharing {
                        VStack(alignment: .leading, spacing: 3) {
                            Label(recordingSummary, systemImage: "dot.radiowaves.left.and.right")
                            Label(outingSummary, systemImage: "map")
                        }
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 0, trailing: 16))
                    }

                    // El botón, junto al estado y no al final de la pantalla:
                    // es LA acción, y donde se lee "detenido" es donde se va a
                    // buscar cómo dejar de estarlo. Además deja la misma
                    // posición en las dos apps, que antes no coincidía.
                    //
                    // Corriendo una carrera, apagar ES bajarse de ella, y dicho
                    // así queda en la clasificación con su hora y su kilómetro.
                    // Fuera de carrera, antes de la salida o ya en meta no hay
                    // de qué bajarse: ahí solo se deja de compartir.
                    let abandonaAlParar = store.isSharing && !store.isStandby
                        && store.selectedEventId != nil && !store.atFinish
                    Button {
                        Task {
                            if abandonaAlParar {
                                confirmandoAbandono = true
                            } else if store.isSharing {
                                // Parar también se pregunta. Quien lleva seis
                                // horas emitiendo no puede quedarse sin baliza
                                // por un roce con el pulgar, y este botón está
                                // justo donde se toca todo lo demás.
                                confirmandoParada = true
                            } else {
                                // Con dos botones, este es "Iniciar ahora": fuera
                                // la hora prevista, solo para esta salida.
                                if dosFormasDeEmpezar { store.clearStartAt() }
                                await empieza()
                            }
                        }
                    } label: {
                        Text(abandonaAlParar ? "Abandonar"
                             : store.isSharing ? "Dejar de compartir"
                             : dosFormasDeEmpezar ? "Iniciar ahora"
                             : textoCompartir)
                            .fontWeight(.semibold)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .background(store.isSharing ? Color.red.opacity(0.85) : Theme.sky600)
                    .foregroundStyle(.white)
                    .cornerRadius(12)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 6, trailing: 16))
                    .confirmationDialog(
                        carreraAPreguntar.map { "¿Esta salida es para \($0.name)?" } ?? "",
                        isPresented: Binding(
                            get: { carreraAPreguntar != nil },
                            set: { if !$0 { carreraAPreguntar = nil } }
                        ),
                        titleVisibility: .visible,
                        presenting: carreraAPreguntar
                    ) { ev in
                        Button("Sí, para \(ev.name)") {
                            store.setEvent(ev.id)
                            Vibra.exito()
                            Task { await store.startSharing(title: tituloLimpio) }
                        }
                        Button("No, es una salida suelta") {
                            Vibra.exito()
                            Task { await store.startSharing(title: tituloLimpio) }
                        }
                        Button("Cancelar", role: .cancel) {}
                    } message: { _ in
                        Text("Con la carrera apareces en su mapa, con su hora de salida y tu previsión.")
                    }
                    .confirmationDialog("¿Abandonas la carrera?",
                                        isPresented: $confirmandoAbandono, titleVisibility: .visible) {
                        Button("Sí, lo dejo", role: .destructive) {
                            Vibra.fin()
                            Task { await store.abandona() }
                        }
                        // La salida para quien ha acabado y la app no lo ha
                        // visto —sin recorrido, o apaga antes de la meta—: sin
                        // ella, apagar le obligaba a darse por retirado.
                        Button("Solo apagar la baliza") {
                            Vibra.fin()
                            Task { await store.stopSharing() }
                        }
                        Button("No, sigo", role: .cancel) {}
                    } message: {
                        Text("Queda dicho a esta hora y en tu kilómetro, y se cierra la baliza. Si solo te paras un rato, usa la pausa.")
                    }

                    // La otra forma de empezar, cuando la ruta trae hora: armar
                    // la baliza y que salga sola. Debajo y sin relleno: la de
                    // arriba es la habitual sobre el terreno.
                    if dosFormasDeEmpezar, let salida = store.salidaQueArmaria {
                        Button {
                            Vibra.exito()
                            Task { await empieza() }
                        } label: {
                            Text("Iniciar \(Self.cuandoArranca(salida))")
                                .fontWeight(.semibold)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        .foregroundStyle(Theme.sky500)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.sky600, lineWidth: 1.5))
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 6, trailing: 16))
                    }
                } footer: {
                    if !store.isSharing {
                        Text("Al iniciar uno nuevo, el anterior se cierra y se conserva \(retencionLabel) para poder consultarlo (o para siempre si lo fijas con la chincheta). El plazo se elige en «Cómo se registra».")
                            .font(.caption)
                            .foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                if store.isSharing {
                    Section {
                        Button { showLiveMap = true } label: {
                            Label("Ver mi ruta en el mapa (offline)", systemImage: "map.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .foregroundStyle(Theme.sky500)
                    } footer: {
                        Text(store.noteCount > 0
                             ? "\(store.noteCount) \(store.noteCount == 1 ? "nota anclada" : "notas ancladas") en esta ruta. Se exportan como POIs en el GPX de la guía."
                             : "Marca puntos (agua, cruce, peligro…) anclados a tu posición. Se exportan como POIs en el GPX. Tu previsión y mapa funcionan sin cobertura.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                // Las decisiones, agrupadas por NATURALEZA y plegadas: cada
                // sección enseña lo elegido y se abre para cambiarlo. Antes
                // estaban todas desplegadas —actividad, evento, perfil, mandos,
                // retención, hora, ruta— y eso es un muro de mandos donde cuesta
                // encontrar el que se busca y, peor, cuesta ver de un vistazo QUÉ
                // está puesto.
                //
                // Son dos preguntas distintas y por eso son dos secciones: "qué
                // MIS CARRERAS: las que corro, a la vista nada más abrir.
                //
                // Antes los eventos solo existían dentro del selector de abajo,
                // escondidos tras una sección plegada y presentados como un
                // ATRIBUTO de la salida. Para quien corre carreras organizadas
                // el evento no es un atributo: es el motivo de abrir la app.
                // Tocar una la deja preparada —se atribuye la baliza y hereda su
                // hora oficial, así que queda armada hasta el disparo— y otro
                // toque la quita; es el mismo estado que el selector, no hay dos
                // verdades. "Parrilla" abre su pantalla web, que es donde vive.
                // Lo que NO hace es empezar a emitir: eso sigue siendo el botón
                // de arriba, con el nombre y la ruta ya decididos.
                if !store.events.isEmpty || !store.pastEvents.isEmpty {
                    Section {
                        // Una tarjeta por carrera, como en la web: el cartel manda.
                        // Tocarla la prepara para la baliza; "Abrir" lleva a la web.
                        ForEach(store.events) { ev in
                            TarjetaCarrera(
                                ev: ev,
                                cuando: Self.whenLabel(ev.startsAt),
                                hoy: Self.isToday(ev.startsAt),
                                elegida: store.selectedEventId == ev.id,
                                proxima: ev.id == proximaCarreraId,
                                onElegir: { tocaCarrera(ev) }
                            ) {
                                menuDeCarrera(ev)
                            }
                            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                        }

                        // Las terminadas, plegadas: ya no se pueden correr, pero
                        // su parrilla sigue siendo donde están los resultados.
                        if !store.pastEvents.isEmpty {
                            // Un bloque con el mismo ancho, esquinas y borde que las
                            // tarjetas de arriba. Como fila de lista normal quedaba con
                            // otros márgenes y otras esquinas, despegado de ellas.
                            VStack(spacing: 0) {
                                Button {
                                    withAnimation(.easeInOut(duration: 0.2)) { terminadasAbiertas.toggle() }
                                } label: {
                                    HStack {
                                        Text("Terminadas (\(store.pastEvents.count))")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(Theme.slate100)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.footnote.weight(.semibold))
                                            .foregroundStyle(Theme.slate400)
                                            .rotationEffect(.degrees(terminadasAbiertas ? 90 : 0))
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityHint(terminadasAbiertas ? "Ocultar las carreras terminadas" : "Ver las carreras terminadas")

                                if terminadasAbiertas {
                                    ForEach(store.pastEvents) { ev in
                                        Rectangle().fill(Theme.slate800).frame(height: 1)
                                        HStack(spacing: 10) {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(ev.myEmoji.map { "\($0)  \(ev.name)" } ?? ev.name)
                                                    .font(.subheadline)
                                                    .foregroundStyle(Theme.slate100)
                                                    .lineLimit(1)
                                                Text("terminada · " + Self.whenLabel(ev.startsAt))
                                                    .font(.caption2)
                                                    .foregroundStyle(Theme.slate400)
                                            }
                                            Spacer(minLength: 0)
                                            menuDeCarrera(ev)
                                        }
                                        .padding(.leading, 12)
                                        .padding(.trailing, 8)
                                        .padding(.vertical, 8)
                                    }
                                }
                            }
                            .background(Theme.slate900)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Theme.slate800, lineWidth: 1)
                            )
                            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                        }
                    } header: {
                        cabecera("Mis carreras", "flag.checkered")
                    } footer: {
                        Text("Toca una carrera para preparar la baliza con su hora de salida oficial y tu previsión. «Abrir» lleva a su parrilla, el mapa, la porra o tu plan, con tu sesión ya iniciada.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                // salida es esta" y "cómo se registra".
                Section {
                    DisclosureGroup(isExpanded: $outingOpen) {
                        if !store.events.isEmpty {
                            Picker("Evento", selection: eventBinding) {
                                Text("Ninguno · salida suelta").tag(String?.none)
                                ForEach(store.events) { ev in
                                    // El emoji delante del nombre: en la salida
                                    // lo que se comprueba es "¿soy yo el zorro?".
                                    Text(ev.myEmoji.map { "\($0)  \(ev.name)" } ?? ev.name).tag(Optional(ev.id))
                                }
                            }
                            // Puesto por la app, no por su dueño: hay que
                            // decirlo. Atribuir la salida a una carrera cambia
                            // quién te ve y de dónde sale la hora, y eso no
                            // puede pasar en silencio; enseñarlo es lo que
                            // convierte el atajo en una propuesta que se
                            // rechaza volviendo a "Ninguno".
                            if store.eventPickedAutomatically, store.selectedEventId != nil, !store.isSharing {
                                Label("Hoy corres esta. La baliza viene preparada para ella, con su hora de salida.",
                                      systemImage: "sparkles")
                                    .font(.caption)
                                    .foregroundStyle(Theme.sky500)
                            }
                            if let ev = store.events.first(where: { $0.id == store.selectedEventId }),
                               let emoji = ev.myEmoji {
                                HStack(spacing: 8) {
                                    MarcaEvento(emoji: emoji, colorSlug: ev.myColor)
                                    Text("Así te ven los demás en el mapa del evento. Tu marca se elige en la web, en la parrilla.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        if !store.isSharing {
                            // Con evento elegido, la ruta cambia de significado: lo
                            // que se elige ya no es "por dónde voy" —eso lo pone la
                            // carrera— sino CON QUÉ RITMOS. Por eso las previsiones
                            // hechas sobre ese recorrido van primero y aparte: son
                            // las únicas que cuadran con el evento.
                            Picker(store.selectedEventId == nil ? "Ruta (previsión)" : "Mi previsión", selection: $store.selectedPlanId) {
                                Text(store.selectedEventId == nil
                                     ? "Sin ruta · trazado en vivo"
                                     : "La del evento").tag(String?.none)
                                if store.selectedEventId != nil {
                                    Section("De este evento") {
                                        ForEach(store.plansOfEvent) { plan in
                                            Text(plan.name).tag(Optional(plan.id))
                                        }
                                    }
                                    Section("Otras previsiones") {
                                        ForEach(store.plansNotOfEvent) { plan in
                                            Text(plan.name).tag(Optional(plan.id))
                                        }
                                    }
                                } else {
                                    ForEach(store.plans) { plan in
                                        Text(plan.name).tag(Optional(plan.id))
                                    }
                                }
                            }
                            // Elegir una previsión ajena al evento no rompe nada
                            // —la tuya siempre manda— pero deja el visor calculando
                            // contra un recorrido que no estás corriendo, y eso no
                            // puede pasar en silencio.
                            if store.planMismatchesEvent {
                                Label("Esta previsión no es del recorrido del evento: tus ritmos y cortes se calcularán sobre otra ruta.",
                                      systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            if store.selectedPlanId != nil || store.selectedEventId != nil {
                                Button {
                                    openMapDownloadForSelectedPlan()
                                } label: {
                                    HStack {
                                        Label("Descargar mapa offline", systemImage: "arrow.down.circle")
                                        if resolvingRoute { Spacer(); ProgressView().tint(Theme.sky500) }
                                    }
                                }
                                .foregroundStyle(Theme.sky500)
                                .disabled(resolvingRoute)
                            }
                            TextField("Nombre (opcional)", text: $title)
                            // La hora, con las dos salidas a la vista. Sin hora
                            // fijada se lee "Ahora" —no un selector con la hora
                            // de cuando se abrió la pantalla, que parecía una
                            // hora puesta— y un botón para programarla. Con hora,
                            // el selector y un botón para quitarla: "salgo ya"
                            // tiene que ser un toque, no pelearse con la rueda.
                            if store.startAtTouched {
                                DatePicker(
                                    "Hora de salida prevista",
                                    selection: Binding(get: { store.startAt }, set: { store.setStartAt($0) }),
                                    displayedComponents: [.date, .hourAndMinute]
                                )
                                Button {
                                    store.clearStartAt()
                                } label: {
                                    Label("Salir ahora · quitar la hora prevista", systemImage: "bolt.fill")
                                }
                                .foregroundStyle(Theme.sky500)
                            } else {
                                HStack {
                                    Text("Hora de salida prevista")
                                    Spacer()
                                    Text("Ahora").foregroundStyle(Theme.slate400)
                                }
                                Button {
                                    store.setStartAt(Date())
                                } label: {
                                    Label("Programar la salida", systemImage: "clock")
                                }
                                .foregroundStyle(Theme.sky500)
                            }
                        }
                    } label: {
                        Text(outingSummary)
                            .font(.subheadline)
                            .foregroundStyle(Theme.slate100)
                            .lineLimit(2)
                    }
                    .tint(Theme.sky500)
                } header: {
                    cabecera("Qué salida es esta", "figure.run")
                } footer: {
                    if outingOpen {
                        Text(store.selectedEventId != nil
                             ? "Apareces en el mapa del evento con tu color. Sin previsión propia corres con el recorrido y los cortes de la carrera."
                             : "La hora de salida es la referencia de tus ritmos y previsiones; por defecto, el momento de empezar.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                // La actividad y el ritmo se ajustan TAMBIÉN en marcha: el perfil
                // que se elige antes de salir es una apuesta, y a mitad de ruta es
                // cuando de verdad se sabe si sobra precisión o falta batería.
                Section {
                    DisclosureGroup(isExpanded: $recordingOpen) {
                        Picker("Actividad", selection: activityBinding) {
                            Label("Automático", systemImage: "wand.and.stars").tag(BeaconActivity?.none)
                            ForEach(BeaconActivity.allCases) { a in
                                Text("\(a.emoji)  \(a.label)").tag(Optional(a))
                            }
                        }
                        profileRow(.balanced, title: "Equilibrado",
                                   detail: "Por distancia (~100 m). Buena precisión y batería.",
                                   autonomy: "Buena autonomía", color: .green, recommended: true)
                        profileRow(.saver, title: "Ahorro · ultra",
                                   detail: "Por distancia (~150 m), con el GPS a media potencia. Parado no gasta batería.",
                                   autonomy: "Máxima autonomía", color: .green)
                        profileRow(.precision, title: "Alta precisión",
                                   detail: "Por tiempo (cada 10 s). Máximo detalle.",
                                   autonomy: "Menor autonomía", color: .orange)

                        DisclosureGroup("Avanzado") {
                            Picker("Enviar", selection: modeBinding) {
                                Text("Por tiempo").tag(SendMode.time)
                                Text("Por distancia").tag(SendMode.distance)
                            }
                            .pickerStyle(.segmented)
                            VStack(alignment: .leading, spacing: 6) {
                                if store.sendMode == .time {
                                    HStack {
                                        Text("Cada \(intervalLabel(store.intervalSeconds))").fontWeight(.semibold)
                                        Spacer()
                                        Text(batteryLabel(store.intervalSeconds))
                                            .font(.caption).fontWeight(.semibold)
                                            .foregroundStyle(batteryColor(store.intervalSeconds))
                                    }
                                    Slider(value: intervalIndexBinding, in: 0...Double(intervalSteps.count - 1), step: 1)
                                } else {
                                    HStack {
                                        Text("Cada \(distanceLabel(store.distanceMeters))").fontWeight(.semibold)
                                        Spacer()
                                        Text(batteryLabelDist(store.distanceMeters))
                                            .font(.caption).fontWeight(.semibold)
                                            .foregroundStyle(batteryColorDist(store.distanceMeters))
                                    }
                                    Slider(value: distanceIndexBinding, in: 0...Double(distanceSteps.count - 1), step: 1)
                                }
                                HStack {
                                    Text("Más precisión").font(.caption2).foregroundStyle(Theme.slate400)
                                    Spacer()
                                    Text("Más batería").font(.caption2).foregroundStyle(Theme.slate400)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .tint(Theme.sky500)
                        Picker("Conservar al finalizar", selection: $store.retainHours) {
                            Text("6 h").tag(6.0)
                            Text("12 h").tag(12.0)
                            Text("24 h").tag(24.0)
                            Text("48 h").tag(48.0)
                            Text("72 h").tag(72.0)
                            Text("1 semana").tag(168.0)
                            Text("30 días").tag(720.0)
                        }
                        // El consejo de bajo consumo vive aquí y no en una
                        // sección aparte: habla del gasto, que es justo de lo
                        // que trata esta sección, y suelto era una tarjeta más
                        // en una pantalla que ya tenía demasiadas.
                        lowPowerTip
                    } label: {
                        Text(recordingSummary)
                            .font(.subheadline)
                            .foregroundStyle(Theme.slate100)
                            .lineLimit(2)
                    }
                    .tint(Theme.sky500)
                } header: {
                    cabecera("Cómo se registra", "dot.radiowaves.left.and.right")
                } footer: {
                    if recordingOpen {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("El gasto lo manda el GPS, no la frecuencia de envío: ahorrar es pedirle menos al GPS, y parado no gasta.")
                            // Esto vivía suelto al final de la pantalla, donde
                            // no lo leía nadie y encima parecía una nota legal.
                            // Habla de CÓMO se registra —de qué necesita el GPS
                            // para seguir dando puntos—, así que va aquí.
                            Text("Y hace falta la app abierta, aunque sea en segundo plano, con el indicador de ubicación encendido: iOS detiene el GPS si la cierras del todo.")
                        }
                        .font(.caption).foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                if !store.isSharing {
                    Section {
                        Text("GUÍAS")
                            .font(.caption2.weight(.bold)).kerning(0.6)
                            .foregroundStyle(Theme.slate400)
                        Button { showGuideImporter = true } label: {
                            Label("Importar .slsnsguide", systemImage: "square.and.arrow.down")
                        }
                        .disabled(guideWorking)

                        ForEach(guideLibrary.guides) { guide in
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(guide.title)
                                        .foregroundStyle(Theme.slate100)
                                        .lineLimit(1)
                                    Text("\(guide.noteCount) notas · \(guide.mediaCount) archivos · \(startedLabel(guide.startedAt))")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.slate400)
                                }
                                Spacer()
                                Button { openGuide(guide) } label: {
                                    Image(systemName: "map")
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Abrir guía offline")
                                Menu {
                                    Button(role: .destructive) { guideLibrary.delete(guide) } label: {
                                        Label("Eliminar guía", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Más opciones de la guía")
                            }
                        }
                        // Y en la MISMA sección, debajo, las salidas: son la
                        // respuesta a la misma pregunta —"¿qué tengo grabado?"—
                        // y en dos apartados obligaban a mirar en dos sitios lo
                        // que se busca de una vez.
                        Divider().overlay(Theme.slate800).padding(.vertical, 2)
                        Text("SALIDAS")
                            .font(.caption2.weight(.bold)).kerning(0.6)
                            .foregroundStyle(Theme.slate400)
                        if store.sessions.isEmpty {
                            // Sin red la lista viene vacía por no poder
                            // consultarla, no por no tener nada: decir "no
                            // tienes" seria mentir.
                            Text(net.online
                                 ? "No tienes seguimientos."
                                 : "Sin conexión: no se pueden consultar tus seguimientos.")
                                .font(.caption)
                                .foregroundStyle(Theme.slate400)
                        } else {
                            // Las que ya no sirven para nada: el servidor borró su
                            // ruta y en el móvil no queda traza. Borrarlas de una
                            // en una por una lista larga es un trabajo tonto.
                            let unusable = store.sessions.filter {
                                !store.isActive($0) && store.isPurged($0) && !LocalStore.hasTrail($0.id)
                            }
                            if !unusable.isEmpty {
                                HStack {
                                    Text("\(unusable.count) caducadas sin nada guardado")
                                        .font(.caption)
                                        .foregroundStyle(Theme.slate400)
                                    Spacer()
                                    Button("Limpiar") { pendingCleanup = unusable }
                                        .buttonStyle(.borderless)
                                        .font(.caption)
                                        .foregroundStyle(Theme.sky500)
                                }
                            }
                            // Solo las últimas: la lista solo crece, y lo que se
                            // viene a buscar es casi siempre la de hoy o la de
                            // ayer. El resto sigue ahí, a un toque.
                            let visibles = verTodasLasSalidas
                                ? store.sessions
                                : Array(store.sessions.prefix(salidasVisibles))
                            ForEach(visibles) { session in
                                sessionRow(session)
                            }
                            if store.sessions.count > salidasVisibles {
                                Button(verTodasLasSalidas
                                       ? "Ver menos"
                                       : "Ver las \(store.sessions.count - salidasVisibles) restantes") {
                                    withAnimation { verTodasLasSalidas.toggle() }
                                }
                                .buttonStyle(.borderless)
                                .font(.caption)
                                .foregroundStyle(Theme.sky500)
                                .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                    } header: {
                        cabecera("Lo que tienes grabado", "tray.full")
                    } footer: {
                        Text("Las guías llevan dentro la ruta, el recorrido real, las notas, las fotos y los audios; no, las teselas del mapa. Las salidas se conservan el plazo que elegiste, salvo las fijadas con la chincheta.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if store.isSharing, let link = store.shareLink {
                    // El nombre, y poder cambiarlo aquí mismo. Se le ocurre a uno
                    // a mitad de ruta —"esto no era un entrenamiento, era la
                    // carrera"— y hasta ahora había que bajar hasta "Mis
                    // seguimientos" y buscar la propia sesión entre las
                    // anteriores. Aquí es donde se está mirando mientras se emite.
                    Section {
                        Button {
                            liveRenameText = store.activeTitle ?? ""
                            renamingLive = true
                        } label: {
                            HStack {
                                Text(store.activeTitle?.isEmpty == false
                                     ? store.activeTitle! : "Sin nombre")
                                    .foregroundStyle(store.activeTitle?.isEmpty == false
                                                     ? Theme.slate100 : Theme.slate400)
                                    .lineLimit(1)
                                Spacer()
                                Label("Renombrar", systemImage: "pencil")
                                    .labelStyle(.titleAndIcon)
                                    .font(.caption)
                                    .foregroundStyle(Theme.sky500)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } header: {
                        cabecera("Nombre de esta salida", "pencil")
                    }
                    .listRowBackground(Theme.slate900)

                }

                if let err = store.lastError {
                    Section {
                        Text(err).foregroundStyle(.red).font(.footnote)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if store.authStatus == .authorizedWhenInUse {
                    Section {
                        Text("Tienes permiso \"Mientras se usa\". Para seguir compartiendo con la pantalla apagada, cambia a \"Siempre\" en Ajustes → SiLoSeNoSalgo → Ubicación.")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                    .listRowBackground(Theme.slate900)
                } else if store.authStatus == .denied || store.authStatus == .restricted {
                    Section {
                        Text("El permiso de ubicación está desactivado. Actívalo en Ajustes → SiLoSeNoSalgo → Ubicación.")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(Theme.slate900)
                }

                // Salir de la cuenta, AL FINAL: arriba, al lado del nombre, era
                // fácil rozarlo con prisa, y es lo que menos se hace. Se sigue
                // preguntando antes, que en marcha además hay que detener la
                // baliza. Igual que en Android.
                Section {
                    // En rojo, pero apagado: es una salida, no una alarma. En
                    // azul se leía como un enlace más de los muchos que hay en
                    // esta pantalla, y lo que hace —cerrar la sesión, y en
                    // marcha detener la baliza— no es como abrir un mapa.
                    Button("Salir de la cuenta") { pendingLogout = true }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .foregroundStyle(Theme.rose300.opacity(0.85))
                }
                .listRowBackground(Theme.slate900)

                // La versión, al pie y en pequeño. No es decoración: es lo
                // primero que hay que preguntar cuando alguien dice que algo no
                // le funciona, y hasta ahora no había forma de saberlo —el
                // número corto es "1.0" en todas las compilaciones, así que en
                // los ajustes del sistema se ve lo mismo con la de agosto que
                // con la de hoy—.
                Section {
                    Text(Self.appVersion)
                        .font(.caption2)
                        .foregroundStyle(Theme.slate400)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .textSelection(.enabled)
                }
                .listRowBackground(Color.clear)

            }
            .alert("Eliminar seguimiento", isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ), presenting: pendingDelete) { session in
                Button("Eliminar", role: .destructive) {
                    pendingDelete = nil
                    Task { await store.deleteSession(session.id) }
                }
                Button("Cancelar", role: .cancel) { pendingDelete = nil }
            } message: { session in
                Text("Se borrará por completo \"\(store.labelForSession(session))\". Esta acción no se puede deshacer.")
            }
            .alert("¿Limpiar seguimientos?", isPresented: Binding(
                get: { pendingCleanup != nil },
                set: { if !$0 { pendingCleanup = nil } }
            ), presenting: pendingCleanup) { sessions in
                Button("Limpiar", role: .destructive) {
                    let ids = sessions.map(\.id)
                    pendingCleanup = nil
                    Task { await store.deleteSessions(ids) }
                }
                Button("Cancelar", role: .cancel) { pendingCleanup = nil }
            } message: { sessions in
                Text("Son \(sessions.count): las que ya han caducado y de las que no queda nada en este móvil. No se puede ver su mapa ni exportarlas, y su enlace ya no funciona. Solo se quita la entrada de la lista.")
            }
            .alert("Nombre del seguimiento", isPresented: $renamingLive) {
                TextField("Nombre", text: $liveRenameText)
                Button("Guardar") {
                    guard let id = store.sessionToken else { return }
                    let t = liveRenameText.trimmingCharacters(in: .whitespaces)
                    Task { await store.rename(id, t.isEmpty ? nil : t) }
                }
                Button("Cancelar", role: .cancel) { }
            } message: {
                Text("Vacío lo devuelve a «Sin nombre». El enlace que ya has compartido no cambia.")
            }
            .alert("Renombrar seguimiento", isPresented: Binding(
                get: { pendingRename != nil },
                set: { if !$0 { pendingRename = nil } }
            ), presenting: pendingRename) { session in
                TextField("Nombre", text: $renameText)
                Button("Guardar") {
                    let id = session.id
                    let name = renameText.trimmingCharacters(in: .whitespaces)
                    pendingRename = nil
                    Task { await store.rename(id, name.isEmpty ? nil : name) }
                }
                Button("Cancelar", role: .cancel) { pendingRename = nil }
            } message: { _ in
                Text("Ponle un nombre para identificar este seguimiento más tarde.")
            }
            // Otra baliza de la misma cuenta está viva: se pregunta antes de
            // quitársela. El servidor solo admite una por cuenta y cierra la
            // anterior sin avisar, así que sin esto arrancar aquí dejaba el
            // otro móvil mudo y nadie se enteraba.
            .alert("Ya tienes una baliza en marcha", isPresented: Binding(
                get: { store.takeoverAsk != nil },
                set: { if !$0 { store.takeoverAsk = nil } }
            ), presenting: store.takeoverAsk) { otra in
                Button("Pasarla a este móvil") {
                    Task {
                        store.takeoverAsk = nil
                        await store.startSharing(
                            title: title.trimmingCharacters(in: .whitespaces).isEmpty ? nil : title,
                            force: true,
                        )
                    }
                }
                Button("Cancelar", role: .cancel) { store.takeoverAsk = nil }
            } message: { otra in
                Text("«\(store.labelForSession(otra))» está emitiendo desde otro dispositivo. Solo puede haber una baliza por cuenta: si sigues, esa se desarma y esta toma el relevo.")
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .tint(Theme.sky500)
            .task {
                store.configure(token: auth.token ?? "")
                store.viewerUsername = auth.user?.username
                store.restoreActiveSession() // resume the last active beacon if not explicitly stopped
                // Cheer alerts need permission; asked here, on opening the
                // portal (like Android's POST_NOTIFICATIONS), not mid-route.
                // Pide el permiso Y da de alta el aparato para los push: el
                // permiso es el mismo para las dos vías, así que preguntarlo dos
                // veces sería preguntar dos veces lo mismo.
                PushRegistrar.shared.arranca()
                // El mismo permiso sirve para los avisos de salida; se pide
                // aquí y no cinco minutos antes del disparo, que es tarde para
                // contestar a un diálogo. Ver `AvisosDeCarrera`.
                AvisosDeCarrera.pideDerechoAAvisar()
                await store.loadPlans()
                await store.loadEvents()
                await store.loadSessions()
            }
            .refreshable {
                // Pull down to pick up changes made elsewhere (e.g. a route just
                // created on the web, o un evento al que te acaban de invitar)
                // without leaving the screen.
                await store.loadPlans()
                await store.loadEvents()
                await store.loadSessions()
            }
            .fullScreenCover(isPresented: $showLiveMap) {
                // `claveDeDatos`, no `sessionToken`: una baliza que arrancó sin
                // cobertura graba con una clave provisional, y su mapa tiene que
                // verse igual. Con `sessionToken` esto presentaba una vista
                // VACÍA —pantalla negra sin barra ni "Volver", sin forma de
                // salir— justo en el caso para el que se hizo el arranque
                // offline. Y si aun así no hubiera clave, se sale sola.
                if let t = store.claveDeDatos {
                    LiveMapView(source: .offline(token: t), offlineToken: t)
                } else {
                    SinMapa { showLiveMap = false }
                }
            }
            .fullScreenCover(item: $mapSession) { session in
                if let url = URL(string: store.shareLink(for: session.id)) {
                    LiveMapView(source: .online(url: url), offlineToken: nil)
                } else {
                    SinMapa { mapSession = nil }
                }
            }
            .fullScreenCover(item: $reviewSession) { session in
                // A finished session with its trail still on this device: served
                // locally like a guide, read-only (it's already over).
                LiveMapView(
                    source: .offline(token: session.id), offlineToken: session.id,
                    allowsEditing: false, title: store.labelForSession(session, fallback: "Seguimiento")
                )
            }
            .fullScreenCover(item: $selectedGuide) { guide in
                LiveMapView(
                    source: .offline(token: guide.id), offlineToken: guide.id,
                    allowsEditing: false, title: "Guía offline"
                )
            }
            .sheet(item: $webEvento) { enlace in
                SafariView(url: enlace.url).ignoresSafeArea()
            }
            .sheet(isPresented: $showMapDownload) {
                MapDownloadView(routeName: downloadRouteName, polyline: downloadPolyline)
            }
            .sheet(item: $guideShareItem) { item in
                GuideShareSheet(url: item.url)
            }
            .fileImporter(isPresented: $showGuideImporter, allowedContentTypes: [.slsnsGuide]) { result in
                guard case .success(let url) = result else {
                    if case .failure(let error) = result { guideError = error.localizedDescription }
                    return
                }
                guideWorking = true
                Task {
                    do {
                        let guide = try await guideLibrary.importGuide(from: url)
                        try guideLibrary.prepareForViewing(guide)
                        selectedGuide = guide
                    } catch {
                        guideError = error.localizedDescription
                    }
                    guideWorking = false
                }
            }
            .alert("Guías offline", isPresented: Binding(
                get: { guideError != nil },
                set: { if !$0 { guideError = nil } }
            )) {
                Button("Aceptar", role: .cancel) { guideError = nil }
            } message: {
                Text(guideError ?? "")
            }
            // Las dos confirmaciones que faltaban, en un modificador aparte: ver
            // `ConfirmacionesDeBaliza`.
            .modifier(ConfirmacionesDeBaliza(
                confirmandoParada: $confirmandoParada,
                carreraAUnir: $carreraAUnir,
            ))
            .alert("Salir de la cuenta", isPresented: $pendingLogout) {
                Button(store.isSharing ? "Detener y salir" : "Salir", role: .destructive) {
                    Task {
                        await store.stopSharing()
                        // Antes de cerrar la sesión, que es cuando todavía hay
                        // con qué autenticar la baja: si no, este móvil seguiría
                        // recibiendo los ánimos de quien ya no lo usa.
                        await PushRegistrar.shared.daDeBaja()
                        await auth.logout()
                    }
                }
                Button("Cancelar", role: .cancel) { }
            } message: {
                Text(store.isSharing
                     ? "Estás compartiendo tu ubicación. Al salir se detiene el seguimiento y se cierra la sesión."
                     : "Se cerrará tu sesión en este dispositivo.")
            }
            // Sin barra de navegación del sistema: en iOS 26 envuelve lo que se
            // pone en ella en botones de cristal redondos, y la marca quedaba
            // metida en un círculo, descentrada y sin sitio para el nombre ni el
            // usuario. La cabecera va dentro, en la primera fila (ver `cabecera`).
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    /// Lo que dice el botón de empezar: PARA QUÉ es la salida, justo donde se
    /// toca, y no en una lista más arriba que no se mira con prisa. "Sin
    /// carrera" solo a quien tiene carreras: a quien no tiene ninguna no le dice
    /// nada.
    /**
     Si al empezar hay que elegir entre "ahora" y "a la hora prevista".

     Pasa cuando la ruta trae una hora futura: antes la baliza se armaba sin
     preguntar, y para salir ya había que abrir una sección plegada y quitar la
     hora. Con dos botones, empezar es una decisión a la vista.

     Salvo en una carrera que está a menos de 18 h: ahí la hora oficial la pone
     el servidor diga lo que diga el móvil, así que "ahora" sería mentira. Se
     queda un solo botón, que dice para cuándo se arma.
     */
    private var dosFormasDeEmpezar: Bool {
        !store.isSharing && store.salidaQueArmaria != nil && !store.carreraImponeHora
    }

    /// Empezar a compartir, con la pregunta de la carrera cercana si toca.
    private func empieza() async {
        if store.selectedEventId == nil, let cerca = TrackingRules.nearbyEvent(store.events) {
            // Sin carrera elegida y con una cerca: se pregunta antes, que sin
            // ella la salida no sale en su mapa.
            carreraAPreguntar = cerca
        } else {
            Vibra.exito()
            await store.startSharing(title: tituloLimpio)
        }
    }

    private var textoCompartir: String {
        // Con la hora puesta y sin alternativa (carrera que impone su salida),
        // el botón dice para cuándo se arma: pulsarlo no empieza a emitir ya.
        if let salida = store.salidaQueArmaria {
            let base = store.activeEvent.map { "Compartir para \($0.name)" } ?? "Compartir"
            return "\(base) · \(Self.cuandoArranca(salida))"
        }
        if let ev = store.activeEvent { return "Compartir para \(ev.name)" }
        return store.events.isEmpty ? "Compartir mi ubicación" : "Compartir mi ubicación · sin carrera"
    }

    private var tituloLimpio: String? {
        let t = title.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    /// La cabecera de la pantalla: marca y "Baliza · usuario". Salir de la cuenta
    /// va al final (ver el `Form`).
    private var cabecera: some View {
        HStack(spacing: 12) {
            Image("MarcaApp")
                .resizable()
                .scaledToFit()
                .frame(width: 40, height: 40)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("SiLoSeNoSalgo")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.slate100)
                Text(["Baliza", auth.user?.username].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(Theme.slate400)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    /// Status header: state (armed / live / stopped), selected route, battery.
    @ViewBuilder
    private var statusContent: some View {
        if store.isStandby {
            VStack(alignment: .leading, spacing: 2) {
                Label("Armado · ahorrando batería", systemImage: "moon.zzz.fill")
                    .foregroundStyle(.yellow)
                Text("Empieza solo \(Self.cuandoArranca(store.startAt)). Deja la app abierta en segundo plano (no la cierres).")
                    .font(.caption).foregroundStyle(Theme.slate400)
                // Y una salida de la espera, aquí mismo. Una baliza armada solo
                // se desarma sola al llegar su hora, y esa hora vive en una
                // sección que se ESCONDE mientras se comparte: con una hora
                // heredada de una carrera lejana, la baliza se quedaba sin
                // grabar y sin forma de despertarla que no fuera pararla y
                // empezar de nuevo.
                Button {
                    Vibra.exito()
                    store.empiezaYa()
                } label: {
                    Label("Salir ahora · dejar de esperar", systemImage: "bolt.fill")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.sky500)
                .padding(.top, 4)
            }
        } else if store.isSharing, store.pendienteDeAlta {
            // Grabando de verdad, pero sin enlace todavía: hay que decir las dos
            // cosas. La primera tranquiliza —la ruta no se está perdiendo— y la
            // segunda evita que alguien mande un enlace que aún no existe.
            VStack(alignment: .leading, spacing: 2) {
                Label("Grabando · sin enlace todavía", systemImage: "clock.arrow.circlepath")
                    .foregroundStyle(.yellow)
                Text("Tu ruta se guarda desde que pulsaste. El enlace aparece en cuanto haya cobertura, y lo grabado se sube entero con su hora.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
        } else if store.isSharing {
            Label("Compartiendo en directo", systemImage: "dot.radiowaves.left.and.right")
                .foregroundStyle(.green)
        } else {
            Label("Detenido", systemImage: "pause.circle")
                .foregroundStyle(Theme.slate400)
        }
        if store.isSharing {
            if let name = store.activePlanName, !name.isEmpty {
                Label(name, systemImage: "map.fill")
                    .font(.subheadline)
            } else {
                Label("Sin ruta · trazado en vivo", systemImage: "scribble.variable")
                    .font(.subheadline)
                    .foregroundStyle(Theme.slate400)
            }
        }
        // En qué carrera se está emitiendo: al abrir la app a mitad de ruta,
        // saber que la baliza cuenta para el evento es tan importante como
        // saber que sigue transmitiendo.
        if store.isSharing, let ev = store.activeEvent {
            Label(ev.name, systemImage: "flag.checkered")
                .font(.subheadline)
                .foregroundStyle(Theme.sky500)
        }
        if store.isSharing, let act = store.effectiveActivity {
            HStack(spacing: 6) {
                Text(act.emoji)
                Text(store.activity == nil ? "\(act.label) · auto" : act.label)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.slate100)
        }
        if store.isSharing, store.batteryLevel >= 0 {
            batteryRow
        }
        if store.isSharing { resumenEnVivo }
    }

    /// TODO lo que hay que saber mientras se emite, arriba y en dos líneas.
    ///
    /// Esto vivía al final de la pantalla, en una sección "Estado" con una fila
    /// por dato, y con la carrera en marcha nadie baja hasta allí. Aquí cabe
    /// entero al lado del "compartiendo en directo", que es lo que se mira: a
    /// cuánta gente llega, si llega fresco y si el GPS va fino. El aviso de sin
    /// cobertura solo aparece cuando de verdad hay retraso.
    @ViewBuilder
    private var resumenEnVivo: some View {
        let retraso = store.lastSentAt.map { Date().timeIntervalSince($0) } ?? 0
        let atrasado = store.pendingCount > 0
            || (store.followerGapMeters.map { $0 > 150 } ?? false)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                if let viewers = store.activeViewers {
                    dato("\(viewers)", "eye.fill", viewers > 0 ? .green : Theme.slate400)
                }
                if store.lastSentAt != nil {
                    dato("hace \(gapTimeLabel(retraso))", "arrow.up.circle", sendFreshnessTint(retraso))
                }
                dato("\(store.pingCount)", "paperplane.fill", Theme.slate400)
                if store.pendingCount > 0 {
                    dato("\(store.pendingCount) en cola", "antenna.radiowaves.left.and.right.slash", .orange)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 12) {
                if let loc = store.lastLocation, loc.horizontalAccuracy >= 0 {
                    dato(String(format: "± %.0f m", loc.horizontalAccuracy), "location.circle", Theme.slate400)
                }
                if let gap = store.followerGapMeters {
                    dato("te ven a \(distanceLabel(gap))", "binoculars.fill", atrasado ? .orange : Theme.slate400)
                }
                if store.heldReadings > 0 {
                    dato("\(store.heldReadings) descartadas", "xmark.circle", Theme.slate400)
                }
                Spacer(minLength: 0)
            }
            if atrasado {
                Text("Sin cobertura: tu posición real va por delante de la que ven tus seguidores. Se pondrá al día al recuperar señal.")
                    .font(.caption2)
                    .foregroundStyle(Theme.slate400)
            }
        }
        .font(.footnote)
    }

    /// Un dato del resumen: icono y cifra, sin etiqueta. La etiqueta la dice el
    /// icono, y así caben todos en dos líneas.
    private func dato(_ texto: String, _ icono: String, _ color: Color) -> some View {
        Label(texto, systemImage: icono)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(color)
            .lineLimit(1)
    }

    /// Race tip: enabling iOS Low Power Mode extends autonomy and does NOT break
    /// GPS or uploads. Reflects whether it's currently on.
    @ViewBuilder
    private var lowPowerTip: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: store.lowPowerMode ? "checkmark.circle.fill" : "lightbulb.fill")
                .foregroundStyle(store.lowPowerMode ? .green : .yellow)
            VStack(alignment: .leading, spacing: 2) {
                if store.lowPowerMode {
                    Text("Modo de Bajo Consumo activo")
                        .fontWeight(.semibold).foregroundStyle(.green)
                    Text("Perfecto: alarga la batería y no afecta al GPS ni al envío de tu ubicación.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                } else {
                    Text("Consejo para ultras")
                        .fontWeight(.semibold)
                    Text("Activa el Modo de Bajo Consumo (Ajustes › Batería). Alarga mucho la autonomía y NO afecta al GPS ni al envío de tu posición.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
            }
        }
    }

    /// Live battery readout with the MEASURED drain and estimated autonomy.
    @ViewBuilder
    private var batteryRow: some View {
        let pct = Int((store.batteryLevel * 100).rounded())
        HStack(spacing: 8) {
            Image(systemName: store.isCharging ? "battery.100.bolt" : batteryIcon(store.batteryLevel))
                .foregroundStyle(store.isCharging ? .green : batteryTint(store.batteryLevel))
            if store.isCharging {
                Text("Cargando · \(pct)%").foregroundStyle(.green)
            } else if let drain = store.batteryDrainPerHour {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(pct)% · gasto real ~\(String(format: "%.1f", drain))%/h")
                        .fontWeight(.semibold)
                    if let h = store.estimatedHoursRemaining {
                        Text("Autonomía estimada ~\(autonomyLabel(h))")
                            .font(.caption).foregroundStyle(autonomyTint(h))
                    }
                }
            } else {
                Text("\(pct)% · calculando consumo…")
                    .foregroundStyle(Theme.slate400)
            }
        }
    }

    private func batteryIcon(_ level: Double) -> String {
        switch level {
        case ..<0.1: return "battery.0"
        case ..<0.4: return "battery.25"
        case ..<0.7: return "battery.50"
        case ..<0.95: return "battery.75"
        default: return "battery.100"
        }
    }

    private func batteryTint(_ level: Double) -> Color {
        level < 0.15 ? .red : (level < 0.30 ? .orange : .green)
    }

    /// "~18 h" or "~5 h 30 min" for shorter estimates.
    private func autonomyLabel(_ hours: Double) -> String {
        if hours >= 10 { return "\(Int(hours.rounded())) h" }
        let h = Int(hours)
        let m = Int((hours - Double(h)) * 60)
        return m > 0 ? "\(h) h \(m) min" : "\(h) h"
    }

    private func autonomyTint(_ hours: Double) -> Color {
        hours < 3 ? .red : (hours < 6 ? .orange : Theme.slate400)
    }

    @ViewBuilder
    private func sessionRow(_ session: TrackSessionSummary) -> some View {
        let active = store.isActive(session)
        // Purged = route already gone server-side (unpinned + past retention). Its
        // public link is dead, so we flag it "Caducado" and drop link-sharing.
        let purged = !active && store.isPurged(session)
        // Whether its trail is still on this device — what decides that an
        // expired session can still show its map offline and be exported.
        let hasLocal = LocalStore.hasTrail(session.id)
        // El TEXTO manda y ocupa el ancho: el nombre de una carrera es largo
        // ("ultra.100k.canfranccanfranc.2025") y antes competía por el sitio con
        // tres controles en la misma línea, así que se leía en un canal estrecho
        // y truncado. Ahora solo el menú acompaña al título; la chincheta y
        // "Reanudar" viven dentro de él, y "Continuar" —que es la única acción
        // frecuente— baja a su propia línea.
        VStack(alignment: .leading, spacing: 4) {
            // El título, para él solo: es lo que identifica la salida y los
            // nombres de carrera son largos. Todo lo demás —etiquetas, fecha,
            // caducidad— se reparte a lo ancho en las dos líneas de abajo en
            // vez de apilarse en cuatro renglones.
            HStack(spacing: 5) {
                if session.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(Theme.sky500)
                }
                Text(store.labelForSession(session))
                    .foregroundStyle(Theme.slate100)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                sessionMenu(session, purged: purged, hasLocal: hasLocal)
            }
            HStack(spacing: 6) {
                Text(active ? "Activo" : (purged ? "Caducado" : "Finalizado"))
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background((active ? Color.green : (purged ? Color.orange : Theme.slate700)).opacity(0.25))
                    .foregroundStyle(active ? .green : (purged ? .orange : Theme.slate400))
                    .clipShape(Capsule())
                    .fixedSize()
                if let act = session.activity {
                    // Movement type this session had (declared, or inferred at the
                    // moment it last stopped). Compact chip so it reads at a glance.
                    Text("\(act.emoji) \(act.label)")
                        .font(.caption2)
                        .foregroundStyle(Theme.slate400)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.slate800.opacity(0.7))
                        .clipShape(Capsule())
                        .fixedSize()
                }
                if hasLocal {
                    // Lo que decide si una sesión caducada sirve para algo:
                    // con traza en el móvil su mapa se sigue viendo offline.
                    Text("En el móvil")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.sky600.opacity(0.25))
                        .foregroundStyle(Theme.sky500)
                        .clipShape(Capsule())
                        .fixedSize()
                }
                Text("Salida \(startedLabel(session.startedAt))")
                    .font(.caption)
                    .foregroundStyle(Theme.slate400)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            // Lo que era una pila de renglones sueltos —cuándo se la vio, si
            // caduca y cuándo— cabe en uno: son datos cortos que se leen de
            // corrido, y separados en líneas hacían la ficha el doble de alta
            // sin decir más. La caducidad conserva su color, que es lo único
            // que ahí avisa de algo.
            HStack(spacing: 6) {
                if purged {
                    Text("Ruta ya no disponible")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                } else if let activity = activityLabel(session, active: active) {
                    Text(activity)
                        .font(.caption2)
                        .foregroundStyle(Theme.slate400)
                        .lineLimit(1)
                }
                if !active && !purged {
                    if session.isPinned {
                        Text("· Sin caducidad (fijado)")
                            .font(.caption2)
                            .foregroundStyle(Theme.slate400)
                            .lineLimit(1)
                    } else if let exp = expiryRemainingLabel(session.expiresAt) {
                        Text("· Caduca \(exp)")
                            .font(.caption2)
                            .foregroundStyle(expiryTint(session.expiresAt))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            // Continuar se queda a la vista: es lo que se pulsa al recuperar una
            // salida en marcha, con prisa y a veces con frío. Reanudar, que es
            // excepcional, se fue al menú.
            if active {
                Button("Continuar →") { store.continueSession(session.id) }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .foregroundStyle(Theme.sky500)
                    .padding(.top, 2)
            }
        }
    }

    /// Secondary actions for a session: rename it so it's identifiable later, and
    /// recover its follower link to consult the route (no need to reanudar), plus
    /// delete. Consolidated in a "⋯" menu to keep the row uncluttered. A purged
    /// session's link is dead, so link-sharing is dropped for it.
    @ViewBuilder
    private func sessionMenu(_ session: TrackSessionSummary, purged: Bool, hasLocal: Bool) -> some View {
        let link = store.shareLink(for: session.id)
        Menu {
            // Reanudar conserva el started_at original, así que solo tiene
            // sentido en una sesión recién terminada con sus datos intactos
            // ("parar y volver a compartir"). Una caducada resucitaría con una
            // salida vieja y sin ruta: mejor empezar otra, y por eso no se
            // ofrece.
            if !store.isActive(session) && !purged {
                Button { store.resumeSession(session.id) } label: {
                    Label("Reanudar", systemImage: "play.circle")
                }
            }
            // Una caducada no se puede conservar (sus datos ya no están), así
            // que la chincheta no significaría nada.
            if !purged {
                Button {
                    Task { await store.setPinned(session.id, !session.isPinned) }
                } label: {
                    Label(session.isPinned ? "Quitar chincheta" : "Fijar con chincheta",
                          systemImage: session.isPinned ? "pin.slash" : "pin")
                }
            }
            Button {
                renameText = session.title ?? ""
                pendingRename = session
            } label: {
                Label("Renombrar", systemImage: "pencil")
            }
            // Ver su mapa: con la traza en el móvil se abre el visor incrustado
            // sin cobertura (con sus notas y fotos); si no, queda el enlace
            // público, que solo existe mientras la ruta no haya caducado.
            if hasLocal || !purged {
                Button { openSessionMap(session, hasLocal: hasLocal, purged: purged) } label: {
                    Label("Ver mapa", systemImage: "map")
                }
            }
            if !purged {
                Button {
                    UIPasteboard.general.string = link
                } label: {
                    Label("Copiar enlace", systemImage: "link")
                }
                ShareLink(item: link) {
                    Label("Compartir enlace", systemImage: "square.and.arrow.up")
                }
            }
            Button { exportGuide(session) } label: {
                Label("Exportar guía offline", systemImage: "archivebox")
            }
            Divider()
            Button(role: .destructive) {
                pendingDelete = session
            } label: {
                Label("Eliminar", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Theme.slate400)
        .accessibilityLabel("Más opciones")
    }

    /// "Ver mapa" for a finished session: offline (from the local trail) when
    /// this device still keeps it, else the public link in the online viewer.
    private func openSessionMap(_ session: TrackSessionSummary, hasLocal: Bool, purged: Bool) {
        if hasLocal {
            do {
                try store.prepareOfflineReview(session)
                reviewSession = session
                return
            } catch {
                // A corrupt local trail shouldn't dead-end the action: fall back
                // to the online viewer while the route still exists server-side.
                if purged { guideError = "No se pudo leer la traza guardada en este móvil."; return }
            }
        }
        mapSession = session
    }

    private func exportGuide(_ session: TrackSessionSummary) {
        guideWorking = true
        Task {
            do {
                let url = try await guideLibrary.export(session: session)
                guideShareItem = GuideShareItem(url: url)
            } catch {
                guideError = error.localizedDescription
            }
            guideWorking = false
        }
    }

    private func openGuide(_ guide: LocalGuide) {
        do {
            try guideLibrary.prepareForViewing(guide)
            selectedGuide = guide
        } catch {
            guideError = error.localizedDescription
        }
    }

    /// Formats an epoch-MILLISECONDS instant as a short relative time
    /// (e.g. "hace 5 min"), falling back to HH:MM for older sessions.
    private func startedLabel(_ epochMs: Double) -> String {
        let date = Date(timeIntervalSince1970: epochMs / 1000)
        if Date().timeIntervalSince(date) < 24 * 3600 {
            return date.formatted(.relative(presentation: .named))
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Distinguishing per-session activity: when it was last seen / when it ended.
    /// This is what separates two sessions that share the same planned departure.
    private func activityLabel(_ s: TrackSessionSummary, active: Bool) -> String? {
        if active {
            if let u = s.updatedAt { return "visto \(startedLabel(u))" }
            return nil
        }
        if let e = s.endedAt { return "finalizada \(startedLabel(e))" }
        if let u = s.updatedAt { return "última pos. \(startedLabel(u))" }
        return nil
    }

    private func intervalLabel(_ s: Double) -> String {
        if s < 60 { return "\(Int(s)) s" }
        if s < 3600 { return "\(Int(s / 60)) min" }
        return "\(Int(s / 3600)) h"
    }

    private func batteryLabel(_ s: Double) -> String {
        if s <= 15 { return "Consumo alto" }
        if s <= 120 { return "Consumo medio" }
        return "Ahorro batería"
    }

    private func batteryColor(_ s: Double) -> Color {
        if s <= 15 { return .orange }
        if s <= 120 { return .yellow }
        return .green
    }

    private func distanceLabel(_ m: Double) -> String {
        m < 1000 ? "\(Int(m)) m" : String(format: "%.1f km", m / 1000)
    }

    /// Compact elapsed label for the follower-gap staleness ("hace 8 min").
    private func gapTimeLabel(_ s: TimeInterval) -> String {
        if s < 60 { return "\(Int(s)) s" }
        if s < 3600 { return "\(Int(s / 60)) min" }
        let h = Int(s / 3600); let m = Int((s - Double(h) * 3600) / 60)
        return m > 0 ? "\(h) h \(m) min" : "\(h) h"
    }

    /// Time left before a finished, unpinned session's route is purged
    /// ("en 25 min", "en 8 h", "en 2 d"). nil once already past — the row then
    /// shows "Caducado" instead. `expiresAtMs` is epoch MILLISECONDS.
    private func expiryRemainingLabel(_ expiresAtMs: Double) -> String? {
        let remaining = expiresAtMs / 1000 - Date().timeIntervalSince1970
        if remaining <= 0 { return nil }
        if remaining < 3600 { return "en \(max(1, Int(remaining / 60))) min" }
        if remaining < 24 * 3600 { return "en \(Int(remaining / 3600)) h" }
        return "en \(Int(remaining / (24 * 3600))) d"
    }

    /// Amber when the retention window is nearly up, so it reads as a warning.
    private func expiryTint(_ expiresAtMs: Double) -> Color {
        let remaining = expiresAtMs / 1000 - Date().timeIntervalSince1970
        return remaining < 6 * 3600 ? .orange : Theme.slate400
    }

    /// Colour for the "last upload" freshness: green while followers are getting
    /// live updates, amber as it lags, red once clearly behind (e.g. no coverage).
    private func sendFreshnessTint(_ elapsed: TimeInterval) -> Color {
        if elapsed < 120 { return .green }
        if elapsed < 360 { return .orange }
        return .red
    }

    /// Resolve the selected plan's route (fetches + decodes its geometry) and open
    /// the offline-map screen — usable before sharing, to prepare the map ahead.
    /// Prepara el mapa del recorrido que se va a seguir: la previsión elegida
    /// o, si se corre "la del evento", la base publicada por la organización —
    /// que no es una previsión propia y hay que traerla del share público.
    private func openMapDownloadForSelectedPlan() {
        resolvingRoute = true
        let planId = store.selectedPlanId
        downloadRouteName = planId.flatMap { id in store.plans.first(where: { $0.id == id })?.name }
            ?? store.activeEvent?.name
        Task {
            downloadPolyline = planId != nil
                ? await store.planPolyline(for: planId!)
                : await store.eventPolyline()
            resolvingRoute = false
            showMapDownload = true
        }
    }

    private func batteryLabelDist(_ m: Double) -> String {
        if m <= 50 { return "Consumo alto" }
        if m <= 250 { return "Consumo medio" }
        return "Ahorro batería"
    }

    private func batteryColorDist(_ m: Double) -> Color {
        if m <= 50 { return .orange }
        if m <= 250 { return .yellow }
        return .green
    }

    @ViewBuilder
    private func profileRow(_ p: SendProfile, title: String, detail: String, autonomy: String, color: Color, recommended: Bool = false) -> some View {
        Button {
            store.selectProfile(p)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: store.profile == p ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(store.profile == p ? Theme.sky500 : Theme.slate400)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title).foregroundStyle(Theme.slate100)
                        if recommended {
                            Text("Recomendado")
                                .font(.caption2).fontWeight(.semibold)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.sky600.opacity(0.25))
                                .foregroundStyle(Theme.sky500)
                                .clipShape(Capsule())
                        }
                    }
                    Text(detail).font(.caption).foregroundStyle(Theme.slate400)
                    Text(autonomy).font(.caption2).foregroundStyle(color)
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}

/**
 Las dos confirmaciones que faltaban: dejar de compartir, y unir una baliza en
 marcha a una carrera.

 Van en un modificador aparte y no en la pantalla, y no es cuestión de estilo:
 las dos cadenas de `TrackingView` —la del `Form` y la de fuera— están al límite
 de lo que el compilador de Swift acepta comprobar de una vez, y añadir un
 `confirmationDialog` en cualquiera de ellas lo tumba con «unable to type-check
 this expression in reasonable time». Aquí se comprueba por separado.

 No observa el store: los dos botones solo LLAMAN, y quien tiene que redibujarse
 al cambiar el estado es la pantalla, que ya lo observa.
 */
private struct ConfirmacionesDeBaliza: ViewModifier {
    @Binding var confirmandoParada: Bool
    @Binding var carreraAUnir: EventSummary?

    func body(content: Content) -> some View {
        content
            .confirmationDialog("¿Dejas de compartir?",
                                isPresented: $confirmandoParada, titleVisibility: .visible) {
                Button("Sí, dejar de compartir", role: .destructive) {
                    Vibra.fin()
                    Task { @MainActor in await TrackingStore.shared.stopSharing() }
                }
                Button("No, sigo", role: .cancel) {}
            } message: {
                Text("Se cierra la baliza y tu enlace deja de moverse. La traza se conserva. Si solo te paras un rato, usa la pausa.")
            }
            .confirmationDialog(
                carreraAUnir.map { "¿Unes esta baliza a \($0.name)?" } ?? "",
                isPresented: Binding(
                    get: { carreraAUnir != nil },
                    set: { if !$0 { carreraAUnir = nil } }
                ),
                titleVisibility: .visible,
                presenting: carreraAUnir
            ) { ev in
                Button("Sí, corro \(ev.name)") {
                    Vibra.eleccion()
                    Task { @MainActor in TrackingStore.shared.setEvent(ev.id) }
                }
                Button("Cancelar", role: .cancel) {}
            } message: { ev in
                Text("Su salida oficial (\(TrackingView.whenLabel(ev.startsAt))) pasa a ser la de esta baliza, y apareces en su mapa. Cambia el ritmo y los cortes de lo que ya llevas grabado.")
            }
    }
}
