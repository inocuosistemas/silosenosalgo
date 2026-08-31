import Foundation

// MARK: - Wire models (mirror /shared/wireTypes.ts)

/// Movement type a beacon reports (mirrors `BeaconActivity` in wireTypes.ts and
/// `ActivityType` in src/lib/timing.ts). Chosen by the broadcaster; `nil` on the
/// session = "Automático" (the viewer infers it from the trail). Drives the
/// viewer's speed unit (walk/run → min/km; bike/transport → km/h), the activity
/// icon and the realistic max-speed used to hide impossible GPS jumps.
enum BeaconActivity: String, Codable, CaseIterable, Identifiable {
    case walk, run, bike, transport
    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .walk: return "🚶"
        case .run: return "🏃"
        case .bike: return "🚴"
        case .transport: return "🚌"
        }
    }

    var label: String {
        switch self {
        case .walk: return "Caminar"
        case .run: return "Correr"
        case .bike: return "Bici"
        case .transport: return "Transporte"
        }
    }

    /// Realistic max speed (km/h), mirroring ACTIVITY_MAX_SPEED_KMH.
    var maxSpeedKmh: Double {
        switch self {
        case .walk: return 12
        case .run: return 25
        case .bike: return 80
        case .transport: return 200
        }
    }
}

struct AuthUser: Codable, Equatable {
    let id: String
    let username: String
}

struct AuthResponse: Codable {
    let user: AuthUser
    let token: String?
}

struct MeResponse: Codable {
    let user: AuthUser?
}

struct CreateTrackResponse: Codable {
    let id: String
    let expiresAt: Double
}

/// Reply to a ping: how many followers are watching right now (optional so an
/// older server replying 204 with no body decodes to nil).
struct PingResponse: Codable {
    let viewers: Int?
}

/// One of the user's tracking sessions, as listed by GET /api/track.
/// `startedAt`/`expiresAt` are epoch MILLISECONDS; `status` is "active" or "ended".
struct TrackSessionSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String?
    let planName: String?   // linked route name, if any (shown on continue)
    let status: String
    let startedAt: Double    // reference start (planned departure for plan sessions)
    let expiresAt: Double
    let updatedAt: Double?   // last fix received (epoch ms), nil if none
    let endedAt: Double?     // when ended (epoch ms), nil if active
    let pinned: Bool?        // "chincheta": kept indefinitely; nil on old servers
    let activity: BeaconActivity?  // movement type; nil = auto/unset (or old server)
    /// Evento al que pertenece la salida; nil = baliza suelta (o servidor viejo).
    let eventId: String?

    /// Pinned state with a safe default for responses predating the field.
    var isPinned: Bool { pinned ?? false }
}

/// Un evento en el que participo, tal y como lo necesita la baliza: lo justo
/// para elegirlo al empezar a compartir. El lobby, los colores y el mapa de
/// todos viven en la web (ver docs); aquí solo hace falta saber a qué carrera
/// se atribuye esta salida.
struct EventSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let planName: String?
    let startsAt: Double?
    /// Terminado por el organizador: no se ofrece para emitir.
    let endedAt: Double?

    var isOver: Bool { endedAt != nil }
}

/// A saved race plan ("previsión") belonging to the user. The server returns
/// extra fields (elevGainM, startTime, createdAt, updatedAt); Codable ignores
/// unknown keys, so we declare only what the UI uses.
struct PlanSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let routeName: String?
    let distanceKm: Double?
    let startTime: String?   // ISO; the plan's planned departure
}

/// A single GPS fix sent to the backend. Optional fields are omitted when nil.
/// Codable so unsent fixes can be persisted to disk and flushed later.
struct Fix: Codable {
    var lat: Double
    var lon: Double
    var trackKm: Double?
    var speed: Double?
    var heading: Double?
    var accuracy: Double?
    var altitude: Double?
    var fixAt: Double? // epoch ms
}

