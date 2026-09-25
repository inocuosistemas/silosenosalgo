import XCTest
import ImageIO
import CoreLocation
@testable import SiLoSeNoSalgo

/// La foto de la cámara de la app, tal como va al carrete: con los datos de la
/// cámara, la hora del disparo y la ubicación de la baliza.
final class FotoAlCarreteTests: XCTestCase {
    private func imagen() -> CGImage {
        UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30)).image { c in
            UIColor.orange.setFill(); c.fill(CGRect(x: 0, y: 0, width: 40, height: 30))
        }.cgImage!
    }

    func testLlevaLaUbicacionLaHoraYLaOrientacionDeLaCamara() throws {
        let camara: [String: Any] = [
            kCGImagePropertyOrientation as String: 6,
            kCGImagePropertyExifDictionary as String: [
                kCGImagePropertyExifDateTimeOriginal as String: "2026:09:25 10:42:07",
                kCGImagePropertyExifOffsetTimeOriginal as String: "+02:00",
            ],
        ]
        let aqui = CLLocation(coordinate: CLLocationCoordinate2D(latitude: 41.0369, longitude: -3.705),
                              altitude: 650, horizontalAccuracy: 8, verticalAccuracy: 5, timestamp: Date())
        let (datos, _) = try XCTUnwrap(PhotoLibrarySaver.fotoParaElCarrete(imagen(), metadatos: camara, ubicacion: aqui, fecha: Date()))
        let fuente = try XCTUnwrap(CGImageSourceCreateWithData(datos as CFData, nil))
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(fuente, 0, nil) as? [CFString: Any])
        XCTAssertEqual(props[kCGImagePropertyOrientation] as? Int, 6, "la orientación de la cámara se conserva")
        // Lo que lee «Añadir fotos» de ella: su hora y su sitio.
        let m = ColocaFotos.metadatos(datos)
        XCTAssertEqual(m.fecha?.timeIntervalSince1970 ?? 0, 1_790_325_727, accuracy: 0.5)
        XCTAssertEqual(m.gps?.latitude ?? 0, 41.0369, accuracy: 1e-5)
        XCTAssertEqual(m.gps?.longitude ?? 0, -3.705, accuracy: 1e-5, "oeste, negativo")
    }

    func testSinUbicacionNiHoraDeLaCamaraPoneLaDelDisparo() throws {
        let fecha = Date(timeIntervalSince1970: 1_790_000_000)
        let (datos, _) = try XCTUnwrap(PhotoLibrarySaver.fotoParaElCarrete(imagen(), metadatos: [:], ubicacion: nil, fecha: fecha))
        let m = ColocaFotos.metadatos(datos)
        XCTAssertEqual(m.fecha?.timeIntervalSince1970 ?? 0, 1_790_000_000, accuracy: 1)
        XCTAssertNil(m.gps)
    }
}
