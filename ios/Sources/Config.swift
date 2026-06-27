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
}
