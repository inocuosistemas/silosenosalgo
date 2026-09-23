import ActivityKit
import CoreLocation
import Foundation
import UserNotifications

/**
 Las REGLAS del viaje en directo, sueltas y sin estado para poder probarlas:
 cómo se pasa de una posición a lo que enseña la tarjeta, cuándo merece la pena
 mandarla otra vez y cuándo se ha llegado.
 */
enum ReglasDeViaje {
    /// Sin actualización en este tiempo, el sistema la da por caducada y la
    /// tarjeta dice «sin señal» (ver `ViajeActividad`).
    static let caducidad: TimeInterval = 20 * 60

    /// A cuánto del destino se da por llegado. Dos kilómetros en un vuelo —el
    /// aeropuerto no está en el centro de la ciudad—, pero mucho menos en un
    /// trayecto corto: andando cinco kilómetros no se puede llegar a los tres.
    static func radioDeLlegada(totalKm: Double) -> Double {
        max(0.1, min(2, totalKm * 0.02))
    }

    /// Lo que enseña la tarjeta con una posición.
    static func estado(en pos: CLLocation, de a: ViajeAtributos, ahora: Date = Date()) -> ViajeAtributos.ContentState {
        let total = a.totalKm
        let resta = Trayecto.km(pos.coordinate, a.destino.coordenada)
        let llegado = resta <= radioDeLlegada(totalKm: total)
        return ViajeAtributos.ContentState(
            restanteKm: resta,
            progreso: llegado ? 1 : Trayecto.progreso(restante: resta, total: total),
            llegada: llegado ? nil : llegada(restanteKm: resta, velocidad: pos.speed, ahora: ahora),
            llegado: llegado,
            actualizado: ahora)
    }

    /// A qué hora se llega yendo a esta velocidad (metros por segundo), o nil
    /// si no hay con qué calcularla. Se descarta lo que caiga a más de un día:
    /// un avión rodando por la pista a 30 km/h daba llegadas a dos semanas vista.
    static func llegada(restanteKm: Double, velocidad: CLLocationSpeed, ahora: Date) -> Date? {
        guard velocidad > 1 else { return nil }
        let segundos = restanteKm * 1000 / velocidad
        guard segundos < 24 * 3600 else { return nil }
        return ahora.addingTimeInterval(segundos)
    }

    /// Si hay que mandar la tarjeta otra vez. Cada vez que se manda, el sistema
    /// la vuelve a pintar y gasta batería; así que solo cuando se nota: cuando
    /// ha bajado lo que falta una milésima del viaje (10 km en uno de 10.000,
    /// 200 m en uno de 200) o, como mucho, cada minuto, para que la hora de
    /// llegada no se quede vieja.
    static func mereceMandar(_ nuevo: ViajeAtributos.ContentState,
                             despuesDe viejo: ViajeAtributos.ContentState?,
                             totalKm: Double) -> Bool {
        guard let viejo else { return true }
        if nuevo.llegado != viejo.llegado { return true }
        if abs(nuevo.restanteKm - viejo.restanteKm) >= max(0.05, totalKm * 0.001) { return true }
        return nuevo.actualizado.timeIntervalSince(viejo.actualizado) >= 60
    }

    /**
     El error máximo que se admite en una posición, en metros.

     Depende del viaje: para uno de 2.000 km, una posición con 5 km de error
     sirve de sobra. Con un tope fijo de 1 km, un móvil con la «Ubicación
     exacta» apagada —que da posiciones de varios km de error— no llegaba a
     mandar NINGUNA, y la tarjeta se quedó en el origen un viaje entero,
     Barcelona–Estambul. Nunca menos de 1 km; un 1 % del viaje si es más.
     */
    static func precisionAdmitida(totalKm: Double) -> CLLocationAccuracy {
        max(1000, totalKm * 1000 * 0.01)
    }

    /// El tipo de movimiento, que ajusta cómo filtra el GPS: en avión no hay
    /// carreteras a las que pegar la posición.
    static func tipoDeActividad(_ t: TransporteDeViaje) -> CLActivityType {
        switch t {
        case .avion: return .airborne
        case .coche, .autobus: return .automotiveNavigation
        case .tren, .barco: return .otherNavigation
        case .bici, .andando: return .fitness
        }
    }
}

