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
    @Published var plans: [PlanSummary] = []
    @Published var selectedPlanId: String? = nil
    @Published var sessions: [TrackSessionSummary] = []
    /// How long a finished route stays viewable (hours). Sent to the backend on stop.
    @Published var retainHours: Double = 24

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

    func loadPlans() async {
        // Best-effort: if it fails we simply offer "Sin ruta"; never crash.
        if let result = try? await API.listPlans(token: token) {
            plans = result
        }
    }

    func loadSessions() async {
        // Best-effort: if it fails we keep whatever we had; never crash.
        if let result = try? await API.listSessions(token: token) {
            sessions = result
        }
    }

    func isActive(_ s: TrackSessionSummary) -> Bool { s.status == "active" }

    /// Resume broadcasting to an EXISTING active session without creating a new
    /// one. The ping endpoint already accepts an owned, active session.
    func continueSession(_ id: String) {
        lastError = nil
        sessionToken = id
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
        location.configure(interval: intervalSeconds)
        location.requestAuthorization()
        location.start()
    }

    func deleteSession(_ id: String) async {
        await API.deleteSession(token: token, id: id)
        if id == sessionToken {
            location.stop()
            isSharing = false
            sessionToken = nil
        }
        await loadSessions()
    }

    func startSharing(title: String?) async {
        lastError = nil
        location.requestAuthorization()
        do {
            let res = try await API.createTrack(token: token, title: title, planId: selectedPlanId)
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
        if let t = sessionToken { await API.end(token: token, id: t, retainHours: retainHours) }
        isSharing = false
        sessionToken = nil
        // The backend keeps the just-ended session for 24h; refresh so it
        // appears in "Mis seguimientos".
        await loadSessions()
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
