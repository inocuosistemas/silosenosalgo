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
            manager.desiredAccuracy = kCLLocationAccuracyBest
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
    func configureDistance(_ meters: Double) {
        manager.distanceFilter = meters
        manager.desiredAccuracy = meters <= 100 ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters
    }

    func start() {
        enableBackgroundIfAuthorized()
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
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
