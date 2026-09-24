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
    /// La marca de la cuenta, para el botón de arriba a la derecha. Guardada en
    /// el móvil para que se vea al abrir sin esperar a la red (ver `cargaPerfil`).
    @Published private(set) var perfil = PerfilDeCuenta()

    /// Last known user, cached so the username shows even with no connectivity.
    private let cachedUserKey = "cachedAuthUser"
    private let perfilKey = "perfilDeCuenta"

    init() {
        token = Keychain.load()
        if let d = UserDefaults.standard.data(forKey: perfilKey),
           let p = try? JSONDecoder().decode(PerfilDeCuenta.self, from: d) { perfil = p }
    }

    /// La marca, del servidor. Sin red se queda la guardada.
    func cargaPerfil() async {
        guard let t = token, let p = try? await API.perfil(token: t) else { return }
        ponPerfil(p)
    }

    func guardaPerfil(emoji: String?? = nil, color: String?? = nil) async throws {
        guard let t = token else { throw APIError(status: 401, code: "unauthorized") }
        ponPerfil(try await API.guardaPerfil(token: t, emoji: emoji, color: color))
    }

    /// Para las pantallas de prueba (`-PruebaDePantallaPrincipal`): un usuario
    /// y una marca sin pasar por el servidor.
    func siembraDePrueba(usuario: String, perfil p: PerfilDeCuenta) {
        user = AuthUser(id: "prueba", username: usuario)
        perfil = p
    }

    private func ponPerfil(_ p: PerfilDeCuenta) {
        perfil = p
        if let d = try? JSONEncoder().encode(p) { UserDefaults.standard.set(d, forKey: perfilKey) }
    }

    /// Cambia la contraseña y se queda con la sesión nueva que da el servidor:
    /// la de antes deja de valer, en este móvil y en todos.
    func cambiaContrasena(actual: String, nueva: String) async throws {
        guard let t = token else { throw APIError(status: 401, code: "unauthorized") }
        try apply(try await API.cambiaContrasena(token: t, actual: actual, nueva: nueva))
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
        UserDefaults.standard.removeObject(forKey: perfilKey)
        perfil = PerfilDeCuenta()
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
