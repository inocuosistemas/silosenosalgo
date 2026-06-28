import Foundation

// MARK: - Wire models (mirror /shared/wireTypes.ts)

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

/// One of the user's tracking sessions, as listed by GET /api/track.
/// `startedAt`/`expiresAt` are epoch MILLISECONDS; `status` is "active" or "ended".
struct TrackSessionSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String?
    let status: String
    let startedAt: Double
    let expiresAt: Double
}

/// A saved race plan ("previsión") belonging to the user. The server returns
/// extra fields (elevGainM, startTime, createdAt, updatedAt); Codable ignores
/// unknown keys, so we declare only what the UI uses.
struct PlanSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let routeName: String?
    let distanceKm: Double?
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

    // MARK: Tracking

    static func listSessions(token: String) async throws -> [TrackSessionSummary] {
        struct Wrapper: Codable { let sessions: [TrackSessionSummary] }
        let (data, http) = try await request("api/track", method: "GET", token: token)
        guard ok(http) else { throw decodeError(data, http.statusCode) }
        return try JSONDecoder().decode(Wrapper.self, from: data).sessions
    }

    static func createTrack(token: String, title: String?, planId: String? = nil) async throws -> CreateTrackResponse {
        var body: [String: Any] = [:]
        if let title, !title.isEmpty { body["title"] = title }
        if let planId { body["planId"] = planId }
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
    static func pingBatch(token: String, id: String, fixes: [Fix]) async throws {
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
    }

    static func end(token: String, id: String, retainHours: Double? = nil) async {
        var body: [String: Any]? = nil
        if let retainHours { body = ["retainHours": retainHours] }
        _ = try? await request("api/track/\(id)/end", method: "POST", token: token, body: body)
    }

    static func deleteSession(token: String, id: String) async {
        _ = try? await request("api/track/\(id)", method: "DELETE", token: token)
    }
}
