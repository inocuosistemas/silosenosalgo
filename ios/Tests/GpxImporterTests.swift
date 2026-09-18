import XCTest
@testable import SiLoSeNoSalgo

/// El puente de verdad: visor oculto, esquema propio de la app y el conversor
/// de la web empaquetada. Si algo de eso se rompe, cargar un GPX desde la
/// baliza se rompe, y sin un iPhone a mano esta es la única forma de verlo.
@MainActor
final class GpxImporterTests: XCTestCase {
    private let gpx = """
    <?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1" creator="prueba" xmlns="http://www.topografix.com/GPX/1/1">
      <wpt lat="42.7010" lon="-0.5190"><name>Fuente</name></wpt>
      <trk><name>Subida de prueba</name><trkseg>
        <trkpt lat="42.7000" lon="-0.5200"><ele>1200</ele></trkpt>
        <trkpt lat="42.7050" lon="-0.5150"><ele>1260</ele></trkpt>
        <trkpt lat="42.7100" lon="-0.5100"><ele>1340</ele></trkpt>
      </trkseg></trk>
    </gpx>
    """

    func testConvierteUnGpxEnRutaConElCodigoDeLaWeb() async throws {
        let ruta = try await GpxImporter().convierte(texto: gpx, fichero: "subida.gpx", actividad: "walk")
        XCTAssertEqual(ruta.nombre, "Subida de prueba")
        XCTAssertEqual(ruta.distanciaKm, 1.36, accuracy: 0.1)
        XCTAssertGreaterThan(ruta.desnivelM, 100)
        // Lo que se subiría: gzip de verdad.
        XCTAssertEqual(Array(ruta.cuerpo.prefix(2)), [0x1f, 0x8b], "no es gzip")
    }

    func testUnFicheroQueNoEsGpxSeRechazaConSuMensaje() async {
        do {
            _ = try await GpxImporter().convierte(texto: "<gpx></gpx>", fichero: "vacio.gpx", actividad: nil)
            XCTFail("aceptó un GPX sin puntos")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("puntos"), error.localizedDescription)
        }
    }
}
