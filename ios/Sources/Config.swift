import Foundation

enum Config {
    /// Base URL of the silosenosalgo backend (Cloudflare Pages).
    /// For local testing against `wrangler pages dev`, replace with your Mac's
    /// LAN URL, e.g. URL(string: "http://192.168.1.50:8788")! (note: background
    /// GPS is best tested against the deployed https:// site).
    static let baseURL = URL(string: "https://silosenosalgo.pages.dev")!

    /// Canonical PUBLIC URL — every shareable link uses this, never pages.dev.
    static let publicURL = "https://silosenosalgo.themakercrowd.com"

    /// Public follower link for a tracking session token.
    static func shareLink(for token: String) -> String {
        "\(publicURL)/?t=\(token)"
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
