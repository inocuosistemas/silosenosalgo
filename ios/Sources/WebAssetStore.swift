import Foundation

/// Resuelve los ficheros estaticos del visor incrustado (index.html, /assets/*,
/// iconos…) desde DOS origenes, en este orden:
///
///  1. La copia OTA activa en Application Support, si la hay — el visor que se
///     descargo de produccion despues de instalar la app.
///  2. `WebDist/` empaquetado en el bundle — el visor con el que se compilo.
///
/// Existe porque la app embebe una copia congelada de `dist/`: sin esto, cada
/// cambio del visor web exige recompilar con Xcode y publicar. Con esto, el
/// visor se actualiza solo y el bundle queda como red de seguridad: si la copia
/// OTA falta, esta incompleta o no se puede leer, se sirve la empaquetada y la
/// app sigue funcionando exactamente como antes.
///
/// Quien escribe la copia OTA es `WebOTAUpdater`, y solo la activa cuando esta
/// entera. Aqui nunca se mezclan origenes dentro de una misma carga: si hay OTA
/// activa se sirve de ella, y solo se cae al bundle fichero a fichero cuando la
/// OTA no lo tiene (caso que el updater ya evita, pero mas vale servir algo).
final class WebAssetStore {
    static let shared = WebAssetStore()

    /// Assets empaquetados con la app (carpeta de referencia `WebDist`).
    private lazy var bundleRoot: URL? = Bundle.main.url(forResource: "WebDist", withExtension: nil)

    /// Raiz de la copia OTA activa, o nil si aun no se ha instalado ninguna.
    private(set) var activeRoot: URL?

    private init() {
        activeRoot = Self.installedRoot()
    }

    // MARK: Rutas en disco

    /// Application Support/WebOTA — fuera de Documents para que no salga en la
    /// app de Archivos, y marcada como no-respaldable: es cache reconstruible.
    static var otaContainer: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("WebOTA", isDirectory: true)
    }
    static var activeURL: URL { otaContainer.appendingPathComponent("active", isDirectory: true) }
    static var stagingURL: URL { otaContainer.appendingPathComponent("staging", isDirectory: true) }

    /// La copia activa solo cuenta si existe y tiene index.html; cualquier otra
    /// cosa es un resto a medias y se ignora (se servira el bundle).
    private static func installedRoot() -> URL? {
        let idx = activeURL.appendingPathComponent("index.html")
        return FileManager.default.fileExists(atPath: idx.path) ? activeURL : nil
    }

    /// Vuelve a mirar el disco. La llama el updater tras activar un build nuevo.
    func reloadActive() {
        activeRoot = Self.installedRoot()
    }

    /// buildId instalado, para que el updater sepa si hay que descargar algo.
    var installedBuildId: String? {
        guard let root = activeRoot,
              let data = try? Data(contentsOf: root.appendingPathComponent("ota-buildid")),
              let id = String(data: data, encoding: .utf8) else { return nil }
        return id.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Lectura

    /// Traduce una ruta absoluta de peticion a bytes + MIME.
    /// Devuelve nil solo si el fichero no esta en ninguno de los dos origenes.
    func load(_ path: String) -> (Data, String)? {
        var rel = path == "/" ? "index.html" : String(path.dropFirst())
        // Deep links y rutas sin extension caen al shell de la SPA.
        if !rel.contains(".") { rel = "index.html" }
        guard !rel.contains("..") else { return nil } // path traversal

        for root in [activeRoot, bundleRoot].compactMap({ $0 }) {
            let file = root.appendingPathComponent(rel)
            if let data = try? Data(contentsOf: file) {
                return (data, Self.mime(for: file.pathExtension.lowercased()))
            }
        }
        return nil
    }

    static func mime(for ext: String) -> String {
        switch ext {
        case "js", "mjs": return "text/javascript"   // los modulos ES EXIGEN MIME de JS
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
        case "gpx", "xml": return "application/xml"
        case "txt": return "text/plain"
        default: return "application/octet-stream"
        }
    }
}
