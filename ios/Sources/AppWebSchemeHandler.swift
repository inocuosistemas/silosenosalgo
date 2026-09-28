import Foundation
import WebKit

/// Serves the embedded viewer entirely from the device under the `appweb://`
/// scheme, so it works with no connectivity. WebKit forbids handlers for
/// http/https, so the SPA is loaded under this custom scheme and its RELATIVE
/// requests (`/assets/…`, `/api/…`, `/_tile/…`) route here:
///
///  - `/`, `/index.html`, `/assets/*`, `/favicon.svg`, …  → `WebAssetStore`
///    (copia OTA activa si la hay, si no el `WebDist/` empaquetado)
///  - `/api/track/<token>`  → `ViewerDataProvider` synthesized state (local trail)
///  - `/api/share/<id>`     → cached gzipped plan bytes
///  - `/api/yo`             → dónde está quien mira (`MiPosicion`)
///  - `/_tile/<z>/<x>/<y>.png` → `TileCache` (disk → network → placeholder)
///
/// The base document is loaded as `appweb://viewer/index.html?t=<token>&embedded=1`
/// so `main.tsx` takes the viewer branch and `LiveViewer` uses the cached tiles.
final class AppWebSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "appweb"

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

        // El mapa de OpenFreeMap (estilo, iconos, letras, mosaicos), por su
        // caché: ver `OfmCache`. Lo que no hay forma de tener, 404, y MapLibre
        // deja ese trozo en blanco.
        if path.hasPrefix("/_ofm/") {
            let ruta = String(path.dropFirst("/_ofm/".count))
            Task {
                let r = await OfmCache.shared.recurso(ruta)
                await MainActor.run {
                    if let (data, mime) = r { self.respond(task, url: url, data: data, mime: mime) }
                    else { self.finish404(task, url: url) }
                }
            }
            return
        }

        // Los mosaicos de antes: solo para una web anterior guardada (la que aún
        // no sabe de OpenFreeMap).
        if path.hasPrefix("/_tile/"), let key = Self.parseTile(path) {
            Task {
                let data = await TileCache.shared.tile(key.z, key.x, key.y)
                await MainActor.run { self.respond(task, url: url, data: data, mime: "image/png") }
            }
            return
        }

        // Dónde está quien mira, para su punto azul (ver `MiPosicion`).
        if path == "/api/yo" {
            let pedir = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.contains(where: { $0.name == "pedir" }) ?? false
            return respond(task, url: url, data: MiPosicion.shared.responde(pedir: pedir), mime: "application/json", noStore: true)
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

        // Locally retained note media, available to the embedded viewer offline.
        if let media = Self.parseNoteMedia(path),
           ViewerDataProvider.shared.isCurrent(media.token),
           let kind = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first(where: { $0.name == "kind" })?.value,
           kind == "audio" || kind == "photo" {
            let ext = kind == "audio" ? "m4a" : "jpg"
            let file = LocalStore.mediaFileURL(media.token, "\(media.noteId)_\(kind).\(ext)")
            if let data = try? Data(contentsOf: file) {
                let mime = kind == "audio" ? "audio/mp4" : "image/jpeg"
                return respond(task, url: url, data: data, mime: mime, noStore: true)
            }
            return finish404(task, url: url)
        }

        // Reaccionar a un ánimo (darle un "me gusta", o retirarlo). La LISTA de
        // ánimos NO pasa por aquí: viaja dentro del estado de la sesión, que se
        // sintetiza en local con lo que `ViewerDataProvider` haya traído del
        // servidor. Estas son escrituras, así que van al backend en el momento;
        // sin cobertura no hay nada que hacer y el visor ya lo maneja.
        if path.hasPrefix("/api/track/"), path.contains("/cheers") {
            // Una salida de este móvil no tiene ánimos: nadie la sigue.
            let t = String(path.dropFirst("/api/track/".count).split(separator: "/").first ?? "")
            if ModoLocal.activo || SalidasLocales.contiene(t) { return finish404(task, url: url) }
            forwardCheers(url: url, method: task.request.httpMethod ?? "GET") { data, mime in
                if let data {
                    self.respond(task, url: url, data: data, mime: mime, noStore: true)
                } else {
                    self.finish404(task, url: url)
                }
            }
            return
        }

        // Su dueño corrige los tramos o activa la detección desde el visor. El
        // cuerpo de un POST no llega a este manejador, así que el visor lo manda
        // también en la URL (`?a=` / `?activity=`): aquí se aplica en local y se
        // reenvía al servidor con la sesión del móvil.
        if path.hasPrefix("/api/track/"), path.hasSuffix("/tramos") || path.hasSuffix("/activity") {
            let partes = path.dropFirst("/api/track/".count).split(separator: "/")
            let token = String(partes.first ?? "")
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            var cuerpo: [String: Any]?
            if path.hasSuffix("/tramos"), let a = q.first(where: { $0.name == "a" })?.value,
               let datos = a.data(using: .utf8), let lista = try? JSONSerialization.jsonObject(with: datos) as? [Any] {
                ViewerDataProvider.shared.setTramosAjustes(token: token, json: lista.isEmpty ? nil : datos)
                cuerpo = ["ajustes": lista]
            } else if path.hasSuffix("/activity"), let v = q.first(where: { $0.name == "activity" })?.value {
                let actividad = BeaconActivity(rawValue: v)
                ViewerDataProvider.shared.setActivity(token: token, activity: actividad)
                cuerpo = ["activity": actividad?.rawValue ?? NSNull()]
            }
            guard let cuerpo else { return finish404(task, url: url) }
            // Una salida de este móvil se queda aquí: el servidor no la conoce.
            if ModoLocal.activo || SalidasLocales.contiene(token) {
                if path.hasSuffix("/activity") {
                    let v = q.first(where: { $0.name == "activity" })?.value
                    SalidasLocales.cambia(token) { $0.actividad = v.flatMap(BeaconActivity.init(rawValue:)) }
                    Task { @MainActor in TrackingStore.shared.refrescaSalidasLocales() }
                }
                return respond(task, url: url, data: Data("{}".utf8), mime: "application/json", noStore: true)
            }
            forwardJSON(path: path, body: cuerpo) { ok in
                if ok { self.respond(task, url: url, data: Data("{}".utf8), mime: "application/json", noStore: true) }
                else { self.finish404(task, url: url) }
            }
            return
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

        // Static assets: copia OTA activa si la hay, si no la empaquetada.
        if let (data, mime) = WebAssetStore.shared.load(path) {
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

    /// Reenvía al backend una petición de ánimos, conservando ruta, query y
    /// método. Los `like`/`DELETE` van sin cuerpo porque el visor los manda todo
    /// en la query (el manejador del esquema no recibe cuerpos).
    private func forwardCheers(url: URL, method: String,
                               completion: @escaping (Data?, String) -> Void) {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var base = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false)
        base?.path = url.path
        base?.query = comps?.query
        guard let remote = base?.url else { return completion(nil, "application/json") }

        var req = URLRequest(url: remote)
        req.httpMethod = method
        req.setValue("token", forHTTPHeaderField: "X-Auth-Mode")
        if let auth = Keychain.load() { req.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization") }
        req.timeoutInterval = 12

        URLSession.shared.dataTask(with: req) { data, response, _ in
            let http = response as? HTTPURLResponse
            let mime = http?.value(forHTTPHeaderField: "Content-Type")?
                .components(separatedBy: ";").first?
                .trimmingCharacters(in: .whitespaces) ?? "application/json"
            let ok = (200...299).contains(http?.statusCode ?? 0)
            DispatchQueue.main.async { completion(ok ? data : nil, mime) }
        }.resume()
    }

    /// Un POST con cuerpo JSON al servidor, con la sesión del móvil.
    private func forwardJSON(path: String, body: [String: Any], completion: @escaping (Bool) -> Void) {
        var base = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false)
        base?.path = path
        guard let remote = base?.url, let datos = try? JSONSerialization.data(withJSONObject: body) else {
            return completion(false)
        }
        var req = URLRequest(url: remote)
        req.httpMethod = "POST"
        req.httpBody = datos
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("token", forHTTPHeaderField: "X-Auth-Mode")
        if let auth = Keychain.load() { req.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization") }
        req.timeoutInterval = 12
        URLSession.shared.dataTask(with: req) { _, response, _ in
            let ok = (200...299).contains((response as? HTTPURLResponse)?.statusCode ?? 0)
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    private static func parseTile(_ path: String) -> (z: Int, x: Int, y: Int)? {
        // "/_tile/z/x/y.png"
        let parts = path.dropFirst("/_tile/".count).split(separator: "/")
        guard parts.count == 3,
              let z = Int(parts[0]), let x = Int(parts[1]),
              let y = Int(parts[2].split(separator: ".").first ?? "") else { return nil }
        return (z, x, y)
    }

    private static func parseNoteMedia(_ path: String) -> (token: String, noteId: String)? {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 6,
              parts[0] == "api", parts[1] == "track", parts[3] == "notes", parts[5] == "media" else {
            return nil
        }
        return (token: parts[2], noteId: parts[4])
    }
}
