import Foundation

/// Owns the logged-in state + bearer token. The token lives in the Keychain so
/// the session survives restarts; `bootstrap()` validates it against /api/auth/me.
@MainActor
final class AuthStore: ObservableObject {
    enum Status { case loading, anonymous, authed }

    @Published var status: Status = .loading
    @Published var user: AuthUser?
    @Published private(set) var token: String?

    init() {
        token = Keychain.load()
    }

    func bootstrap() async {
        guard let t = token else { status = .anonymous; return }
        do {
            if let u = try await API.me(token: t) {
                user = u
                status = .authed
            } else {
                clearLocal()
            }
        } catch {
            // Network hiccup: don't wipe the token, just show login; a retry
            // (relaunch / next login) will re-validate.
            status = .anonymous
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
        status = .authed
    }

    private func clearLocal() {
        Keychain.clear()
        token = nil
        user = nil
        status = .anonymous
    }
}
