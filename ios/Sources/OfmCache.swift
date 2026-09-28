import Foundation

/// El mapa de OpenFreeMap, guardado en el móvil: lo que el visor pide por
/// `/_ofm/<ruta>` se sirve del disco y, si no está, se baja de
/// `https://tiles.openfreemap.org/<ruta>` y se guarda. Estilo, iconos, letras y
/// mosaicos vectoriales, por el mismo camino (ver `lib/mapaBase.ts` en la web).
/// Espejo de `OfmCache` en Android.
///
/// Sustituye a los mosaicos de OpenStreetMap (`TileCache`), cuyas normas prohíben
/// el uso intenso desde una app repartida al público y descargarlos para usarlos
/// sin conexión. OpenFreeMap es gratis, sin límites ni clave.
///
/// Lo que puede cambiar (el estilo y el índice `planet`, que apunta a la versión
/// vigente de los mosaicos) se pide primero a la red y, sin ella, se sirve lo
/// guardado; lo demás no cambia nunca y se sirve del disco sin preguntar.
final class OfmCache: @unchecked Sendable {
    static let shared = OfmCache()

    /** Hasta aquí llegan los mosaicos vectoriales de OpenFreeMap: se amplían desde ahí. */
    static let zoomMax = 14

    private let session: URLSession
    private let root: URL
    private static let base = "https://tiles.openfreemap.org/"