/// One breadcrumb of the retained local trail, mirroring the server's `TrailPoint`
/// (shared/wireTypes.ts): `t` = epoch ms, `a` = horizontal accuracy (m, rounded),
/// omitted when unknown. Persisted on disk so the in-app offline viewer can render
/// the full route even for fixes already uploaded (and dropped from the send queue).
struct TrailPoint: Codable {
    var t: Double
    var lat: Double
    var lon: Double
    var a: Int?
}

/// A field note anchored to a GPS fix (mirrors shared `TrackNote`). Codable both
/// to persist unsent notes on disk (flushed like `pending` fixes) and to feed the
/// embedded offline viewer, whose keys match the web `TrackNote` shape 1:1.
struct Note: Codable, Identifiable {
    var id: String
    var createdAt: Double        // wall-clock capture, epoch ms
    var fixAt: Double?           // device GPS timestamp, epoch ms
    var lat: Double
    var lon: Double
    var accuracy: Double?
    var altitude: Double?
    var trackKm: Double?
    var distM: Double?
    var title: String?
    var body: String?
    var poiType: String
    var poiSym: String?
    var audioKey: String?
    var photoKey: String?
}

/// The user's note-media storage use vs their per-user budget (GET /api/storage).
/// Mirrors shared `StorageInfo`; bytes.
struct StorageInfo: Codable {
    let usedBytes: Int64
    let quotaBytes: Int64
}

struct APIError: LocalizedError {
    let status: Int
    let code: String

    var errorDescription: String? {
        switch code {
        case "invalid_credentials": return "Usuario o contraseña incorrectos."
        case "username_taken": return "Ese usuario ya existe."
        case "invalid_username": return "Usuario no válido (3–32 caracteres: a–z, 0–9, . _ -)."
        case "invalid_password": return "Contraseña no válida (mínimo 8 caracteres)."
        case "rate_limited": return "Demasiados intentos. Inténtalo de nuevo en unos minutos."
        case "unauthorized": return "Sesión caducada. Inicia sesión de nuevo."
        case "ended": return "La sesión de seguimiento ha terminado."
        case "network": return "No se pudo conectar con el servidor."
        default: return "Error (\(status)): \(code)"
        }
    }
}

// MARK: - Client

