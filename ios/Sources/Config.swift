import Foundation

enum Config {
    /// Canonical URL: our own domain, and ONLY that one — for the API and for
    /// shareable links alike. Mirror of `android/.../Config.kt`.
    ///
    /// This used to be `https://silosenosalgo.pages.dev`, the subdomain
    /// Cloudflare hands to the Pages project, and that killed the app the day
    /// that name stopped answering: verified from two different networks, it
    /// would not even accept a TCP connection while the own domain served the
    /// very same API. The failure is silent — the session list swallows the
    /// error on purpose so a good list survives a tunnel — so it just looks
    /// like the user has no tracks at all. The own domain is the only one we
    /// control, and a shipped app cannot be fixed remotely.
    ///
    /// For local testing against `wrangler pages dev`, replace with your Mac's
    /// LAN URL, e.g. URL(string: "http://192.168.1.50:8788")! (note: background
    /// GPS is best tested against the deployed https:// site).
    static let publicURL = "https://silosenosalgo.themakercrowd.com"

    static let baseURL = URL(string: publicURL)!

    /// Public follower link for a tracking session token.
    static func shareLink(for token: String) -> String {
        "\(publicURL)/?t=\(token)"
    }

    /// La PARRILLA de un evento: la pantalla web donde están los participantes,
    /// el tablón, la marca de cada uno y los resultados.
    ///
    /// Vive solo en la web —el visor incrustado en la app se carga siempre con
    /// `?t=`, así que nunca puede pintarla— y hasta ahora no había forma de
    /// llegar a ella desde aquí: quien abría la app para salir tenía que buscar
    /// el enlace en el chat del grupo. Mirror of `Config.kt`.
    static func eventLobbyLink(for eventId: String) -> String {
        "\(publicURL)/?e=\(eventId)"
    }

    // MARK: Offline map tiles

    /// OSM raster tile template for the offline map cache. Kept in one place so a
    /// different provider can be swapped in for bulk downloads (OSM's usage policy
    /// discourages heavy pre-downloading).
    static let tileURLTemplate = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    /// Subdomains the `{s}` placeholder rotates over.
    static let tileSubdomains = ["a", "b", "c"]
    /// Descriptive User-Agent required by the OSM tile usage policy (generic/absent
    /// UAs get blocked).
    static let tileUserAgent = "SiLoSeNoSalgo-iOS/1.0 (+https://silosenosalgo.themakercrowd.com; tic@iemed.org)"
}