    private init() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpMaximumConnectionsPerHost = 4
        cfg.httpAdditionalHeaders = ["User-Agent": Config.tileUserAgent]
        cfg.timeoutIntervalForRequest = 20
        session = URLSession(configuration: cfg)
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ofm", isDirectory: true)
    }

    /// Lo que no tiene extensión (el estilo, el índice `planet`) se guarda como
    /// `.json`: si no, el fichero `planet` impediría la carpeta `planet/`.
    private func fichero(_ ruta: String) -> URL {
        let limpia = ruta.hasPrefix("/") ? String(ruta.dropFirst()) : ruta
        let ultimo = limpia.split(separator: "/").last.map(String.init) ?? limpia
        return root.appendingPathComponent(ultimo.contains(".") ? limpia : limpia + ".json")
    }

    private func esCambiante(_ ruta: String) -> Bool { ruta.hasPrefix("styles/") || ruta == "planet" }

    private func tipo(_ ruta: String) -> String {
        if ruta.hasSuffix(".png") { return "image/png" }
        if ruta.hasSuffix(".pbf") { return "application/x-protobuf" }
        return "application/json"
    }

    /// Los bytes y el tipo de `ruta` (la parte tras `/_ofm/`, sin codificar), o nil.
    func recurso(_ ruta: String) async -> (Data, String)? {
        guard !ruta.contains("..") else { return nil }
        let f = fichero(ruta)
        if !esCambiante(ruta), let d = try? Data(contentsOf: f) { return (d, tipo(ruta)) }
        if let d = await baja(ruta) {
            try? FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? d.write(to: f, options: .atomic)
            return (d, tipo(ruta))
        }
        if let d = try? Data(contentsOf: f) { return (d, tipo(ruta)) }
        return nil
    }

    private func baja(_ ruta: String) async -> Data? {
        let codificada = ruta.split(separator: "/", omittingEmptySubsequences: false)
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? String($0) }
            .joined(separator: "/")
        guard let url = URL(string: Self.base + codificada),
              let (data, resp) = try? await session.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else { return nil }
        return data
    }

    // MARK: Descargar el mapa de una ruta

    /// La plantilla de los mosaicos de la versión vigente, relativa:
    /// "planet/<versión>/{z}/{x}/{y}.pbf".
    private func plantilla() -> String? {
        guard let d = try? Data(contentsOf: fichero("planet")),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let t = (obj["tiles"] as? [String])?.first else { return nil }
        return t.replacingOccurrences(of: Self.base, with: "")
    }

    private func ruta(_ k: TileKey, _ p: String) -> String {
        p.replacingOccurrences(of: "{z}", with: "\(k.z)")
            .replacingOccurrences(of: "{x}", with: "\(k.x)")
            .replacingOccurrences(of: "{y}", with: "\(k.y)")
    }

    private func tiene(_ k: TileKey, _ p: String) -> Bool {
        FileManager.default.fileExists(atPath: fichero(ruta(k, p)).path)
    }

    func isCached(_ z: Int, _ x: Int, _ y: Int) -> Bool {
        guard let p = plantilla() else { return false }
        return tiene(TileKey(z: z, x: x, y: y), p)
    }

    func cachedTiles(in tiles: Set<TileKey>) -> Int {
        guard let p = plantilla() else { return 0 }
        return tiles.filter { tiene($0, p) }.count
    }

    /// Los mosaicos guardados al zoom `z` alrededor de la ruta: los cuadros verdes
    /// de la vista previa.
    func cachedCoverage(polyline: [(lat: Double, lon: Double)], z: Int = 12) -> [TileKey] {
        guard !polyline.isEmpty, let p = plantilla() else { return [] }
        let lats = polyline.map(\.lat), lons = polyline.map(\.lon)
        let cand = TileCache.tilesCovering(minLat: lats.min()! - 0.05, maxLat: lats.max()! + 0.05,
                                           minLon: lons.min()! - 0.05, maxLon: lons.max()! + 0.05, z: z)
        return cand.filter { tiene($0, p) }
    }

    /// Un mosaico vectorial de OpenFreeMap ronda los 30 KB.
    static func estimatedBytes(tileCount: Int) -> Int64 { Int64(tileCount) * 30_000 }

    /// Baja lo que hace falta para ver sin cobertura el mapa de un corredor: el
    /// estilo, sus iconos y letras, el índice y los mosaicos (hasta el 14).
    func downloadCorridor(polyline: [(lat: Double, lon: Double)],
                          corridorMeters: Double, zMin: Int, zMax: Int,
                          progress: @escaping (Int, Int) -> Void,
                          isCancelled: @escaping () -> Bool) async {
        await preparaBase()
        guard let p = plantilla() else { progress(0, 0); return }
        let todas = TileCache.corridorTiles(polyline: polyline, corridorMeters: corridorMeters,
                                            zMin: zMin, zMax: min(zMax, Self.zoomMax))
        let pendientes = Array(todas.filter { !tiene($0, p) })
        let total = pendientes.count
        progress(0, total)
        var hechas = 0
        for tanda in stride(from: 0, to: pendientes.count, by: 12).map({ Array(pendientes[$0..<min($0 + 12, pendientes.count)]) }) {
            if isCancelled() { break }
            await withTaskGroup(of: Void.self) { g in
                for k in tanda { g.addTask { _ = await self.recurso(self.ruta(k, p)) } }
            }
            hechas += tanda.count
            progress(hechas, total)
        }
    }

    /// Lo que necesita cualquier mapa: estilo, índice, iconos y letras (los
    /// tramos del alfabeto latino, con tildes, eñes y los del turco o el catalán).
    private func preparaBase() async {
        guard let (d, _) = await recurso("styles/liberty") else { return }
        _ = await recurso("planet")
        guard let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        if let sprite = (obj["sprite"] as? String)?.replacingOccurrences(of: Self.base, with: "") {
            for suf in [".json", ".png", "@2x.json", "@2x.png"] { _ = await recurso(sprite + suf) }
        }
        var familias = Set<String>()
        for capa in (obj["layers"] as? [[String: Any]]) ?? [] {
            if let f = (capa["layout"] as? [String: Any])?["text-font"] as? [String] { familias.formUnion(f) }
        }
        for f in familias { for tramo in ["0-255", "256-511", "8192-8447"] { _ = await recurso("fonts/\(f)/\(tramo).pbf") } }
    }

    func cacheSizeBytes() -> Int64 {
        guard let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in en { total += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) }
        return total
    }

    func clear() { try? FileManager.default.removeItem(at: root) }
}
