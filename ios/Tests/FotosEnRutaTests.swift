import XCTest
import CoreLocation
import ImageIO
import UniformTypeIdentifiers
@testable import SiLoSeNoSalgo

/// Dónde va cada foto en una salida terminada: por la hora, por su GPS o a
/// mano. Es lo que decide que la foto de la cima no acabe en el aparcamiento.
final class FotosEnRutaTests: XCTestCase {
    /// Un trazado recto hacia el norte: un punto por minuto, unos 111 m entre
    /// cada dos (0,001° de latitud), empezando a las 10:00.
    private let inicio: Double = 1_790_000_000_000
    private lazy var trail: [TrailPoint] = (0...60).map {
        TrailPoint(t: inicio + Double($0) * 60_000, lat: 42.0 + Double($0) * 0.001, lon: 1.0, a: 5)
    }
    private lazy var acum = ColocaFotos.acumulado(trail)

    func testPorLaHoraCaeEntreLosDosPuntos() throws {
        // A las 10:10:30, entre el punto 10 y el 11.
        let s = try XCTUnwrap(ColocaFotos.porHora(inicio + 10.5 * 60_000, trail, acum))
        XCTAssertEqual(s.lat, 42.0105, accuracy: 1e-6)
        XCTAssertEqual(s.distM, acum[10] + (acum[11] - acum[10]) / 2, accuracy: 0.01)
        XCTAssertEqual(s.modo, .porHora)
    }

    func testAntesDeSalirVaAlPrincipioYMuchoAntesNoVa() {
        let justoAntes = ColocaFotos.porHora(inicio - 5 * 60_000, trail, acum)
        XCTAssertEqual(justoAntes?.distM, 0)
        XCTAssertEqual(justoAntes?.lat, 42.0)
        XCTAssertNil(ColocaFotos.porHora(inicio - 3_600_000, trail, acum), "una foto de una hora antes no es de la salida")
        XCTAssertNil(ColocaFotos.porHora(inicio + 3 * 3_600_000, trail, acum))
    }

    func testConHoraYGPSDeAcuerdoMandaLaHora() throws {
        let gps = CLLocationCoordinate2D(latitude: 42.0201, longitude: 1.0005) // ~45 m del punto 20
        let s = try XCTUnwrap(ColocaFotos.coloca(fecha: inicio + 20 * 60_000, gps: gps, trail, acum))
        XCTAssertEqual(s.modo, .porHora)
        XCTAssertEqual(s.lat, 42.02, accuracy: 1e-9)
    }

    func testSiElGPSEstaLejosDeLaHoraMandaElGPS() throws {
        // La cámara tenía el reloj mal: la hora dice punto 5, el GPS dice punto 50.
        let gps = CLLocationCoordinate2D(latitude: 42.05, longitude: 1.0)
        let s = try XCTUnwrap(ColocaFotos.coloca(fecha: inicio + 5 * 60_000, gps: gps, trail, acum))
        XCTAssertEqual(s.modo, .porGPS)
        XCTAssertEqual(s.distM, acum[50], accuracy: 0.01)
        XCTAssertEqual(s.t, trail[50].t)
    }

    func testSinHoraDentroSeUsaElGPS() throws {
        let gps = CLLocationCoordinate2D(latitude: 42.0302, longitude: 1.0)
        let s = try XCTUnwrap(ColocaFotos.coloca(fecha: inicio - 86_400_000, gps: gps, trail, acum))
        XCTAssertEqual(s.modo, .porGPS)
        XCTAssertEqual(s.lat, 42.0302, accuracy: 1e-9, "el GPS de la foto se respeta, no se pega al trazado")
        XCTAssertEqual(s.distM, acum[30], accuracy: 0.01)
    }

    func testSinNadaNoSeColoca() {
        XCTAssertNil(ColocaFotos.coloca(fecha: nil, gps: nil, trail, acum))
    }

    func testAManoSePegaAlTrazado() throws {
        let s = try XCTUnwrap(ColocaFotos.aMano(lat: 42.0403, lon: 1.002, trail, acum))
        XCTAssertEqual(s.lat, trail[40].lat)
        XCTAssertEqual(s.lon, 1.0)
        XCTAssertEqual(s.modo, .aMano)
        XCTAssertEqual(s.t, trail[40].t)
    }

