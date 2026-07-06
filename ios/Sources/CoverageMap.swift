import SwiftUI
import MapKit
import UIKit

/// A small preview map for the offline-map screen: draws the planned route and
/// shades, in green, the areas whose tiles are already in the local cache — a
/// visual "what's downloaded" layer. Reads only from disk; never fetches.
struct CoverageMap: UIViewRepresentable {
    let polyline: [(lat: Double, lon: Double)]
    /// Cached coverage tiles (from `TileCache.cachedCoverage`), drawn as squares.
    let coverage: [TileKey]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.pointOfInterestFilter = .excludingAll
        map.overrideUserInterfaceStyle = .dark
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.removeOverlays(map.overlays)

        // Green coverage squares (drawn under the route).
        for t in coverage {
            let b = TileCache.tileBounds(t.z, t.x, t.y)
            let corners = [
                CLLocationCoordinate2D(latitude: b.minLat, longitude: b.minLon),
                CLLocationCoordinate2D(latitude: b.minLat, longitude: b.maxLon),
                CLLocationCoordinate2D(latitude: b.maxLat, longitude: b.maxLon),
                CLLocationCoordinate2D(latitude: b.maxLat, longitude: b.minLon),
            ]
            let poly = MKPolygon(coordinates: corners, count: corners.count)
            poly.title = "coverage"
            map.addOverlay(poly, level: .aboveRoads)
        }

        // The route line, on top.
        if polyline.count >= 2 {
            let coords = polyline.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
            let line = MKPolyline(coordinates: coords, count: coords.count)
            line.title = "route"
            map.addOverlay(line, level: .aboveLabels)
            // Fit the route once.
            if !context.coordinator.didFit {
                context.coordinator.didFit = true
                map.setVisibleMapRect(line.boundingMapRect,
                                      edgePadding: UIEdgeInsets(top: 24, left: 24, bottom: 24, right: 24),
                                      animated: false)
            }
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var didFit = false

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let poly = overlay as? MKPolygon, poly.title == "coverage" {
                let r = MKPolygonRenderer(polygon: poly)
                r.fillColor = UIColor(red: 0.13, green: 0.77, blue: 0.37, alpha: 0.28) // emerald, translucent
                r.strokeColor = UIColor(red: 0.13, green: 0.77, blue: 0.37, alpha: 0.5)
                r.lineWidth = 0.5
                return r
            }
            if let line = overlay as? MKPolyline {
                let r = MKPolylineRenderer(polyline: line)
                r.strokeColor = UIColor(red: 0.055, green: 0.647, blue: 0.914, alpha: 0.95) // sky-500
                r.lineWidth = 3
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }
    }
}