enum API {
    private static func request(
        _ path: String,
        method: String,
        token: String?,
        body: [String: Any]? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let url = Config.baseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("token", forHTTPHeaderField: "X-Auth-Mode")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(status: 0, code: "network") }
            return (data, http)
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError(status: 0, code: "network")
        }
    }

    private static func decodeError(_ data: Data, _ status: Int) -> APIError {
        struct E: Codable { let error: String }
        let code = (try? JSONDecoder().decode(E.self, from: data))?.error ?? "http_\(status)"
        return APIError(status: status, code: code)
    }

    private static func ok(_ http: HTTPURLResponse) -> Bool { (200...299).contains(http.statusCode) }

    // MARK: Auth

    static func login(username: String, password: String) async throws -> AuthResponse {
        let (data, http) = try await request("api/auth/login", method: "POST", token: nil,
                                             body: ["username": username, "password": password])
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(AuthResponse.self, from: data)
    }

    static func me(token: String) async throws -> AuthUser? {
        let (data, http) = try await request("api/auth/me", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(MeResponse.self, from: data).user
    }

    static func logout(token: String) async {
        _ = try? await request("api/auth/logout", method: "POST", token: token)
    }

    // MARK: Plans

    static func listPlans(token: String) async throws -> [PlanSummary] {
        struct Wrapper: Codable { let plans: [PlanSummary] }
        let (data, http) = try await request("api/plans", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(Wrapper.self, from: data).plans
    }

    /// Raw gzipped SharePayload bytes for one of the owner's plans, byte-identical
    /// to what the public `/api/share/:id` serves. Cached locally so the embedded
    /// offline viewer can overlay the planned route without connectivity. Returns
    /// the bytes verbatim (NOT JSON-decoded).
    static func fetchPlanPayload(token: String, planId: String) async throws -> Data {
        let (data, http) = try await request("api/plans/\(planId)", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return data
    }

    // MARK: Storage

    /// The user's note-media use vs their per-user budget (bytes).
    static func fetchStorage(token: String) async throws -> StorageInfo {
        let (data, http) = try await request("api/storage", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(StorageInfo.self, from: data)
    }

    // MARK: Tracking

    static func listSessions(token: String) async throws -> [TrackSessionSummary] {
        struct Wrapper: Codable { let sessions: [TrackSessionSummary] }
        let (data, http) = try await request("api/track", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(Wrapper.self, from: data).sessions
    }

    // MARK: Eventos

    /// Los eventos en los que participo. Al mejor esfuerzo en la UI: sin
    /// eventos, la baliza funciona exactamente como siempre.
    static func listEvents(token: String) async throws -> [EventSummary] {
        struct Wrapper: Codable { let events: [EventSummary] }
        let (data, http) = try await request("api/events", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(Wrapper.self, from: data).events
    }

    /// Une (o saca) del evento la baliza que YA se está emitiendo. Es el camino
    /// para quien se acuerda a mitad de carrera, que es lo normal: no obliga a
    /// parar y volver a empezar, que partiría la traza en dos.
    static func attachBeacon(token: String, eventId: String, attach: Bool) async throws {
        let (data, http) = try await request(
            "api/events/\(eventId)/beacon", method: "POST", token: token, body: ["attach": attach])
        guard ok(http) else { throw decodeError(data, http.statusCode) }
    }

    static func createTrack(token: String, title: String?, planId: String? = nil, startAt: Double? = nil, activity: BeaconActivity? = nil, eventId: String? = nil) async throws -> CreateTrackResponse {
        var body: [String: Any] = [:]
        if let title, !title.isEmpty { body["title"] = title }
        if let planId { body["planId"] = planId }
        if let startAt { body["startAt"] = startAt }
        if let activity { body["activity"] = activity.rawValue }
        // Evento al que se atribuye la salida. El servidor exige ser miembro;
        // si no lo eres, la sesión nace suelta en vez de fallar — lo importante
        // es salir a correr.
        if let eventId { body["eventId"] = eventId }
        let (data, http) = try await request("api/track", method: "POST", token: token, body: body)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(CreateTrackResponse.self, from: data)
    }

    static func ping(token: String, id: String, fix: Fix) async throws {
        var body: [String: Any] = ["lat": fix.lat, "lon": fix.lon]
        if let v = fix.trackKm { body["trackKm"] = v }
        if let v = fix.speed { body["speed"] = v }
        if let v = fix.heading { body["heading"] = v }
        if let v = fix.accuracy { body["accuracy"] = v }
        if let v = fix.altitude { body["altitude"] = v }
        if let v = fix.fixAt { body["fixAt"] = v }
        let (data, http) = try await request("api/track/\(id)/ping", method: "POST", token: token, body: body)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
    }

    /// Upload several buffered fixes at once (offline backlog flush). The server
    /// orders them by their fixAt and uses the most recent as the live position.
    /// Returns the current active-follower count (nil against an old server that
    /// replies 204 without a body).
    @discardableResult
    static func pingBatch(token: String, id: String, fixes: [Fix]) async throws -> Int? {
        let arr: [[String: Any]] = fixes.map { f in
            var d: [String: Any] = ["lat": f.lat, "lon": f.lon]
            if let v = f.trackKm { d["trackKm"] = v }
            if let v = f.speed { d["speed"] = v }
            if let v = f.heading { d["heading"] = v }
            if let v = f.accuracy { d["accuracy"] = v }
            if let v = f.altitude { d["altitude"] = v }
            if let v = f.fixAt { d["fixAt"] = v }
            return d
        }
        let (data, http) = try await request("api/track/\(id)/ping", method: "POST", token: token, body: ["fixes": arr])
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return (try? JSONDecoder().decode(PingResponse.self, from: data))?.viewers
    }

    /// Create a field note on the current session. The note carries a
    /// client-generated `id`, so a retry after a lost response is idempotent
    /// (the server's INSERT OR IGNORE de-dupes) — a note taken offline can't be
    /// duplicated when the backlog flushes.
    static func createNote(token: String, sessionId: String, note: Note) async throws {
        var body: [String: Any] = [
            "id": note.id,
            "createdAt": note.createdAt,
            "lat": note.lat,
            "lon": note.lon,
            "poiType": note.poiType,
        ]
        if let v = note.fixAt { body["fixAt"] = v }
        if let v = note.accuracy { body["accuracy"] = v }
        if let v = note.altitude { body["altitude"] = v }
        if let v = note.trackKm { body["trackKm"] = v }
        if let v = note.distM { body["distM"] = v }
        if let v = note.title { body["title"] = v }
        if let v = note.body { body["body"] = v }
        if let v = note.poiSym { body["poiSym"] = v }
        let (data, http) = try await request("api/track/\(sessionId)/notes", method: "POST", token: token, body: body)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
    }

    /// Owner-only removal of a field note and its attached server media.
    static func deleteNote(token: String, sessionId: String, noteId: String) async throws {
        let (data, http) = try await request(
            "api/track/\(sessionId)/notes/\(noteId)", method: "DELETE", token: token
        )
        guard ok(http) else { throw decodeError(data, http.statusCode) }
    }

    /// Upload a note's media (voice memo / photo) as the raw request body. The
    /// shared `request()` is JSON-only, so this uses URLSession.upload directly.
    /// `kind` is "audio" | "photo"; `contentType` is audio/mp4 | image/jpeg.
    static func uploadNoteMedia(token: String, sessionId: String, noteId: String, kind: String, data: Data, contentType: String) async throws {
        let base = Config.baseURL.appendingPathComponent("api/track/\(sessionId)/notes/\(noteId)/media")
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw APIError(status: 0, code: "network")
        }
        comps.queryItems = [URLQueryItem(name: "kind", value: kind)]
        guard let url = comps.url else { throw APIError(status: 0, code: "network") }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.setValue("token", forHTTPHeaderField: "X-Auth-Mode")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (respData, resp): (Data, URLResponse)
        do {
            (respData, resp) = try await URLSession.shared.upload(for: req, from: data)
        } catch {
            throw APIError(status: 0, code: "network")
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: 0, code: "network") }
        guard ok(http) else { throw decodeError(respData, http.statusCode) }
    }

    /// Re-activate an ended session (same link) so sharing can resume.
    static func reopen(token: String, id: String) async throws -> CreateTrackResponse {
        let (data, http) = try await request("api/track/\(id)/reopen", method: "POST", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(CreateTrackResponse.self, from: data)
    }

    static func end(token: String, id: String, retainHours: Double? = nil) async {
        var body: [String: Any]? = nil
        if let retainHours { body = ["retainHours": retainHours] }
        _ = try? await request("api/track/\(id)/end", method: "POST", token: token, body: body)
    }

    static func deleteSession(token: String, id: String) async {
        _ = try? await request("api/track/\(id)", method: "DELETE", token: token)
    }

    /// Pin/unpin a session ("chincheta"): pinned sessions are kept indefinitely.
    static func setPinned(token: String, id: String, pinned: Bool) async {
        _ = try? await request("api/track/\(id)/pin", method: "POST", token: token, body: ["pinned": pinned])
    }

    /// Rename a session's label so it's identifiable later. An empty/nil title
    /// clears the name back to "Sin nombre".
    static func rename(token: String, id: String, title: String?) async {
        _ = try? await request("api/track/\(id)/rename", method: "POST", token: token, body: ["title": title ?? ""])
    }

    /// Set/clear the beacon's movement type on a live session. A nil activity
    /// (empty string → unrecognised) stores "Automático" (server infers/none).
    static func setActivity(token: String, id: String, activity: BeaconActivity?) async {
        _ = try? await request("api/track/\(id)/activity", method: "POST", token: token, body: ["activity": activity?.rawValue ?? ""])
    }
}
