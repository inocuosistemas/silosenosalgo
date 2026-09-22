import XCTest
import SwiftUI
import CoreLocation
@testable import SiLoSeNoSalgo

/// El aviso del permiso de ubicación, pintado en sus dos casos para mirarlo.
@MainActor
final class AvisoDeUbicacionTests: XCTestCase {
    func testSePintaEnSusDosCasos() throws {
        let vista = VStack(spacing: 16) {
            AvisoDeUbicacion(estado: .authorizedWhenInUse) {}
            AvisoDeUbicacion(estado: .denied) {}
        }
        .padding(16)
        .frame(width: 390)
        .background(Theme.slate900)
        .environment(\.colorScheme, .dark)
        let host = UIHostingController(rootView: vista)
        let tam = host.sizeThatFits(in: CGSize(width: 390, height: 1000))
        host.view.frame = CGRect(origin: .zero, size: tam)
        let v = UIWindow(frame: host.view.frame)
        v.rootViewController = host
        v.isHidden = false
        v.layoutIfNeeded()
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2; fmt.preferredRange = .standard
        let img = UIGraphicsImageRenderer(bounds: host.view.bounds, format: fmt).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let carpeta = ProcessInfo.processInfo.environment["CAPTURAS_VIAJE"] ?? NSTemporaryDirectory()
        try XCTUnwrap(img.pngData()).write(to: URL(fileURLWithPath: carpeta).appendingPathComponent("aviso-ubicacion.png"))
        XCTAssertGreaterThan(tam.height, 100)
    }
}
