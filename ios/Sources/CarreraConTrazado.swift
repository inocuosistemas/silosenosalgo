import ActivityKit
import CoreLocation
import Foundation

/**
 La tarjeta de carrera con una RUTA propia, sin carrera detrás: se elige una
 ruta de la cuenta y una hora de salida, se empieza a mano y sigue el GPS por
 su cuenta, sin baliza y sin compartir la posición con nadie.

 Lo de la tarjeta —tramos, previsión, cortes si la ruta los tiene— es lo mismo
 que en una carrera (ver `CarreraEnDirecto`); lo que cambia es de dónde salen
 los datos: la ruta y su hora, en vez de la organización. Y no hay corredores.

 Como el viaje en directo (ver `ViajeEnDirecto`): se guarda lo necesario para
 que, si iOS cierra la app, al volver a abrirla se enganche a la tarjeta que
 siga en pantalla y vuelva a encender el GPS.
 */
@MainActor
final class CarreraConTrazado: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = CarreraConTrazado()

    @Published private(set) var enMarcha = false
    @Published private(set) var preparando = false
    @Published var error: String?

    struct Diagnostico: Equatable {
        var posiciones = 0
        var ultima: Date?
        var ultimoError: Double?
        /// El km de la ruta de la última posición; nil si iba fuera de ella.
        var km: Double?
        var fueraDeRuta = false
    }
    @Published private(set) var diagnostico = Diagnostico()

    private let gps = CLLocationManager()
    private var sesion: CLBackgroundActivitySession?
    private var ruta: PlanGeometry.Route?
    private var kmAnterior: Double?

    /// Lo que se guarda para retomar: con qué ruta (su clave en disco) y cómo
    /// se llama.
    private struct Guardada: Codable {
        var clave: String
        var nombre: String
    }
    private static let claveGuardada = "carrera.trazado"

    static var hayUnaGuardada: Bool { UserDefaults.standard.data(forKey: claveGuardada) != nil }

    override init() {
        super.init()
        gps.delegate = self
        CarreraEnDirecto.shared.alAcabar = { [weak self] in self?.acabada() }
    }

    /// La clave en disco de una ruta: su recorrido y su hoja se guardan como
    /// los de una sesión de la baliza (ver `LocalStore`).
    static func clave(de planId: String) -> String { "trazado-\(planId)" }

    /**
     La hoja de tramos de una ruta con una hora de salida: se baja la ruta (hace
     falta cobertura) y la calcula la web, como en una carrera pero sin ajustes
     de organización. Sirve también para la vista previa.
     */
    static func hoja(plan: PlanSummary, salida: Date, token: String) async throws -> HojaDeTramos {
        let clave = clave(de: plan.id)
        // La de un GPX cargado sin cuenta está en el móvil (ver `PlanesLocales`).
        let bytes: Data
        if let local = PlanesLocales.bytes(plan.id) { bytes = local }
        else { bytes = try await API.fetchPlanPayload(token: token, planId: plan.id) }
        try? bytes.write(to: LocalStore.planURL(clave), options: .atomic)
        let web = GpxImporter()
        defer { web.suelta() }
        let datos = try await web.hojaDeTramos(planGz: bytes, ajustes: nil,
                                               salidaMs: salida.timeIntervalSince1970 * 1000)
        try? datos.write(to: LocalStore.hojaURL(clave), options: .atomic)
        return try JSONDecoder().decode(HojaDeTramos.self, from: datos)
    }

    // MARK: Empezar y terminar

    func empieza(plan: PlanSummary, salida: Date, token: String) async {
        error = nil
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = "Las Actividades en Directo están apagadas para esta app. Actívalas en Ajustes ▸ SiLoSeNoSalgo."
            return
        }
        preparando = true
        defer { preparando = false }
        do {
            let hoja = try await Self.hoja(plan: plan, salida: salida, token: token)
            let clave = Self.clave(de: plan.id)
            guard let r = PlanGeometry.route(forSession: clave) else {
                throw ErrorDeCarrera("La ruta no tiene recorrido.")
            }
            try arranca(hoja: hoja, ruta: r, nombre: plan.name, clave: clave)
        } catch let e as ErrorDeCarrera {
            error = e.errorDescription
        } catch {
            self.error = "No se ha podido preparar la ruta (¿sin cobertura?): \(error.localizedDescription)"
        }
    }

    private func arranca(hoja: HojaDeTramos, ruta r: PlanGeometry.Route, nombre: String, clave: String) throws {
        try CarreraEnDirecto.shared.empiezaConTrazado(hoja: hoja, nombre: nombre)
        ruta = r
        kmAnterior = nil
        diagnostico = Diagnostico()
        if let d = try? JSONEncoder().encode(Guardada(clave: clave, nombre: nombre)) {
            UserDefaults.standard.set(d, forKey: Self.claveGuardada)
        }
        enMarcha = true
        enciendeGPS()
    }

    /// Solo para el arranque de prueba (`-PruebaDeCarreraConTrazado`): con una
    /// hoja y una ruta fijas, sin bajar nada.
    func empiezaDePrueba(hoja: HojaDeTramos, ruta r: PlanGeometry.Route, nombre: String) {
        do { try arranca(hoja: hoja, ruta: r, nombre: nombre, clave: "trazado-prueba") } catch {
            self.error = (error as? ErrorDeCarrera)?.errorDescription ?? error.localizedDescription
        }
    }

    func termina() {
        CarreraEnDirecto.shared.termina()
        acabada()
    }

    /// La tarjeta se ha ido (terminada, en meta o quitada): fuera el GPS y lo
    /// guardado.
    private func acabada() {
        guard enMarcha || Self.hayUnaGuardada else { return }
        paraGPS()
        UserDefaults.standard.removeObject(forKey: Self.claveGuardada)
        ruta = nil
        enMarcha = false
    }

    /// Al abrir la app (o relanzarla iOS): si había una tarjeta de ruta en
    /// marcha, se engancha a ella; si ya no está, se limpia.
    func reanuda() {
        guard !enMarcha,
              let d = UserDefaults.standard.data(forKey: Self.claveGuardada),
              let g = try? JSONDecoder().decode(Guardada.self, from: d)
        else { return }
        guard let datos = try? Data(contentsOf: LocalStore.hojaURL(g.clave)),
              let hoja = try? JSONDecoder().decode(HojaDeTramos.self, from: datos),
              let r = PlanGeometry.route(forSession: g.clave),
              CarreraEnDirecto.shared.reenganchaTrazado(hoja: hoja)
        else {
            UserDefaults.standard.removeObject(forKey: Self.claveGuardada)
            paraGPS()
            return
        }
        ruta = r
        enMarcha = true
        enciendeGPS()
    }

    // MARK: GPS

    private func enciendeGPS() {
        if gps.authorizationStatus == .notDetermined { gps.requestWhenInUseAuthorization() }
        // Como la baliza en carrera: sobre el terreno hace falta precisión
        // para situarse en la ruta (a más de 250 m, fuera de ella).
        gps.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        gps.distanceFilter = 10
        gps.activityType = .fitness
        gps.pausesLocationUpdatesAutomatically = false
        gps.allowsBackgroundLocationUpdates = true
        gps.showsBackgroundLocationIndicator = true
        sesion = CLBackgroundActivitySession()
        gps.startUpdatingLocation()
        // De respaldo, para que iOS reabra la app si la cierra (ver el viaje).
        gps.startMonitoringSignificantLocationChanges()
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

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func llega(_ pos: CLLocation) {
        guard enMarcha, let r = ruta else { return }
        diagnostico.posiciones += 1
        diagnostico.ultima = pos.timestamp
        diagnostico.ultimoError = pos.horizontalAccuracy
        guard pos.horizontalAccuracy <= 100 else { return }
        let km = Self.km(de: pos.coordinate, en: r, antes: kmAnterior)
        diagnostico.km = km
        diagnostico.fueraDeRuta = km == nil
        guard let km else { return }
        kmAnterior = km
        CarreraEnDirecto.shared.recibe(km: km, en: pos.timestamp)
    }

    /// El km de la ruta: cerca de donde se iba y, si no (la app dormida y se
    /// ha avanzado mucho), en toda la ruta. Nil fuera de ella.
    static func km(de c: CLLocationCoordinate2D, en r: PlanGeometry.Route, antes: Double?) -> Double? {
        PlanGeometry.projectKm(r, lat: c.latitude, lon: c.longitude, previousKm: antes)
            ?? (antes == nil ? nil : PlanGeometry.projectKm(r, lat: c.latitude, lon: c.longitude, previousKm: nil))
    }
}
