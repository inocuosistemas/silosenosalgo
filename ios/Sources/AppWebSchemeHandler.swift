import Foundation
import WebKit

/// Serves the embedded viewer entirely from the device under the `appweb://`
/// scheme, so it works with no connectivity. WebKit forbids handlers for
/// http/https, so the SPA is loaded under this custom scheme and its RELATIVE
/// requests (`/assets/…`, `/api/…`, `/_tile/…`) route here:
///
///  - `/`, `/index.html`, `/assets/*`, `/favicon.svg`, …  → bundled `WebDist/`
///  - `/api/track/<token>`  → `ViewerDataProvider` synthesized state (local trail)
///  - `/api/share/<id>`     → cached gzipped plan bytes
///  - `/_tile/<z>/<x>/<y>.png` → `TileCache` (disk → network → placeholder)
///
/// The base document is loaded as `appweb://viewer/index.html?t=<token>&embedded=1`
/// so `main.tsx` takes the viewer branch and `LiveViewer` uses the cached tiles.
final class AppWebSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "appweb"

    /// Bundled web assets (folder reference), resolved once.
    private lazy var webRoot: URL? = Bundle.main.url(forResource: "WebDist", withExtension: nil)

    /// Tasks WebKit still considers live. `stop()` removes them; delivering to a
    /// stopped task crashes, so every callback is guarded by this set.
    private let lock = NSLock()
    private var liveTasks = Set<ObjectIdentifier>()

    private func markLive(_ task: WKURLSchemeTask) {
        lock.lock(); liveTasks.insert(ObjectIdentifier(task)); lock.unlock()
    }
    private func markDone(_ task: WKURLSchemeTask) {
        lock.lock(); liveTasks.remove(ObjectIdentifier(task)); lock.unlock()
    }
    private func isLive(_ task: WKURLSchemeTask) -> Bool {
        lock.lock(); defer { lock.unlock() }; return liveTasks.contains(ObjectIdentifier(task))
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        markLive(task)
        guard let url = task.request.url else { return finish404(task, url: nil) }
        let path = url.path.isEmpty ? "/" : url.path

        // Async tile route.
        if path.hasPrefix("/_tile/"), let key = Self.parseTile(path) {
            Task {
                let data = await TileCache.shared.tile(key.z, key.x, key.y)
                await MainActor.run { self.respond(task, url: url, data: data, mime: "image/png") }
            }
            return
        }

        // Runner confirms a form change: update the local synthesized state AND
        // forward to the real backend (best-effort) so followers get it too.
        if path.hasPrefix("/api/track/") && path.hasSuffix("/form") {
            let token = String(path.dropFirst("/api/track/".count).dropLast("/form".count))
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let factor = Double(q.first(where: { $0.name == "factor" })?.value ?? "")
            let km = Double(q.first(where: { $0.name == "km" })?.value ?? "")
            if let factor {
                ViewerDataProvider.shared.setForm(token: token, factor: factor, km: km)
                forwardForm(token: token, factor: factor, km: km)
            }
            return respond(task, url: url, data: Data(), mime: "application/json", noStore: true)
        }

        // Local API routes (synchronous).
        if path.hasPrefix("/api/track/") {
            let token = String(path.dropFirst("/api/track/".count))
            if let data = ViewerDataProvider.shared.trackStateJSON(token: token) {
                return respond(task, url: url, data: data, mime: "application/json", noStore: true)
            }
            return finish404(task, url: url)
        }
        if path.hasPrefix("/api/share/") {
            let id = String(path.dropFirst("/api/share/".count))
            if let data = ViewerDataProvider.shared.planBytes(id: id) {
                return respond(task, url: url, data: data, mime: "application/octet-stream", noStore: true)
            }
            return finish404(task, url: url)
        }

        // Bundled static assets.
        if let (data, mime) = loadBundled(path) {
            return respond(task, url: url, data: data, mime: mime)
        }
        finish404(task, url: url)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        markDone(task)
    }

    // MARK: Responding (guarded against stopped tasks)

    private func respond(_ task: WKURLSchemeTask, url: URL, data: Data, mime: String, noStore: Bool = false) {
        guard isLive(task) else { return }
        var headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
        ]
        if noStore { headers["Cache-Control"] = "no-store" }
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        guard isLive(task) else { return }
        task.didReceive(data)
        guard isLive(task) else { return }
        task.didFinish()
        markDone(task)
    }

    private func finish404(_ task: WKURLSchemeTask, url: URL?) {
        guard isLive(task) else { return }
        let resp = HTTPURLResponse(url: url ?? URL(string: "appweb://viewer/")!, statusCode: 404,
                                   httpVersion: "HTTP/1.1", headerFields: ["Access-Control-Allow-Origin": "*"])!
        task.didReceive(resp)
        guard isLive(task) else { return }
        task.didReceive(Data())
        guard isLive(task) else { return }
        task.didFinish()
        markDone(task)
    }

    /// Forward a confirmed form change to the real backend so followers see it.
    /// Fire-and-forget; the local synthesized state already reflects it offline.
    private func forwardForm(token: String, factor: Double, km: Double?) {
        guard let auth = Keychain.load() else { return }
        var comps = URLComponents(url: Config.baseURL.appendingPathComponent("api/track/\(token)/form"),
                                  resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "factor", value: String(factor))]
        if let km { items.append(URLQueryItem(name: "km", value: String(km))) }
        comps?.queryItems = items
        guard let url = comps?.url else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        req.setValue("token", forHTTPHeaderField: "X-Auth-Mode")
        URLSession.shared.dataTask(with: req).resume()
    }

    // MARK: Bundle serving

    /// Map an absolute request path onto a bundled file, returning bytes + MIME.
    private func loadBundled(_ path: String) -> (Data, String)? {
        guard let root = webRoot else { return nil }
        var rel = path == "/" ? "index.html" : String(path.dropFirst())
        // Deep links / unknown non-asset paths fall back to the SPA shell.
        if !rel.contains(".") { rel = "index.html" }
        guard !rel.contains("..") else { return nil } // path-traversal guard
        let file = root.appendingPathComponent(rel)
        guard let data = try? Data(contentsOf: file) else { return nil }
        return (data, Self.mime(for: file.pathExtension.lowercased()))
    }

    private static func mime(for ext: String) -> String {
        switch ext {
        case "js", "mjs": return "text/javascript"   // ES modules REQUIRE a JS MIME
        case "css": return "text/css"
        case "html": return "text/html"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }

    private static func parseTile(_ path: String) -> (z: Int, x: Int, y: Int)? {
        // "/_tile/z/x/y.png"
        let parts = path.dropFirst("/_tile/".count).split(separator: "/")
        guard parts.count == 3,
              let z = Int(parts[0]), let x = Int(parts[1]),
              let y = Int(parts[2].split(separator: ".").first ?? "") else { return nil }
        return (z, x, y)
    }
}
