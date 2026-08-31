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

    /// Field notes anchored during a session (JSON `[Note]`), for the offline viewer.
    static func notesURL(_ token: String) -> URL { dir("notes").appendingPathComponent("\(token).json") }

    /// Per-session directory holding not-yet-uploaded note media (audio/photo).
    /// Named by the token so `prune`/`remove` (which key on the last path component)
    /// clean it like the other artifacts.
    static func mediaDir(_ token: String) -> URL {
        let d = dir("media").appendingPathComponent(token, isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static func mediaFileURL(_ token: String, _ name: String) -> URL { mediaDir(token).appendingPathComponent(name) }

    /// Total bytes of a session's locally stored note media (photos + audios).
    /// This mirrors what the session occupies server-side (the same compact files
    /// are uploaded), and — unlike the server sum — also counts media queued while
    /// offline, so it's the honest "size of this session".
    static func mediaBytes(_ token: String) -> Int64 {
        contents(token).reduce(Int64(0)) { sum, url in
            sum + Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }

    /// Count a session's local media files by kind (names are `<noteId>_photo.jpg`
    /// / `<noteId>_audio.m4a`), for the storage summary line.
    static func mediaCounts(_ token: String) -> (photos: Int, audios: Int) {
        var photos = 0, audios = 0
        for url in contents(token) {
            let name = url.lastPathComponent
            if name.hasSuffix("_photo.jpg") { photos += 1 }
            else if name.hasSuffix("_audio.m4a") { audios += 1 }
        }
        return (photos, audios)
    }

    private static func contents(_ token: String) -> [URL] {
        (try? fm.contentsOfDirectory(
            at: mediaDir(token), includingPropertiesForKeys: [.fileSizeKey]
        )) ?? []
    }

    static func hasPlan(_ token: String) -> Bool { fm.fileExists(atPath: planURL(token).path) }

    /// Whether a session keeps a non-empty trail on this device — what decides
    /// that it can still be reviewed offline (and exported) after expiring.
    /// A size check, not a decode: it runs once per row of "Mis seguimientos".
    static func hasTrail(_ token: String) -> Bool {
        let size = (try? trailURL(token).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return size > 2 // "[]" — an empty trail file counts as no data
    }

    /// Delete all artifacts for a session (on hard-delete).
    static func remove(_ token: String) {
        try? fm.removeItem(at: trailURL(token))
        try? fm.removeItem(at: planURL(token))
        try? fm.removeItem(at: formURL(token))
        try? fm.removeItem(at: notesURL(token))
        try? fm.removeItem(at: dir("media").appendingPathComponent(token))
    }

    /// Prune per-session files/dirs whose session id isn't in `keep`.
    static func prune(keep: Set<String>) {
        for sub in ["trails", "plans", "form", "notes", "media"] {
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
    /// Movement type raw value ("walk"/"run"/"bike"/"transport"); nil = Automático
    /// (the embedded viewer infers it from the trail, like online).
    var activity: String?
    var fix: TrackFixWire?
    var trail: [TrailPoint]
    /// Embed-only: the last position actually uploaded to the server (what
    /// followers see). The public API never sets this; the embedded viewer draws
    /// the offline gap between it and `fix`.
    var reportedFix: TrackFixWire?
    /// Runner-confirmed form factor (1 = the plan) + its change log.
    var formFactor: Double?
    var formLog: [FormLogWire]?
    /// Field notes anchored during the session (same shape as web `TrackNote`).
    var notes: [Note]?
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
    private var activity: String?
    private var fix: TrackFixWire?
    private var reportedFix: TrackFixWire?
    private var trail: [TrailPoint] = []
    private var formFactor: Double = 1
    private var formLog: [FormLogWire] = []
    private var notes: [Note] = []

    /// Follower display name — set by the view layer (which holds the auth user).
    func setUsername(_ name: String?) { lock.lock(); username = name; lock.unlock() }

    /// Register/refresh the current session's metadata (on start / continue / stop).
    /// Whether a plan overlay exists is read from disk at query time (so an async
    /// plan-bytes download that finishes later is picked up without re-registering).
    func register(token: String, title: String?, startedAt: Double, expiresAt: Double, status: String) {
        lock.lock()
        self.token = token; self.title = title; self.startedAt = startedAt
        self.expiresAt = expiresAt; self.status = status
        self.activity = nil   // the store pushes it via setActivity() after registering
        self.notes = []   // the store pushes the loaded notes via setNotes() after registering
        loadCheers(token)   // los ánimos ya recibidos, para poder releerlos sin cobertura
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

    /// Set the current session's movement type (raw value; nil = Automático), so
    /// the embedded viewer picks the right speed unit and shows the activity icon.
    func setActivity(token: String, activity: BeaconActivity?) {
        lock.lock()
        if self.token == token { self.activity = activity?.rawValue }
        lock.unlock()
    }

    /// Replace the current session's field notes (the store is the single writer).
    func setNotes(token: String, notes: [Note]) {
        lock.lock()
        if self.token == token { self.notes = notes }
        lock.unlock()
    }

    /// Push the latest real fix, the last reported fix, and the full trail (called
    /// on every recorded fix and on every successful upload).
    func update(token: String, fix: TrackFixWire?, reportedFix: TrackFixWire?, trail: [TrailPoint]) {
        lock.lock()
        if self.token == token { self.fix = fix; self.reportedFix = reportedFix; self.trail = trail }
        lock.unlock()
    }

    /// True when `token` is the session currently served locally.
    func isCurrent(_ token: String) -> Bool { lock.lock(); defer { lock.unlock() }; return self.token == token }

    /// La sesión que se está sirviendo en local.
    var currentToken: String? { lock.lock(); defer { lock.unlock() }; return token }

    // MARK: Ánimos

    /// Los ánimos que dejan quienes siguen la ruta, tal cual llegaron del
    /// servidor.
    ///
    /// Es lo ÚNICO del visor incrustado que no se puede fabricar en local: los
    /// escriben otros. Se traen del endpoint PÚBLICO —el mismo que ven los
    /// seguidores, para que la baliza vea exactamente lo mismo— y se guardan en
    /// disco: un ánimo que ya llegó tiene que poder releerse sin cobertura, que
    /// es justo cuando más apetece.
    ///
    /// Se conservan como bytes crudos, sin modelarlos: su forma la deciden el
    /// backend y el visor, y copiarla aquí solo serviría para que se
    /// desincronicen.
    private var cheersJSON: Data?

    private static func cheersURL(_ token: String) -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("cheers", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(token).json")
    }

    /// Cada cuánto se preguntan.
    ///
    /// Es lo que de verdad se nota: el backend solo los retiene 10 s
    /// (`CHEER_GRACE_MS`, la ventana que tiene su autor para arrepentirse), así
    /// que el resto de la espera sale de aquí. A 30 s, un ánimo aparece en menos
    /// de medio minuto, que es lo que espera quien acaba de escribirlo. Bajarlo
    /// mucho más solo gastaría batería y datos en el monte.
    private static let cheersInterval: TimeInterval = 30
    private var lastCheerFetch = Date.distantPast

    /// Trae los ánimos del endpoint público si toca. Al mejor esfuerzo.
    func refreshCheers() {
        guard let token = currentToken else { return }
        guard Date().timeIntervalSince(lastCheerFetch) >= Self.cheersInterval else { return }
        lastCheerFetch = Date()

        let url = Config.baseURL.appendingPathComponent("api/track/\(token)")
        URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
            guard let self,
                  let data,
                  (200...299).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let cheers = obj["cheers"],
                  let encoded = try? JSONSerialization.data(withJSONObject: cheers) else { return }
            self.lock.lock()
            if self.token == token { self.cheersJSON = encoded }
            self.lock.unlock()
            try? encoded.write(to: Self.cheersURL(token), options: .atomic)
            // Un ánimo nuevo AVISA, como en Android: el móvil va en el bolsillo
            // y un mensaje que solo se ve al abrir el mapa no lo lee nadie.
            CheerNotifier.shared.notifyNew(cheers as? [[String: Any]] ?? [])
        }.resume()
    }

    private func loadCheers(_ token: String) {
        cheersJSON = try? Data(contentsOf: Self.cheersURL(token))
        lastCheerFetch = .distantPast
    }

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
            activity: activity,
            fix: fix,
            trail: trail,
            reportedFix: reportedFix,
            formFactor: formFactor,
            formLog: formLog,
            notes: notes.isEmpty ? nil : notes
        )
        guard let encoded = try? JSONEncoder().encode(state) else { return nil }

        // Los ánimos se INJERTAN en el JSON ya codificado en vez de modelarse en
        // `TrackStateWire`: así su forma sigue siendo la que decidan el backend y
        // el visor, sin una copia aquí que se desincronice a la primera.
        guard let cheersJSON,
              let cheers = try? JSONSerialization.jsonObject(with: cheersJSON),
              var obj = try? JSONSerialization.jsonObject(with: encoded) as? [String: Any] else {
            return encoded
        }
        obj["cheers"] = cheers
        return (try? JSONSerialization.data(withJSONObject: obj)) ?? encoded
    }

    /// Cached gzipped plan bytes for `id` (== the session token we set as planShareId).
    func planBytes(id: String) -> Data? { try? Data(contentsOf: LocalStore.planURL(id)) }
}
