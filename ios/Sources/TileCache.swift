import Foundation
import UIKit

/// A slippy-map tile coordinate.
struct TileKey: Hashable { let z: Int; let x: Int; let y: Int }

/// On-disk raster-tile cache for the embedded offline map. Serves tiles to the
/// `AppWebSchemeHandler` (`/_tile/z/x/y.png`): disk hit → cached bytes; miss while
/// online → fetch from OSM and store (incremental cache-as-you-view); miss offline
/// → a neutral placeholder. Also pre-downloads a corridor of tiles around a route.
///
/// OSM tile usage policy: descriptive User-Agent, ≤2 concurrent connections, a
/// throttle between requests, and a hard cap on bulk downloads. The tile source is
/// swappable in `Config` if a bulk-friendly provider is ever needed.
final class TileCache {
    static let shared = TileCache()

    private let session: URLSession
    private let root: URL

    private init() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpMaximumConnectionsPerHost = 2
        cfg.httpAdditionalHeaders = ["User-Agent": Config.tileUserAgent]
        cfg.timeoutIntervalForRequest = 20
        session = URLSession(configuration: cfg)
        root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tiles", isDirectory: true)
    }

    // MARK: Disk layout

    private func fileURL(_ z: Int, _ x: Int, _ y: Int) -> URL {
        root.appendingPathComponent("\(z)/\(x)/\(y).png")
    }

    private func hasTile(_ z: Int, _ x: Int, _ y: Int) -> Bool {
        FileManager.default.fileExists(atPath: fileURL(z, x, y).path)
    }

    private func store(_ data: Data, _ z: Int, _ x: Int, _ y: Int) {
        let url = fileURL(z, x, y)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Serving

    /// Cached tile bytes (offline path) → remote fetch + store (incremental) →
    /// placeholder. Never throws; returns a drawable PNG so the map has no holes.
    func tile(_ z: Int, _ x: Int, _ y: Int) async -> Data {
        if let data = try? Data(contentsOf: fileURL(z, x, y)) { return data }
        if let data = await fetchRemote(z, x, y) {
            store(data, z, x, y)
            return data
        }
        return placeholder
    }

    private func fetchRemote(_ z: Int, _ x: Int, _ y: Int) async -> Data? {
        let sub = Config.tileSubdomains[(x + y) % max(1, Config.tileSubdomains.count)]
        let s = Config.tileURLTemplate
            .replacingOccurrences(of: "{s}", with: sub)
            .replacingOccurrences(of: "{z}", with: String(z))
            .replacingOccurrences(of: "{x}", with: String(x))
            .replacingOccurrences(of: "{y}", with: String(y))
        guard let url = URL(string: s) else { return nil }
        guard let (data, resp) = try? await session.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else { return nil }
        return data
    }

    /// Neutral 256×256 tile shown when a tile isn't cached and we're offline —
    /// matches the app's dark theme so gaps read as "not downloaded", not broken.
    private lazy var placeholder: Data = {
        let r = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256))
        return r.image { ctx in
            UIColor(red: 0.09, green: 0.11, blue: 0.16, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
        }.pngData() ?? Data()
    }()

    // MARK: Corridor pre-download

    /// Tile set covering a corridor of `corridorMeters` around `polyline`, at every
    /// zoom in `zMin...zMax`. Pure (no I/O) so callers can preview the count/size.
    static func corridorTiles(polyline: [(lat: Double, lon: Double)], corridorMeters: Double, zMin: Int, zMax: Int) -> Set<TileKey> {
        var set = Set<TileKey>()
        guard polyline.count >= 1, zMax >= zMin else { return set }

        func addAround(_ lat: Double, _ lon: Double, _ z: Int) {
            let tm = tileMeters(lat: lat, z: z)
            let r = max(1, Int(ceil(corridorMeters / max(1, tm))))
            let (cx, cy) = tileXY(lat: lat, lon: lon, z: z)
            for dx in -r...r { for dy in -r...r { set.insert(TileKey(z: z, x: cx + dx, y: cy + dy)) } }
        }

        // Build the corridor at the finest zoom, densifying long segments so no
        // tile is skipped, then derive coarser zooms from the parents.
        let z = zMax
        for i in polyline.indices {
            let p = polyline[i]
            addAround(p.lat, p.lon, z)
            guard i < polyline.count - 1 else { continue }
            let q = polyline[i + 1]
            let seg = haversineMeters(p.lat, p.lon, q.lat, q.lon)
            let step = tileMeters(lat: p.lat, z: z) / 2
            if seg > step {
                let n = min(2000, Int(seg / step)) // guard pathological segments
                if n > 1 {
                    for k in 1..<n {
                        let f = Double(k) / Double(n)
                        addAround(p.lat + (q.lat - p.lat) * f, p.lon + (q.lon - p.lon) * f, z)
                    }
                }
            }
        }
        // Ancestors down to zMin (parent = x>>1, y>>1).
        var current = set
        var zz = z
        while zz > zMin {
            var parents = Set<TileKey>()
            for t in current { parents.insert(TileKey(z: t.z - 1, x: t.x >> 1, y: t.y >> 1)) }
            set.formUnion(parents)
            current = parents
            zz -= 1
        }
        // Drop out-of-range tiles (corridor expansion can overshoot the world edge).
        return set.filter { $0.x >= 0 && $0.y >= 0 && $0.z >= 0 && $0.x < (1 << $0.z) && $0.y < (1 << $0.z) }
    }

    /// ≈ bytes a corridor would occupy (average OSM raster tile ~20 KB).
    static func estimatedBytes(tileCount: Int) -> Int64 { Int64(tileCount) * 20_000 }

    /// Download every tile in the corridor that isn't already cached. `progress`
    /// reports (done, total); `isCancelled` is polled between batches. Concurrency
    /// is capped at 2 with a small inter-batch throttle (OSM policy). Callers should
    /// marshal `progress` to the main actor.
    func downloadCorridor(polyline: [(lat: Double, lon: Double)],
                          corridorMeters: Double, zMin: Int, zMax: Int,
                          maxTiles: Int = 20_000,
                          progress: @escaping (Int, Int) -> Void,
                          isCancelled: @escaping () -> Bool) async {
        let all = Self.corridorTiles(polyline: polyline, corridorMeters: corridorMeters, zMin: zMin, zMax: zMax)
        let pending = all.filter { !hasTile($0.z, $0.x, $0.y) }.prefix(maxTiles)
        let arr = Array(pending)
        let total = arr.count
        progress(0, total)
        var done = 0
        var i = 0
        while i < arr.count {
            if isCancelled() { break }
            let slice = arr[i..<min(i + 2, arr.count)] // ≤2 concurrent
            await withTaskGroup(of: Void.self) { group in
                for key in slice {
                    group.addTask { [weak self] in
                        guard let self else { return }
                        if let data = await self.fetchRemote(key.z, key.x, key.y) {
                            self.store(data, key.z, key.x, key.y)
                        }
                    }
                }
            }
            done += slice.count
            i += 2
            progress(done, total)
            try? await Task.sleep(nanoseconds: 100_000_000) // ~100 ms throttle between pairs
        }
    }

    // MARK: Cache management

    func cacheSizeBytes() -> Int64 {
        guard let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in en {
            total += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        }
        return total
    }

    func clear() { try? FileManager.default.removeItem(at: root) }

    // MARK: Slippy-map math

    static func tileXY(lat: Double, lon: Double, z: Int) -> (x: Int, y: Int) {
        let n = pow(2.0, Double(z))
        let x = Int(floor((lon + 180.0) / 360.0 * n))
        let latRad = lat * .pi / 180.0
        let y = Int(floor((1.0 - asinh(tan(latRad)) / .pi) / 2.0 * n))
        return (x, y)
    }

    /// Ground width (m) of one tile at `lat`/`z` — drives the corridor radius.
    static func tileMeters(lat: Double, z: Int) -> Double {
        256.0 * 156543.03392 * cos(lat * .pi / 180.0) / pow(2.0, Double(z))
    }

    static func haversineMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
