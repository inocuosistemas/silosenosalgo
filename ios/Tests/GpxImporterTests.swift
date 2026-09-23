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

    /// La hoja de tramos de una carrera, con el mismo visor: se lee un GPX
    /// y de su ruta se saca la hoja, como hace la baliza al empezar. El
    /// avituallamiento cierra tramo, y la meta se añade sola.
    func testLaHojaDeTramosSaleDeLaWeb() async throws {
        let conAvituallamiento = gpx.replacingOccurrences(
            of: "<wpt lat=\"42.7010\" lon=\"-0.5190\"><name>Fuente</name></wpt>",
            with: "<wpt lat=\"42.7050\" lon=\"-0.5150\"><name>Avituallamiento Fuente</name><type>Water</type></wpt>")
        let web = GpxImporter()
        defer { web.suelta() }
        let ruta = try await web.convierte(texto: conAvituallamiento, fichero: "subida.gpx", actividad: "walk")
        let salida = 1_800_000_000_000.0
        let datos = try await web.hojaDeTramos(planGz: ruta.cuerpo, ajustes: nil, salidaMs: salida)
        let hoja = try JSONDecoder().decode(HojaDeTramos.self, from: datos)
        XCTAssertEqual(hoja.salida, salida, "se mide desde la salida oficial")
        XCTAssertEqual(hoja.totalKm, ruta.distanciaKm, accuracy: 0.01)
        XCTAssertEqual(hoja.puntos.last?.tipo, "meta", "la meta cierra el último tramo")
        XCTAssertTrue(hoja.puntos.contains { $0.nombre.contains("Fuente") },
                      "el avituallamiento cierra tramo: \(hoja.puntos.map(\.nombre))")
        XCTAssertGreaterThan(hoja.perfil.count, 100)
        XCTAssertEqual(hoja.perfil.last?.ele ?? 0, 1340, accuracy: 5)
        XCTAssertGreaterThan(hoja.previsto.last?.min ?? 0, 0, "el plan prevé algo de tiempo")
    }
}
