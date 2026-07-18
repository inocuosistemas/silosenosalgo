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
    /// Movement type of the beacon (nil = "Automático" → the viewer infers it from
    /// the trail). Chosen before/while sharing; drives the viewer's speed unit,
    /// the activity icon and the impossible-speed filter.
    @Published var activity: BeaconActivity? = nil
    /// Planned departure time = reference for paces/predictions. Defaults to the
    /// selected plan's start (so predictions follow the plan), else now.
    @Published var startAt: Date = Date()
    var startAtTouched = false
    @Published var sessions: [TrackSessionSummary] = []
    /// How long a finished route stays viewable (hours). Sent to the backend on stop.
    @Published var retainHours: Double = 48
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
    var sessionMediaBytes: Int64 { sessionToken.map { LocalStore.mediaBytes($0) } ?? 0 }
    /// Photo/audio counts for the current session (for the storage summary line).
    var sessionMediaCounts: (photos: Int, audios: Int) {
        sessionToken.map { LocalStore.mediaCounts($0) } ?? (0, 0)
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
            keep.formUnion(GuideLibrary.shared.storageIds)
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
        activity = summary?.activity
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
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

    func startSharing(title: String?) async {
        lastError = nil
        location.requestAuthorization()
        do {
            // If the user didn't set a departure time, use "now" at share time
            // (not the stale value from when the screen opened).
            let start = startAtTouched ? startAt : Date()
            let res = try await API.createTrack(token: token, title: title, planId: selectedPlanId, startAt: start.timeIntervalSince1970 * 1000, activity: activity)
            sessionToken = res.id
            activePlanName = plans.first(where: { $0.id == selectedPlanId })?.name
            isSharing = true
            pingCount = 0
            activeViewers = nil
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
            notes = []
            pendingNotes = []
            pendingNoteDeletes = []
            pendingMedia = []
            noteCount = 0
            persistNotes()
            persistPendingNotes()
            persistPendingNoteDeletes()
            persistPendingMedia()
            ViewerDataProvider.shared.register(token: res.id, title: title, startedAt: start.timeIntervalSince1970 * 1000, expiresAt: res.expiresAt, status: "active")
            ViewerDataProvider.shared.setActivity(token: res.id, activity: activity)
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
            persistActive() // remember the "last known state" so a relaunch resumes it
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
        clearActive() // explicit stop (or server-ended): don't resume on relaunch
        // Keep serving the just-finished session to a still-open offline viewer,
        // now flagged as ended (its trail file is kept for later review).
        ViewerDataProvider.shared.updateStatus("ended")
        let t = sessionToken
        sessionToken = nil
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

    /// Cumulative distance travelled so far (metres), summed over the retained trail.
    private func trailDistanceMeters() -> Double {
        guard trail.count >= 2 else { return 0 }
        var d = 0.0
        for i in 1..<trail.count {
            let a = CLLocation(latitude: trail[i - 1].lat, longitude: trail[i - 1].lon)
            let b = CLLocation(latitude: trail[i].lat, longitude: trail[i].lon)
            d += b.distance(from: a)
        }
        return d
    }

    /// Anchor a note to the CURRENT position and queue it (recorded locally first;
    /// the upload is retried like fixes, so a note taken with no coverage isn't
    /// lost). `text` may be empty when the note is just a typed POI (e.g. "Agua").
    /// Optional `audioURL` (a temp .m4a recording) / `photoData` (JPEG) are stored
    /// locally and uploaded after the note row exists server-side.
    func addNote(text: String, type: String, audioURL: URL? = nil, photoData: Data? = nil) {
        guard let t = sessionToken else { return }
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
        guard let id = sessionToken else { return }
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
        guard let t = sessionToken else { return nil }
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
        guard let t = sessionToken else { return }
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
        guard let t = sessionToken else { return }
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
        guard let t = sessionToken else { return }
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
        guard let token = sessionToken else { return }
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
    func planPolyline(for planId: String) async -> [(lat: Double, lon: Double)]? {
        guard let bytes = try? await API.fetchPlanPayload(token: token, planId: planId) else { return nil }
        return PlanGeometry.polyline(fromGzip: bytes)
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
        let savedAtMs: Double
        /// Movement type (raw value), nil = Automático. Optional so states saved
        /// before this field decode fine (→ nil).
        let activity: String?
    }

    private let activeKey = "activeSession"
    private var lastActivePersistAt: Date = .distantPast

    private func persistActive() {
        guard isSharing, let t = sessionToken else { return }
        lastActivePersistAt = Date()
        let s = ActiveSessionState(
            token: t, sendMode: sendMode.rawValue, intervalSeconds: intervalSeconds,
            distanceMeters: distanceMeters, profile: profile.rawValue, retainHours: retainHours,
            startAtMs: startAt.timeIntervalSince1970 * 1000, planName: activePlanName,
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
        activity = s.activity.flatMap(BeaconActivity.init(rawValue:))

        sessionToken = s.token
        isSharing = true
        pingCount = 0
        lastSentAt = nil
        lastSendAttempt = .distantPast
        lastReportedFix = nil
        loadPending(s.token)   // offline backlog recorded before the relaunch
        loadTrail(s.token)     // full route for the offline viewer
        loadNotes(s.token)
        loadPendingNotes(s.token)
        loadPendingNoteDeletes(s.token)
        loadPendingMedia(s.token)
        ViewerDataProvider.shared.register(token: s.token, title: nil, startedAt: s.startAtMs, expiresAt: 0, status: "active")
        ViewerDataProvider.shared.setActivity(token: s.token, activity: activity)
        let lastFix = trail.last.map { TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil, accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t) }
        ViewerDataProvider.shared.update(token: s.token, fix: lastFix, reportedFix: nil, trail: trail)
        ViewerDataProvider.shared.setNotes(token: s.token, notes: notes)

        // Re-arm standby if the planned start is still ahead; else resume live.
        if startAt.timeIntervalSinceNow > startLeadSeconds {
            isStandby = true
            location.configureStandby()
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
                self?.persistActiveIfDue()
                await self?.flush()
                await self?.flushNotes()
                await self?.flushNoteDeletes()
                await self?.flushMedia()
            }
        }
    }
}