/**
 El VIAJE EN DIRECTO: arranca la Actividad, sigue el GPS y la va actualizando.

 Lo tiene que hacer la app, y con la app abierta: Apple no deja arrancar una
 Actividad en Directo en segundo plano. Una vez arrancada, la app puede cerrarse
 —se queda despierta en segundo plano por el GPS— y la tarjeta sigue avanzando.

 Si se pone hora de salida, a esa hora llega un aviso; al tocarlo se abre la app
 y arranca sola (ver `programa`). Arrancar sin tocar nada exige un push desde el
 servidor, que es un paso posterior.
 */
@MainActor
final class ViajeEnDirecto: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = ViajeEnDirecto()

    @Published private(set) var actividad: Activity<ViajeAtributos>?
    @Published private(set) var estado: ViajeAtributos.ContentState?
    /// El que está programado con aviso y todavía no ha empezado.
    @Published private(set) var programado: ViajeProgramado?
    @Published var error: String?

    /// Lo que ha pasado con el GPS en este viaje, para enseñarlo: si falla,
    /// que se vea en pantalla por qué, en vez de tener que adivinarlo.
    struct Diagnostico: Equatable {
        var recibidas = 0
        var descartadas = 0
        /// El error de la última posición recibida, en metros.
        var ultimoError: Double?
        var ultimaRecibida: Date?
        /// Cuándo se encendió el GPS por última vez (al empezar, al volver la
        /// app delante, al relanzarla iOS).
        var encendido: Date?
        /// El último fallo que ha dado el GPS, tal cual. Antes se ignoraba en
        /// silencio, y un viaje entero se quedó sin avanzar sin saber por qué.
        var ultimoFallo: String?
        var ultimoFalloA: Date?
    }
    @Published private(set) var diagnostico = Diagnostico()
    @Published private(set) var permiso: CLAuthorizationStatus = .notDetermined
    @Published private(set) var exacta = true

    private let gps = CLLocationManager()
    /// Mantiene el permiso de GPS en segundo plano con «Mientras se usa», y
    /// ayuda a retomar el viaje si iOS relanza la app.
    private var sesion: CLBackgroundActivitySession?
    private var vigilancia: Task<Void, Never>?

    static let idDelAviso = "viaje-en-directo"
    private static let claveProgramado = "viaje.programado"

    override init() {
        super.init()
        gps.delegate = self
        programado = Self.leeProgramado()
        permiso = gps.authorizationStatus
        exacta = gps.accuracyAuthorization == .fullAccuracy
    }

    /// Al volver la app a primer plano (o al relanzarla iOS): se retoma el
    /// viaje si había uno, y se vuelve a encender el GPS por si iOS lo había
    /// parado. Barato si ya estaba encendido.
    func alVolver() {
        if let a = actividad {
            enciendeGPS(para: a.attributes)
        } else {
            reanuda()
        }
    }

    var enMarcha: Bool { actividad != nil }

    // MARK: Empezar y terminar

    /// Arranca ya. Si había otro viaje en marcha, lo termina antes: solo se
    /// sigue uno a la vez.
    func empieza(_ atributos: ViajeAtributos) {
        error = nil
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = "Las Actividades en Directo están apagadas para esta app. Actívalas en Ajustes ▸ SiLoSeNoSalgo."
            return
        }
        termina()
        diagnostico = Diagnostico()
        let inicial = ViajeAtributos.ContentState(
            restanteKm: atributos.totalKm, progreso: 0, actualizado: Date())
        do {
            let a = try Activity.request(
                attributes: atributos,
                content: ActivityContent(state: inicial,
                                         staleDate: Date().addingTimeInterval(ReglasDeViaje.caducidad)),
                pushType: nil)
            engancha(a)
            estado = inicial
            olvidaProgramado()
        } catch {
            self.error = "No se ha podido empezar: \(error.localizedDescription)"
        }
    }

    /// Termina ya, quitándola de la pantalla de bloqueo.
    func termina() {
        paraGPS()
        vigilancia?.cancel()
        guard let a = actividad else { return }
        let final = estado ?? a.content.state
        Task { await a.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: .immediate) }
        actividad = nil
        estado = nil
    }

    /// Al arrancar la app: si iOS la había cerrado con un viaje en marcha, se
    /// vuelve a enganchar a él y a encender el GPS.
    func reanuda() {
        guard actividad == nil,
              let a = Activity<ViajeAtributos>.activities.first(where: { $0.activityState == .active })
        else { return }
        engancha(a)
        estado = a.content.state
    }

    private func engancha(_ a: Activity<ViajeAtributos>) {
        actividad = a
        enciendeGPS(para: a.attributes)
        // Si la quitan desde la pantalla de bloqueo, o el sistema la acaba por
        // las 8 horas, se apaga el GPS: seguir gastando batería para nada es lo
        // peor que puede hacer esto.
        vigilancia?.cancel()
        vigilancia = Task { [weak self] in
            for await e in a.activityStateUpdates where e == .dismissed || e == .ended {
                await MainActor.run {
                    guard let self, self.actividad?.id == a.id else { return }
                    self.paraGPS()
                    self.actividad = nil
                    self.estado = nil
                }
                return
            }
        }
    }

    // MARK: GPS

    private func enciendeGPS(para a: ViajeAtributos) {
        if gps.authorizationStatus == .notDetermined {
            gps.requestWhenInUseAuthorization()
        }
        gps.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // Sin filtro de distancia: con él (se probó uno de 2 km en un viaje
        // largo), el móvil QUIETO no daba ninguna posición, a los 20 minutos
        // la tarjeta caducaba y parecía que no había GPS. Lo que gasta batería
        // es la precisión pedida, no cuántas posiciones llegan; y ya se manda
        // la tarjeta solo cuando se nota (ver `ReglasDeViaje.mereceMandar`).
        gps.distanceFilter = kCLDistanceFilterNone
        gps.activityType = ReglasDeViaje.tipoDeActividad(a.transporte)
        gps.pausesLocationUpdatesAutomatically = false
        gps.allowsBackgroundLocationUpdates = true
        gps.showsBackgroundLocationIndicator = true
        sesion = CLBackgroundActivitySession()
        gps.startUpdatingLocation()
        diagnostico.encendido = Date()
        // De respaldo, los cambios de ubicación importantes (de antena en
        // antena): si iOS cierra la app en pleno viaje, estos la vuelven a
        // abrir en segundo plano y el viaje se retoma (ver `AppDelegate`).
        // Con el GPS normal no pasa: una app cerrada no se reabre sola.
        gps.startMonitoringSignificantLocationChanges()
        // Con la «Ubicación exacta» apagada, se pide durante este viaje.
        if gps.accuracyAuthorization == .reducedAccuracy {
            gps.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "ViajeEnDirecto")
        }
    }

    private func paraGPS() {
        gps.stopMonitoringSignificantLocationChanges()
        gps.stopUpdatingLocation()
        gps.allowsBackgroundLocationUpdates = false
        sesion?.invalidate()
        sesion = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let pos = locations.last(where: { $0.horizontalAccuracy >= 0 }) else { return }
        Task { @MainActor in self.llega(pos) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let p = manager.authorizationStatus
        let e = manager.accuracyAuthorization == .fullAccuracy
        Task { @MainActor in
            self.permiso = p
            self.exacta = e
        }
    }

    /// Una posición del GPS: se cuenta, y si su error es admisible para este
    /// viaje (ver `ReglasDeViaje.precisionAdmitida`), se usa.
    private func llega(_ pos: CLLocation) {
        guard let a = actividad else { return }
        diagnostico.ultimoError = pos.horizontalAccuracy
        diagnostico.ultimaRecibida = pos.timestamp
        guard pos.horizontalAccuracy <= ReglasDeViaje.precisionAdmitida(totalKm: a.attributes.totalKm) else {
            diagnostico.descartadas += 1
            return
        }
        diagnostico.recibidas += 1
        recibe(pos)
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Sin señal no se hace nada con la tarjeta —caduca sola y dice de qué
        // hora es la última posición—, pero el fallo se apunta para verlo.
        let texto = Self.describe(error)
        Task { @MainActor in
            self.diagnostico.ultimoFallo = texto
            self.diagnostico.ultimoFalloA = Date()
        }
    }

    nonisolated private static func describe(_ error: Error) -> String {
        guard let e = error as? CLError else { return error.localizedDescription }
        switch e.code {
        case .locationUnknown: return "sin posición por ahora (el GPS sigue buscando)"
        case .denied: return "permiso de ubicación denegado"
        case .network: return "sin red para situarse"
        default: return "error \(e.code.rawValue): \(e.localizedDescription)"
        }
    }

    /// Pedir una posición AHORA y usarla, sin esperar a las del GPS normal.
    /// Para el botón de «En marcha»: si no avanza, se ve al momento si llega
    /// una posición o qué fallo da.
    func pidePosicionAhora() {
        diagnostico.ultimoFallo = nil
        if let a = actividad { enciendeGPS(para: a.attributes) }
        gps.requestLocation()
    }

    private func recibe(_ pos: CLLocation) {
        guard let a = actividad else { return }
        let nuevo = ReglasDeViaje.estado(en: pos, de: a.attributes)
        guard ReglasDeViaje.mereceMandar(nuevo, despuesDe: estado, totalKm: a.attributes.totalKm) else { return }
        estado = nuevo
        let contenido = ActivityContent(
            state: nuevo, staleDate: Date().addingTimeInterval(ReglasDeViaje.caducidad))
        if nuevo.llegado {
            // Llegado: se queda un rato con «Has llegado» y se va sola. El GPS
            // se apaga ya.
            paraGPS()
            vigilancia?.cancel()
            actividad = nil
            Task {
                await a.end(contenido, dismissalPolicy: .after(Date().addingTimeInterval(30 * 60)))
            }
        } else {
            Task { await a.update(contenido) }
        }
    }

    // MARK: Con hora de salida

    /// Programa el aviso de la hora de salida. Al tocarlo se abre la app y el
    /// viaje empieza solo (ver `empiezaElProgramado`).
    func programa(_ atributos: ViajeAtributos, a hora: Date) async {
        error = nil
        guard await AvisosDeContadores.pidePermiso() else {
            error = "Sin permiso para avisos no se puede programar. Actívalo en Ajustes ▸ SiLoSeNoSalgo ▸ Notificaciones."
            return
        }
        let p = ViajeProgramado(atributos: atributos, hora: hora)
        guard let datos = try? JSONEncoder().encode(p) else { return }
        UserDefaults.standard.set(datos, forKey: Self.claveProgramado)
        programado = p

        let aviso = UNMutableNotificationContent()
        aviso.title = atributos.titulo?.isEmpty == false ? atributos.titulo! : "Hora de salir"
        aviso.body = "\(atributos.origen.nombre) → \(atributos.destino.nombre). Toca para empezar a seguir el viaje."
        aviso.sound = .default
        aviso.interruptionLevel = .timeSensitive
        let cuando = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: hora)
        let peticion = UNNotificationRequest(
            identifier: Self.idDelAviso, content: aviso,
            trigger: UNCalendarNotificationTrigger(dateMatching: cuando, repeats: false))
        do {
            try await UNUserNotificationCenter.current().add(peticion)
        } catch {
            self.error = "No se ha podido programar el aviso: \(error.localizedDescription)"
        }
    }

    /// Lo que pasa al tocar el aviso: empezar el que estaba programado.
    func empiezaElProgramado() {
        guard let p = programado else { return }
        empieza(p.atributos)
    }

    func cancelaElProgramado() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.idDelAviso])
        olvidaProgramado()
    }

    private func olvidaProgramado() {
        UserDefaults.standard.removeObject(forKey: Self.claveProgramado)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.idDelAviso])
        programado = nil
    }

    private static func leeProgramado() -> ViajeProgramado? {
        guard let d = UserDefaults.standard.data(forKey: claveProgramado) else { return nil }
        return try? JSONDecoder().decode(ViajeProgramado.self, from: d)
    }
}

/// Un viaje guardado para empezar a una hora.
struct ViajeProgramado: Codable, Equatable {
    var atributos: ViajeAtributos
    var hora: Date

    static func == (a: Self, b: Self) -> Bool {
        a.hora == b.hora && a.atributos.origen == b.atributos.origen && a.atributos.destino == b.atributos.destino
    }
}
