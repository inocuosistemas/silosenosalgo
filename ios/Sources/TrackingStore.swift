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
    @Published var lastLocation: CLLocation?
    @Published var authStatus: CLAuthorizationStatus = .notDetermined
    @Published var plans: [PlanSummary] = []
    /// Name of the route linked to the CURRENT live/armed session (persists while
    /// sharing, incl. continued sessions where selectedPlanId isn't known).
    @Published var activePlanName: String? = nil
    @Published var selectedPlanId: String? = nil {
        didSet { applyPlanStart() }
    }
    /// Planned departure time = reference for paces/predictions. Defaults to the
    /// selected plan's start (so predictions follow the plan), else now.
    @Published var startAt: Date = Date()
    var startAtTouched = false
    @Published var sessions: [TrackSessionSummary] = []
    /// How long a finished route stays viewable (hours). Sent to the backend on stop.
    @Published var retainHours: Double = 48
    /// GPS fixes recorded but not yet uploaded (offline backlog, e.g. no coverage).
    @Published var pendingCount = 0
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

    private let token: String
    private let location = LocationManager()
    private var lastSendAttempt: Date = .distantPast
    private var pending: [Fix] = []
    private var isFlushing = false
    private var flushTimer: Timer?

    /// Full recorded trail of the CURRENT session (sent + unsent), retained locally
    /// so the embedded offline viewer can draw the whole route even for fixes that
    /// were already uploaded and dropped from `pending`. Bounded like the server.
    private var trail: [TrailPoint] = []
    private let trailMax = 2000 // mirror PATH_MAX in functions/api/track/[id]/ping.ts
    /// The most recent fix recorded locally (the REAL position, known even offline).
    private var lastRecordedFix: Fix?
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

    init(token: String) {
        self.token = token
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

    func loadPlans() async {
        // Best-effort: if it fails we simply offer "Sin ruta"; never crash.
        if let result = try? await API.listPlans(token: token) {
            plans = result
            applyPlanStart() // if a plan was already selected, pick up its start
        }
    }

    /// When a plan is selected, default the departure to the PLAN's start so all
    /// paces/predictions follow the plan (not the activation moment). Adjustable.
    private func applyPlanStart() {
        guard let id = selectedPlanId,
              let p = plans.first(where: { $0.id == id }),
              let iso = p.startTime,
              let d = Self.parseISO(iso) else { return }
        startAt = d
        startAtTouched = true
    }

    private static func parseISO(_ s: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: s) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        return f2.date(from: s)
    }

    func loadSessions() async {
        // Best-effort: if it fails we keep whatever we had; never crash.
        if let result = try? await API.listSessions(token: token) {
            // Pinned ("chincheta") sessions first, then most recently finished.
            sessions = result.sorted {
                if $0.isPinned != $1.isPinned { return $0.isPinned }
                return Self.finishKey($0) > Self.finishKey($1)
            }
            // Drop local trail/plan files for sessions the server no longer lists
            // (keep the current one even if it hasn't surfaced in the list yet).
            var keep = Set(result.map { $0.id })
            if let t = sessionToken { keep.insert(t) }
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
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
        loadPending(id)
        // Re-hydrate the full trail from disk so the offline viewer shows the whole
        // route (and last position) immediately, before the next fix arrives.
        loadTrail(id)
        ViewerDataProvider.shared.register(token: id, title: summary?.title, startedAt: summary?.startedAt ?? Date().timeIntervalSince1970 * 1000, expiresAt: summary?.expiresAt ?? 0, status: "active")
        let lastFix = trail.last.map { TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil, accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t) }
        // The reported position is unknown for a continued session until the next
        // successful upload; the offline gap simply won't show until then.
        lastReportedFix = nil
        ViewerDataProvider.shared.update(token: id, fix: lastFix, reportedFix: nil, trail: trail)
        location.configure(interval: intervalSeconds)
        location.requestAuthorization()
        location.start()
        startFlushTimer()
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
            activePlanName = plans.first(where: { $0.id == selectedPlanId })?.name
            isSharing = true
            pingCount = 0
            lastSentAt = nil
            lastSendAttempt = .distantPast
            pending = []
            persistPending()
            // Fresh local trail for the in-app offline viewer, and register the
            // session so the embedded viewer can read it with no connectivity.
            trail = []
            lastRecordedFix = nil
            lastReportedFix = nil
            persistTrail()
            ViewerDataProvider.shared.register(token: res.id, title: title, startedAt: start.timeIntervalSince1970 * 1000, expiresAt: res.expiresAt, status: "active")
            cachePlanBytes(for: res.id, planId: selectedPlanId)
            // If the planned start is still ahead (beyond the lead margin), arm
            // in low-power standby: keep the app alive with coarse location but
            // upload nothing until ~2 min before the start, to save battery.
            if start.timeIntervalSinceNow > startLeadSeconds {
                isStandby = true
                location.configureStandby()
            } else {
                isStandby = false
                applyLocationConfig()
            }
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
        isStandby = false
        activePlanName = nil
        // Keep serving the just-finished session to a still-open offline viewer,
        // now flagged as ended (its trail file is kept for later review).
        ViewerDataProvider.shared.updateStatus("ended")
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
        // Armed standby: don't record/upload anything; just check if it's time to
        // wake into live tracking (a coarse fix arrived, use it as the trigger).
        if isStandby { maybeBeginFromStandby(); return }
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
    private func publishToViewer() {
        guard let t = sessionToken else { return }
        ViewerDataProvider.shared.update(token: t, fix: lastRecordedFix.map(wireFix), reportedFix: lastReportedFix, trail: trail)
    }

    private func persistTrail() {
        guard let t = sessionToken else { return }
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

    /// Best-effort: fetch the linked plan's gzipped bytes once (online) and cache
    /// them so the offline viewer can overlay the planned route. Never blocks
    /// sharing; if offline it simply won't be available until refetched.
    private func cachePlanBytes(for sessionId: String, planId: String?) {
        guard let planId else { return }
        Task {
            if let bytes = try? await API.fetchPlanPayload(token: token, planId: planId) {
                try? bytes.write(to: LocalStore.planURL(sessionId), options: .atomic)
            }
        }
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

    /// How early (before the planned start) standby switches to live tracking.
    /// A small margin absorbs clock drift between the phone and the organisation.
    private let startLeadSeconds: TimeInterval = 120

    /// While armed, switch to live tracking once we're within the lead margin of
    /// the planned start: apply the real profile and push an immediate first fix.
    private func maybeBeginFromStandby() {
        guard isStandby else { return }
        guard Date() >= startAt.addingTimeInterval(-startLeadSeconds) else { return }
        isStandby = false
        applyLocationConfig()           // full profile (GPS + interval/distance)
        lastSendAttempt = .distantPast  // don't throttle the first live fix
        if let loc = lastLocation {
            recordFix(from: loc)
            Task { await flush() }
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
                self?.sampleBatteryIfDue()
                self?.heartbeatTick()
                await self?.flush()
            }
        }
    }
}
