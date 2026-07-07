import Foundation

/// On-disk locations for the data the embedded offline viewer needs. Kept in
/// Application Support so it survives relaunches/updates; shared by TrackingStore
/// (writer) and ViewerDataProvider (reader).
enum LocalStore {
    private static let fm = FileManager.default

    private static func dir(_ name: String) -> URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name, isDirectory: true)
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// Full recorded trail for a session (JSON `[TrailPoint]`).
    static func trailURL(_ token: String) -> URL { dir("trails").appendingPathComponent("\(token).json") }
    /// Gzipped SharePayload bytes for a session's linked plan (verbatim from the API).
    static func planURL(_ token: String) -> URL { dir("plans").appendingPathComponent("\(token).gz") }

    /// Runner-confirmed form factor + change log (JSON), so it survives relaunch.
    static func formURL(_ token: String) -> URL { dir("form").appendingPathComponent("\(token).json") }

    static func hasPlan(_ token: String) -> Bool { fm.fileExists(atPath: planURL(token).path) }

    /// Delete both artifacts for a session (on hard-delete).
    static func remove(_ token: String) {
        try? fm.removeItem(at: trailURL(token))
        try? fm.removeItem(at: planURL(token))
        try? fm.removeItem(at: formURL(token))
    }

    /// Prune trail/plan files whose session id isn't in `keep` (the owner's live list).
    static func prune(keep: Set<String>) {
        for sub in ["trails", "plans", "form"] {
            let d = dir(sub)
            guard let items = try? fm.contentsOfDirectory(at: d, includingPropertiesForKeys: nil) else { continue }
            for url in items {
                // filename is "<token>.json" / "<token>.gz" — strip the extension.
                let id = url.deletingPathExtension().lastPathComponent
                if !keep.contains(id) { try? fm.removeItem(at: url) }
            }
        }
    }
}

// MARK: - Wire encode models (mirror shared/wireTypes.ts, encode side)

/// `TrackFix` shape the web viewer consumes. Nullable fields are omitted when nil
/// (the viewer treats undefined and null identically, e.g. `fix.speed != null`).
struct TrackFixWire: Codable {
    var lat: Double
    var lon: Double
    var trackKm: Double?
    var speed: Double?
    var heading: Double?
    var accuracy: Double?
    var altitude: Double?
    var fixAt: Double?
    var updatedAt: Double
}

/// One runner-confirmed form change (mirrors shared/wireTypes `FormLogEntry`).
struct FormLogWire: Codable {
    var t: Double
    var km: Double?
    var factor: Double
}

/// `TrackStateResponse` shape the web viewer polls from `/api/track/:id`.
struct TrackStateWire: Codable {
    var status: String
    var username: String?
    var title: String?
    var startedAt: Double
    var expiresAt: Double
    var endedAt: Double?
    var planShareId: String?
    var fix: TrackFixWire?
    var trail: [TrailPoint]
    /// Embed-only: the last position actually uploaded to the server (what
    /// followers see). The public API never sets this; the embedded viewer draws
    /// the offline gap between it and `fix`.
    var reportedFix: TrackFixWire?
    /// Runner-confirmed form factor (1 = the plan) + its change log.
    var formFactor: Double?
    var formLog: [FormLogWire]?
}

/// Thread-safe bridge that lets the embedded WKWebView viewer read the CURRENT
/// broadcasting session's data locally, so it works with no connectivity.
/// `TrackingStore` (main actor) pushes snapshots here; `AppWebSchemeHandler`
/// (arbitrary thread) reads them to answer the viewer's `/api/track/:id` poll and
/// `/api/share/:id` fetch. Only the one active session is served locally; other
/// (finished) sessions are opened online instead.
final class ViewerDataProvider {
    static let shared = ViewerDataProvider()
    private init() {}

    private let lock = NSLock()

    private var token: String?
    private var title: String?
    private var username: String?
    private var startedAt: Double = 0
    private var expiresAt: Double = 0
    private var status: String = "active"
    private var fix: TrackFixWire?
    private var reportedFix: TrackFixWire?
    private var trail: [TrailPoint] = []
    private var formFactor: Double = 1
    private var formLog: [FormLogWire] = []

    /// Follower display name — set by the view layer (which holds the auth user).
    func setUsername(_ name: String?) { lock.lock(); username = name; lock.unlock() }

    /// Register/refresh the current session's metadata (on start / continue / stop).
    /// Whether a plan overlay exists is read from disk at query time (so an async
    /// plan-bytes download that finishes later is picked up without re-registering).
    func register(token: String, title: String?, startedAt: Double, expiresAt: Double, status: String) {
        lock.lock()
        self.token = token; self.title = title; self.startedAt = startedAt
        self.expiresAt = expiresAt; self.status = status
        // Re-hydrate any confirmed form factor/log for this session (survives relaunch).
        if let data = try? Data(contentsOf: LocalStore.formURL(token)),
           let saved = try? JSONDecoder().decode(SavedForm.self, from: data) {
            self.formFactor = saved.factor; self.formLog = saved.log
        } else {
            self.formFactor = 1; self.formLog = []
        }
        lock.unlock()
    }

    private struct SavedForm: Codable { var factor: Double; var log: [FormLogWire] }

    /// The runner confirmed a form change (from the embedded viewer, routed here by
    /// the scheme handler): update + persist + include in the synthesized state.
    func setForm(token: String, factor: Double, km: Double?) {
        lock.lock()
        if self.token == token {
            let f = min(2.2, max(0.5, factor))
            self.formFactor = f
            self.formLog.append(FormLogWire(t: Date().timeIntervalSince1970 * 1000, km: km, factor: f))
            if self.formLog.count > 40 { self.formLog.removeFirst(self.formLog.count - 40) }
            if let data = try? JSONEncoder().encode(SavedForm(factor: f, log: self.formLog)) {
                try? data.write(to: LocalStore.formURL(token), options: .atomic)
            }
        }
        lock.unlock()
    }

    func updateStatus(_ status: String) { lock.lock(); self.status = status; lock.unlock() }

    /// Push the latest real fix, the last reported fix, and the full trail (called
    /// on every recorded fix and on every successful upload).
    func update(token: String, fix: TrackFixWire?, reportedFix: TrackFixWire?, trail: [TrailPoint]) {
        lock.lock()
        if self.token == token { self.fix = fix; self.reportedFix = reportedFix; self.trail = trail }
        lock.unlock()
    }

    /// True when `token` is the session currently served locally.
    func isCurrent(_ token: String) -> Bool { lock.lock(); defer { lock.unlock() }; return self.token == token }

    /// Synthesized `TrackStateResponse` JSON for `token`, or nil if it isn't the
    /// current session (the handler then 404s).
    func trackStateJSON(token: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        guard self.token == token else { return nil }
        let state = TrackStateWire(
            status: status,
            username: username,
            title: title,
            startedAt: startedAt,
            expiresAt: expiresAt,
            endedAt: status == "ended" ? (fix?.updatedAt ?? startedAt) : nil,
            planShareId: LocalStore.hasPlan(token) ? token : nil,   // resolves to LocalStore.planURL(token)
            fix: fix,
            trail: trail,
            reportedFix: reportedFix,
            formFactor: formFactor,
            formLog: formLog
        )
        return try? JSONEncoder().encode(state)
    }

    /// Cached gzipped plan bytes for `id` (== the session token we set as planShareId).
    func planBytes(id: String) -> Data? { try? Data(contentsOf: LocalStore.planURL(id)) }
}
