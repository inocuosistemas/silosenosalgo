import Foundation
import Compression

/// Minimal gunzip for the cached plan blobs. Apple's `COMPRESSION_ZLIB` decodes
/// RAW DEFLATE (RFC 1951), so we strip gzip's 10-byte header and 8-byte trailer
/// and inflate the middle. The blobs are produced by the browser's
/// `CompressionStream('gzip')`, which emits FLG=0 (no extra header fields).
enum Gzip {
    static func inflate(_ gz: Data) -> Data? {
        guard gz.count > 18, gz[gz.startIndex] == 0x1f, gz[gz.startIndex + 1] == 0x8b,
              gz[gz.startIndex + 2] == 0x08, gz[gz.startIndex + 3] == 0x00 else { return nil }
        let deflate = gz.subdata(in: (gz.startIndex + 10) ..< (gz.endIndex - 8))
        // ISIZE trailer (uncompressed size, little-endian) sizes the output buffer.
        let isize = gz.suffix(4).reversed().reduce(0) { ($0 << 8) | Int($1) }
        let capacity = max(isize, deflate.count * 6, 64 * 1024)
        return deflate.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Data? in
            guard let base = src.bindMemory(to: UInt8.self).baseAddress else { return nil }
            let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { dst.deallocate() }
            let n = compression_decode_buffer(dst, capacity, base, deflate.count, nil, COMPRESSION_ZLIB)
            return n > 0 ? Data(bytes: dst, count: n) : nil
        }
    }
}

/// Extracts the planned-route polyline from a session's cached plan blob, so the
/// offline map can pre-download tiles along the route.
enum PlanGeometry {
    /// `[(lat, lon)]` of the planned route for `token`, or nil if there's no cached
    /// plan or it can't be parsed.
    static func polyline(forSession token: String) -> [(lat: Double, lon: Double)]? {
        guard let gz = try? Data(contentsOf: LocalStore.planURL(token)),
              let json = Gzip.inflate(gz),
              let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let track = obj["track"] as? [String: Any],
              let pts = track["points"] as? [[String: Any]] else { return nil }
        let poly: [(lat: Double, lon: Double)] = pts.compactMap { p in
            guard let lat = p["lat"] as? Double, let lon = p["lon"] as? Double else { return nil }
            return (lat, lon)
        }
        return poly.isEmpty ? nil : poly
    }

    /// Route to pre-download tiles along: the planned route if cached, otherwise the
    /// recorded trail (so free-tracking sessions can still cache where they've been).
    static func routePolyline(forSession token: String) -> [(lat: Double, lon: Double)]? {
        if let planned = polyline(forSession: token) { return planned }
        if let data = try? Data(contentsOf: LocalStore.trailURL(token)),
           let arr = try? JSONDecoder().decode([TrailPoint].self, from: data), !arr.isEmpty {
            return arr.map { ($0.lat, $0.lon) }
        }
        return nil
    }
}