    func testLosMetrosNoSumanElTembleoParado() {
        // Cinco puntos a un metro unos de otros con 20 m de precisión: parado.
        let quieto = (0..<5).map { TrailPoint(t: Double($0) * 1000, lat: 42 + Double($0) * 0.00001, lon: 1, a: 20) }
        XCTAssertEqual(ColocaFotos.acumulado(quieto).last ?? -1, 0, accuracy: 0.001)
        XCTAssertEqual(acum.last ?? 0, TrackingRules.trailDistanceMeters(trail), accuracy: 0.01)
    }

    func testLasYaAnadidasSeReconocen() {
        let m: Double = 60_000
        let fotos: [(id: String, t: Double)] = [
            ("a", 0), ("b", 10 * m), ("c", 20 * m), ("d", 20 * m + 30_000), ("e", 40 * m), ("f", 50 * m),
        ]
        let notas: [(createdAt: Double, fixAt: Double?)] = [
            // Añadida desde aquí, por la hora: su createdAt es la hora de la foto.
            (10 * m + 400, nil),
            // Añadida desde aquí por el GPS: createdAt del trazado, fixAt la de la foto.
            (33 * m, 40 * m),
            // Hecha en marcha: guardada 50 s después de la foto «d»; «c» también
            // cae en la ventana, pero solo cuenta la última.
            (21 * m + 20_000, nil),
            // Guardada sin foto reciente en el carrete (se eligió una vieja): nada.
            (70 * m, nil),
        ]
        XCTAssertEqual(ColocaFotos.yaAnadidas(fotos, notas: notas), ["b", "e", "d"])
    }

    func testLaFechaDelEXIFConYSinDesfase() throws {
        let conDesfase = try XCTUnwrap(ColocaFotos.fechaExif("2026:09:20 10:42:07", desfase: "+02:00"))
        XCTAssertEqual(conDesfase.timeIntervalSince1970, 1_789_893_727, accuracy: 0.5)
        let madrid = TimeZone(identifier: "Europe/Madrid")!
        let sinDesfase = try XCTUnwrap(ColocaFotos.fechaExif("2026:09:20 10:42:07", desfase: nil, zona: madrid))
        XCTAssertEqual(sinDesfase, conDesfase)
        XCTAssertNil(ColocaFotos.fechaExif("ayer", desfase: nil))
    }

    func testLeeLaHoraYElGPSDeUnJPEG() throws {
        let datos = try jpeg(fecha: "2026:09:20 10:42:07", desfase: "+02:00", lat: 42.5, latRef: "N", lon: 1.25, lonRef: "W")
        let m = ColocaFotos.metadatos(datos)
        XCTAssertEqual(m.fecha?.timeIntervalSince1970 ?? 0, 1_789_893_727, accuracy: 0.5)
        XCTAssertEqual(m.gps?.latitude ?? 0, 42.5, accuracy: 1e-6)
        XCTAssertEqual(m.gps?.longitude ?? 0, -1.25, accuracy: 1e-6, "oeste es negativo")
    }

    func testUnaFotoSinNadaDentro() throws {
        let m = ColocaFotos.metadatos(try jpeg())
        XCTAssertNil(m.fecha)
        XCTAssertNil(m.gps)
    }

    /// Un JPEG diminuto con los metadatos que se le pidan.
    private func jpeg(fecha: String? = nil, desfase: String? = nil,
                      lat: Double? = nil, latRef: String = "N", lon: Double? = nil, lonRef: String = "E") throws -> Data {
        let img = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { c in
            UIColor.red.setFill(); c.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        let cg = try XCTUnwrap(img.cgImage)
        let salida = NSMutableData()
        let dest = try XCTUnwrap(CGImageDestinationCreateWithData(salida, UTType.jpeg.identifier as CFString, 1, nil))
        var props: [CFString: Any] = [:]
        if let fecha {
            var exif: [CFString: Any] = [kCGImagePropertyExifDateTimeOriginal: fecha]
            if let desfase { exif[kCGImagePropertyExifOffsetTimeOriginal] = desfase }
            props[kCGImagePropertyExifDictionary] = exif
        }
        if let lat, let lon {
            props[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: lat, kCGImagePropertyGPSLatitudeRef: latRef,
                kCGImagePropertyGPSLongitude: lon, kCGImagePropertyGPSLongitudeRef: lonRef,
            ] as [CFString: Any]
        }
        CGImageDestinationAddImage(dest, cg, props as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        return salida as Data
    }
}
