import Foundation
import CoreLocation

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
    @Published var lastLocation: CLLocation?
    @Published var authStatus: CLAuthorizationStatus = .notDetermined
    @Published var plans: [PlanSummary] = []
    @Published var selectedPlanId: String? = nil
    /// Planned departure time = reference for paces/predictions. Default now;
    /// keep it at the real start even if tracking is activated later.
    @Published var startAt: Date = Date()
    var startAtTouched = false
    @Published var sessions: [TrackSessionSummary] = []
    /// How long a finished route stays viewable (hours). Sent to the backend on stop.
    @Published var retainHours: Double = 24
    /// GPS fixes recorded but not yet uploaded (offline backlog, e.g. no coverage).
    @Published var pendingCount = 0

    private let token: String
    private let location = LocationManager()
    private var lastSendAttempt: Date = .distantPast
    private var pending: [Fix] = []
    private var isFlushing = false
    private var flushTimer: Timer?

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
        loadPending(id)
        location.configure(interval: intervalSeconds)
        location.requestAuthorization()
        location.start()
        startFlushTimer()
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
            // If the user didn't set a departure time, use "now" at share time
            // (not the stale value from when the screen opened).
            let start = startAtTouched ? startAt : Date()
            let res = try await API.createTrack(token: token, title: title, planId: selectedPlanId, startAt: start.timeIntervalSince1970 * 1000)
            sessionToken = res.id
            isSharing = true
            pingCount = 0
            lastSentAt = nil
            lastSendAttempt = .distantPast
            pending = []
            persistPending()
            applyLocationConfig()
            location.start()
            startFlushTimer()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? "No se pudo iniciar el seguimiento."
        }
    }

    func stopSharing() async {
        flushTimer?.invalidate()
        flushTimer = nil
        location.stop()
        isSharing = false
        let t = sessionToken
        sessionToken = nil
        if let t {
            // Best-effort: push any remaining backlog before ending (direct, so
            // it can't recurse through flush()).
            if !pending.isEmpty { try? await API.pingBatch(token: token, id: t, fixes: pending) }
            await API.end(token: token, id: t, retainHours: retainHours)
            UserDefaults.standard.removeObject(forKey: pendingKey(t))
        }
        pending = []
        pendingCount = 0
        // The backend keeps the just-ended session for the chosen retention;
        // refresh so it appears in "Mis seguimientos".
        await loadSessions()
    }

    private func handleLocation(_ loc: CLLocation) {
        lastLocation = loc
        guard isSharing, sessionToken != nil else { return }
        // Time mode: throttle by interval. Distance mode: the GPS distanceFilter
        // already gates callbacks, so we record every one.
        if sendMode == .time {
            guard Date().timeIntervalSince(lastSendAttempt) >= intervalSeconds else { return }
        }
        recordFix(from: loc)
        Task { await flush() }
    }

    /// Build a fix from a location and queue it (recorded locally first; the
    /// upload is a separate, retried step so nothing is lost without coverage).
    private func recordFix(from loc: CLLocation) {
        lastSendAttempt = Date()
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
        pending.append(fix)
        if pending.count > 10_000 { pending.removeFirst(pending.count - 10_000) }
        persistPending()
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
            try await API.pingBatch(token: token, id: id, fixes: batch)
            if pending.count >= batch.count { pending.removeFirst(batch.count) } else { pending.removeAll() }
            persistPending()
            lastSentAt = Date()
            pingCount += batch.count
            lastError = nil
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
        guard let t = sessionToken else { return }
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

    /// Apply a user-facing preset; `.custom` leaves the manual values untouched.
    func selectProfile(_ p: SendProfile) {
        profile = p
        switch p {
        case .balanced: sendMode = .distance; distanceMeters = 100
        case .saver: sendMode = .distance; distanceMeters = 500
        case .precision: sendMode = .time; intervalSeconds = 10
        case .custom: break
        }
    }

    private func applyLocationConfig() {
        if sendMode == .time {
            location.configure(interval: intervalSeconds)
        } else {
            location.configureDistance(distanceMeters)
        }
    }

    /// In distance mode, force a fix if we've been still longer than the heartbeat.
    private func heartbeatTick() {
        guard isSharing, sendMode == .distance, let loc = lastLocation else { return }
        if Date().timeIntervalSince(lastSendAttempt) >= heartbeatSeconds {
            recordFix(from: loc)
        }
    }

    /// Periodic retry so a backlog flushes when coverage returns even if the
    /// runner is stationary, plus the distance-mode heartbeat.
    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.heartbeatTick()
                await self?.flush()
            }
        }
    }
}
