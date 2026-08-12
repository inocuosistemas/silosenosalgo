import Foundation
import CryptoKit

/// Descarga el visor web de produccion y lo instala como copia OTA, para que los
/// cambios del visor lleguen a la app sin recompilar con Xcode ni publicar.
///
/// La regla que gobierna todo el diseño: **todo o nada**. Esta es una app de
/// montaña y el visor incrustado tiene que funcionar sin cobertura, asi que un
/// build a medias no puede llegar a activarse nunca. Por eso:
///
///  - se descarga a `staging/`, no sobre la copia en uso;
///  - se verifica el sha256 de CADA fichero contra el manifiesto;
///  - solo si estan todos y todos cuadran se promociona de golpe a `active/`;
///  - cualquier fallo (red, hash, espacio) deja `active/` intacta y se reintenta
///    en el proximo arranque.
///
/// Y nunca se actualiza con el visor abierto: se cambiarian los assets bajo los
/// pies de un WKWebView vivo. El build nuevo entra en la siguiente apertura.
actor WebOTAUpdater {
    static let shared = WebOTAUpdater()

    /// Tope de tamaño: el visor ronda los 4 MB; por encima de esto algo va mal
    /// (respuesta rara, manifiesto corrupto) y no merece gastar datos moviles.
    private static let maxTotalBytes = 24 * 1024 * 1024
    private static let requestTimeout: TimeInterval = 20

    private var running = false

    private struct Manifest: Decodable {
        struct Entry: Decodable { let path: String; let sha256: String; let bytes: Int }
        let buildId: String
        let files: [Entry]
        let totalBytes: Int
    }

    /// Punto de entrada: comprueba si hay visor nuevo y lo instala. Silencioso —
    /// no hay nada que el usuario pueda hacer si falla, y el visor empaquetado
    /// sigue sirviendo. Devuelve el buildId instalado si se activo uno nuevo.
    @discardableResult
    func refresh() async -> String? {
        guard !running else { return nil }
        running = true
        defer { running = false }

        do {
            let manifest = try await fetchManifest()
            let installed = await MainActor.run { WebAssetStore.shared.installedBuildId }
            guard manifest.buildId != installed else { return nil }
            guard manifest.totalBytes <= Self.maxTotalBytes else { return nil }

            try await download(manifest)
            try promote(buildId: manifest.buildId)
            await MainActor.run { WebAssetStore.shared.reloadActive() }
            return manifest.buildId
        } catch {
            // Limpiamos el staging para no dejar basura ni reintentar sobre restos.
            try? FileManager.default.removeItem(at: WebAssetStore.stagingURL)
            return nil
        }
    }

    // MARK: Pasos

    private func fetchManifest() async throws -> Manifest {
        var req = URLRequest(url: Config.baseURL.appendingPathComponent("ota-manifest.json"))
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = Self.requestTimeout
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw OTAError.badResponse }
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    /// Descarga el build entero a `staging/`, verificando cada fichero. Cualquier
    /// fallo aborta: no se instala nada a medias.
    private func download(_ manifest: Manifest) async throws {
        let fm = FileManager.default
        let staging = WebAssetStore.stagingURL
        try? fm.removeItem(at: staging)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)

        var shell: String?

        for entry in manifest.files {
            guard !entry.path.contains("..") else { throw OTAError.badPath }
            var req = URLRequest(url: Config.baseURL.appendingPathComponent(entry.path))
            req.timeoutInterval = Self.requestTimeout
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw OTAError.badResponse }

            // El HTML NO se puede verificar por hash: `functions/_middleware.ts`
            // lo reescribe al servirlo (og:* a URLs absolutas, y para los enlaces
            // `?s=` tambien el titulo), asi que los bytes servidos nunca coinciden
            // con los del build. Se valida por estructura mas abajo. Los assets,
            // que son los que llevan el codigo, si van con hash estricto: pasan
            // por el middleware sin tocarse.
            if entry.path.hasSuffix(".html") {
                shell = entry.path == "index.html" ? String(data: data, encoding: .utf8) : shell
            } else {
                let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                guard digest == entry.sha256 else { throw OTAError.hashMismatch(entry.path) }
            }

            let dest = staging.appendingPathComponent(entry.path)
            try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: dest, options: .atomic)
        }

        // Sin index.html no hay visor: mejor descartar que activar algo inservible.
        guard let shell, !shell.isEmpty else { throw OTAError.incomplete }

        // El shell tiene que apuntar a un modulo que este en el manifiesto (y por
        // tanto ya descargado y verificado por hash). Esto es lo que ata la
        // cascara al conjunto de assets: sin esta comprobacion podriamos guardar
        // un index.html de un build y los assets de otro, que es exactamente el
        // escenario que deja el visor en blanco.
        let modules = manifest.files.filter { $0.path.hasPrefix("assets/") && $0.path.hasSuffix(".js") }
        guard modules.contains(where: { shell.contains($0.path) }) else { throw OTAError.shellMismatch }
    }

    /// Sustituye `active/` por `staging/` de una vez. `replaceItemAt` es atomico
    /// dentro del mismo volumen: no hay instante en el que `active/` este a medias.
    private func promote(buildId: String) throws {
        let fm = FileManager.default
        let staging = WebAssetStore.stagingURL
        let active = WebAssetStore.activeURL

        try buildId.data(using: .utf8)?.write(to: staging.appendingPathComponent("ota-buildid"))

        if fm.fileExists(atPath: active.path) {
            _ = try fm.replaceItemAt(active, withItemAt: staging)
        } else {
            try fm.createDirectory(at: active.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: staging, to: active)
        }
        excludeFromBackup(WebAssetStore.otaContainer)
    }

    /// Es cache reconstruible: no tiene que ocupar espacio en iCloud ni en el
    /// backup del dispositivo.
    private func excludeFromBackup(_ url: URL) {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = url
        try? mutable.setResourceValues(values)
    }

    enum OTAError: Error {
        case badResponse
        case badPath
        case hashMismatch(String)
        case incomplete
        case shellMismatch
    }
}
