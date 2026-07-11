import Foundation
import Compression
import CoreLocation

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
    struct NoteMetrics {
        let routeKm: Double?
        let elevationGainM: Double?
    }

    /// `[(lat, lon)]` of the route encoded in a gzipped SharePayload blob.
    static func polyline(fromGzip gz: Data) -> [(lat: Double, lon: Double)]? {
        guard let json = Gzip.inflate(gz),
              let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let track = obj["track"] as? [String: Any],
              let pts = track["points"] as? [[String: Any]] else { return nil }
        let poly: [(lat: Double, lon: Double)] = pts.compactMap { p in
            guard let lat = p["lat"] as? Double, let lon = p["lon"] as? Double else { return nil }
            return (lat, lon)
        }
        return poly.isEmpty ? nil : poly
    }

    /// Planned route for `token` from its cached plan blob, or nil if none.
    static func polyline(forSession token: String) -> [(lat: Double, lon: Double)]? {
        guard let gz = try? Data(contentsOf: LocalStore.planURL(token)) else { return nil }
        return polyline(fromGzip: gz)
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

    /// Route km and accumulated ascent at the nearest planned-route point for
    /// every note. D+ uses the same 1 m hysteresis as the web GPX calculations.
    static func noteMetrics(forSession token: String, notes: [Note]) -> [String: NoteMetrics] {
        guard let gz = try? Data(contentsOf: LocalStore.planURL(token)),
              let json = Gzip.inflate(gz),
              let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let track = obj["track"] as? [String: Any],
              let rawPoints = track["points"] as? [[String: Any]], !rawPoints.isEmpty else {
            return Dictionary(uniqueKeysWithValues: notes.map {
                ($0.id, NoteMetrics(routeKm: $0.trackKm ?? $0.distM.map { $0 / 1000 }, elevationGainM: nil))
            })
        }

        let points = rawPoints.compactMap { p -> (lat: Double, lon: Double, ele: Double)? in
            guard let lat = p["lat"] as? Double,
                  let lon = p["lon"] as? Double,
                  let ele = p["ele"] as? Double else { return nil }
            return (lat, lon, ele)
        }
        guard points.count == rawPoints.count else { return [:] }

        let suppliedKm = track["cumKm"] as? [Double]
        var cumulativeKm = suppliedKm?.count == points.count ? suppliedKm! : [0]
        if cumulativeKm.count != points.count {
            cumulativeKm = [0]
            for i in 1..<points.count {
                let a = CLLocation(latitude: points[i - 1].lat, longitude: points[i - 1].lon)
                let b = CLLocation(latitude: points[i].lat, longitude: points[i].lon)
                cumulativeKm.append(cumulativeKm[i - 1] + a.distance(from: b) / 1000)
            }
        }

        var cumulativeGain = Array(repeating: 0.0, count: points.count)
        var gain = 0.0
        var pending = 0.0
        for i in 1..<points.count {
            let delta = points[i].ele - points[i - 1].ele
            if delta > 0 {
                pending += delta
                if pending >= 1 { gain += pending; pending = 0 }
            } else if delta < 0 {
                pending = 0
            }
            cumulativeGain[i] = gain
        }

        let meanLat = points.reduce(0) { $0 + $1.lat } / Double(points.count)
        let lonScale = cos(meanLat * .pi / 180)
        return Dictionary(uniqueKeysWithValues: notes.map { note in
            var nearest = 0
            var best = Double.greatestFiniteMagnitude
            for (index, point) in points.enumerated() {
                let dLat = point.lat - note.lat
                let dLon = (point.lon - note.lon) * lonScale
                let distance = dLat * dLat + dLon * dLon
                if distance < best { best = distance; nearest = index }
            }
            return (note.id, NoteMetrics(routeKm: cumulativeKm[nearest], elevationGainM: cumulativeGain[nearest]))
        })
    }
}
