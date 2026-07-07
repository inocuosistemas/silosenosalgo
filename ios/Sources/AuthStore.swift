import Foundation

/// Owns the logged-in state + bearer token. The token lives in the Keychain so
/// the session survives restarts. `bootstrap()` trusts a stored token IMMEDIATELY
/// (so the app is usable offline — the whole point of a beacon) and validates it
/// against /api/auth/me in the background, signing out only on an EXPLICIT
/// rejection, never on a network/server hiccup.
@MainActor
final class AuthStore: ObservableObject {
    enum Status { case loading, anonymous, authed }

    @Published var status: Status = .loading
    @Published var user: AuthUser?
    @Published private(set) var token: String?

    /// Last known user, cached so the username shows even with no connectivity.
    private let cachedUserKey = "cachedAuthUser"

    init() {
        token = Keychain.load()
    }

    func bootstrap() async {
        guard let t = token else { status = .anonymous; return }
        // Trust the stored token right away: the app must work with NO connectivity.
        user = loadCachedUser()
        status = .authed
        // Validate in the background; only sign out if the server explicitly says
        // the token is invalid (200 with user:null, or 401). A network error or a
        // transient server error keeps the offline session alive.
        do {
            if let u = try await API.me(token: t) {
                user = u
                saveCachedUser(u)
            } else {
                clearLocal()
            }
        } catch let e as APIError where e.status == 401 {
            clearLocal()
        } catch {
            // Offline / transient: stay signed in with the cached user.
        }
    }

    func login(username: String, password: String) async throws {
        try await apply(API.login(username: username, password: password))
    }

    func logout() async {
        if let t = token { await API.logout(token: t) }
        clearLocal()
    }

    private func apply(_ res: AuthResponse) throws {
        guard let t = res.token else { throw APIError(status: 0, code: "network") }
        Keychain.save(t)
        token = t
        user = res.user
        saveCachedUser(res.user)
        status = .authed
    }

    private func clearLocal() {
        Keychain.clear()
        UserDefaults.standard.removeObject(forKey: cachedUserKey)
        token = nil
        user = nil
        status = .anonymous
    }

    private func saveCachedUser(_ u: AuthUser) {
        if let data = try? JSONEncoder().encode(u) { UserDefaults.standard.set(data, forKey: cachedUserKey) }
    }

    private func loadCachedUser() -> AuthUser? {
        guard let data = UserDefaults.standard.data(forKey: cachedUserKey) else { return nil }
        return try? JSONDecoder().decode(AuthUser.self, from: data)
    }
}
