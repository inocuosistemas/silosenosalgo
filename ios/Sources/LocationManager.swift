import CoreLocation

/// Thin wrapper around CLLocationManager configured for continuous, background
/// location updates. It delivers every fix via `onLocation`; the throttling to
/// the user-chosen interval happens in `TrackingStore`.
///
/// Background GPS requires: the `location` UIBackgroundMode (Info.plist),
/// `allowsBackgroundLocationUpdates = true`, and ideally "Always" authorization.
/// With the screen locked, iOS keeps delivering fixes only while standard
/// location updates are active (the blue status indicator is shown).
final class LocationManager: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    var onLocation: ((CLLocation) -> Void)?
    var onAuthChange: ((CLAuthorizationStatus) -> Void)?

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
    }

    func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    /// Tie GPS power to the upload interval. Continuous high-accuracy GPS is the
    /// main battery drain (not upload frequency), so wider intervals switch to
    /// coarser accuracy + a distance filter — the real saver for ultras.
    func configure(interval: TimeInterval) {
        if interval <= 30 {
            // Precision tier: push the GPS as hard as it goes. BestForNavigation
            // adds sensor fusion over plain Best and is the only software lever
            // that gets below ~10 m in the open — at a higher battery cost, which
            // is acceptable here since this is already the high-power profile.
            manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            manager.distanceFilter = kCLDistanceFilterNone
        } else if interval <= 120 {
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 10
        } else {
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 25
        }
    }

    /// Distance-based mode: only deliver a fix after moving `meters`. Accuracy
    /// relaxes with distance to save battery.
    ///
    /// Aquí está el ahorro de verdad —`HundredMeters` deja al sistema apoyarse
    /// en antenas y wifi y dosificar el GPS— y por eso el umbral está en 100 y
    /// no más arriba: el perfil de ahorro pide 150 m justamente para caer de
    /// este lado sin destrozar la traza. El `distanceFilter` por sí solo no
    /// apaga nada, solo decide cuándo se entrega la posición.
    func configureDistance(_ meters: Double) {
        // Los metros del perfil NO se le pasan al sistema como filtro: que las
        // entregue todas y que sea el código quien decida cuáles graba (ver
        // `tocaGrabarPorDistancia`).
        //
        // Con el filtro del perfil puesto aquí —100 m— iOS no entrega NADA
        // mientras no se acumulan esos metros; y sin lecturas que la despierten,
        // la app se suspende, y con ella el temporizador del latido, que era
        // justo lo que tenía que cubrir el estar parado. El mecanismo de rescate
        // se apagaba exactamente cuando hacía falta. Medido el 17/09/2026
        // paseando: cinco puntos en diez minutos, y por la mañana un agujero de
        // 19 minutos en mitad de la traza.
        //
        // Entregar más lecturas no gasta más: lo que consume es tener el
        // receptor encendido y AFINADO, y eso lo sigue decidiendo la precisión
        // pedida a partir de los metros del perfil, que no cambia. Es lo mismo
        // que ya hace el modo por tiempo en sus intervalos cortos.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.desiredAccuracy = meters <= 100 ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters
    }

    /// Ultra-low-power "armed" mode used before a planned start: keep a location
    /// session alive — so iOS doesn't suspend the app and it can auto-begin at
    /// the start time — but at minimal cost (network/cell positioning, no GPS).
    /// The store uploads nothing while in this mode; it exists only to keep the
    /// app running and let a timer detect when the start arrives.
    func configureStandby() {
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        manager.distanceFilter = 3000
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start() {
        enableBackgroundIfAuthorized()
        manager.startUpdatingLocation()
        // Safety net: significant-location-change monitoring lets iOS RELAUNCH the
        // app in the background if it was killed (needs "Always"). We only use it as
        // a relaunch trigger — on wake we restart precise updates. Very low power.
        if manager.authorizationStatus == .authorizedAlways {
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
    }

    /// Request a single fresh fix on demand, ignoring the active distance filter.
    /// Used by the stationary heartbeat: while stopped, the distance filter
    /// delivers no callbacks, so the last known point can sit up to `distanceFilter`
    /// metres behind the real spot. This forces the current position; it arrives
    /// via the normal `didUpdateLocations` path and coexists with the continuous
    /// session already running.
    func requestOneShot() {
        manager.requestLocation()
    }

    private func enableBackgroundIfAuthorized() {
        let s = manager.authorizationStatus
        if s == .authorizedAlways || s == .authorizedWhenInUse {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
        }
    }

    // MARK: CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let loc = locations.last { onLocation?(loc) }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        enableBackgroundIfAuthorized()
        onAuthChange?(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient errors (e.g. momentary signal loss) are ignored; the next
        // successful fix resumes pinging.
    }
}
