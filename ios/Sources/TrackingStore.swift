import Foundation
import CoreLocation

/// Orchestrates a live-sharing session: creates it on the backend, then pings
/// the latest GPS fix at the chosen interval. Location updates arrive
/// continuously (foreground + background); we upload only once per interval.
@MainActor
final class TrackingStore: ObservableObject {
    @Published var isSharing = false
    @Published var sessionToken: String?
    @Published var intervalSeconds: Double = 15 {
        didSet { location.configure(interval: intervalSeconds) }
    }
    @Published var lastSentAt: Date?
    @Published var pingCount = 0
    @Published var lastError: String?
    @Published var lastLocation: CLLocation?
    @Published var authStatus: CLAuthorizationStatus = .notDetermined

    private let token: String
    private let location = LocationManager()
    private var lastSendAttempt: Date = .distantPast

    init(token: String) {
        self.token = token
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

    func startSharing(title: String?) async {
        lastError = nil
        location.requestAuthorization()
        do {
            let res = try await API.createTrack(token: token, title: title)
            sessionToken = res.id
            isSharing = true
            pingCount = 0
            lastSentAt = nil
            lastSendAttempt = .distantPast
            location.configure(interval: intervalSeconds)
            location.start()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? "No se pudo iniciar el seguimiento."
        }
    }

    func stopSharing() async {
        location.stop()
        if let t = sessionToken { await API.end(token: token, id: t) }
        isSharing = false
        sessionToken = nil
    }

    private func handleLocation(_ loc: CLLocation) {
        lastLocation = loc
        guard isSharing, let id = sessionToken else { return }
        let now = Date()
        guard now.timeIntervalSince(lastSendAttempt) >= intervalSeconds else { return }
        lastSendAttempt = now

        let fix = Fix(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            trackKm: nil,
            speed: loc.speed >= 0 ? loc.speed : nil,
            heading: loc.course >= 0 ? loc.course : nil,
            accuracy: loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil,
            altitude: loc.verticalAccuracy >= 0 ? loc.altitude : nil,
            fixAt: loc.timestamp.timeIntervalSince1970 * 1000
        )
        Task { await send(fix, id: id) }
    }

    private func send(_ fix: Fix, id: String) async {
        do {
            try await API.ping(token: token, id: id, fix: fix)
            lastSentAt = Date()
            pingCount += 1
            lastError = nil
        } catch {
            if let e = error as? APIError, e.status == 410 {
                await stopSharing() // session ended/expired on the server
            } else {
                lastError = (error as? APIError)?.errorDescription ?? "Fallo al enviar la posición."
            }
        }
    }
}
