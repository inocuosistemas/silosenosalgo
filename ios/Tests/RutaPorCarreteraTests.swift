import XCTest
import CoreLocation
@testable import SiLoSeNoSalgo

/// La ruta por carretera, sin red: rellenar el trazado, situarse sobre él y la
/// forma compacta para la tarjeta.
final class RutaPorCarreteraTests: XCTestCase {
    /// Una «autopista» de 20 km hacia el este con solo tres puntos, y un
    /// giro al norte: como las rutas de Apple en los tramos rectos.
    private let puntos: [(lat: Double, lon: Double)] = [(41.0, 2.0), (41.0, 2.24), (41.1, 2.24)]
    private var ruta: RutaPorCarretera {
        RutaPorCarretera(geometria: Carreteras.rellena(puntos), segundos: 1200, pedida: Date())
    }

    func testRellenaCadaCienMetros() {
        let g = ruta.geometria
        XCTAssertEqual(g.totalKm, 20.1 + 11.1, accuracy: 0.3)
        for i in 1..<g.points.count {
            XCTAssertLessThanOrEqual(g.cumKm[i] - g.cumKm[i - 1], 0.101)
        }
    }

    /// En medio de un tramo recto, lejos de todos los puntos de Apple, se
    /// sigue estando en la ruta.
    func testEnMedioDeUnTramoRectoSeEstaEnLaRuta() throws {
        let km = try XCTUnwrap(Carreteras.km(en: CLLocationCoordinate2D(latitude: 41.0005, longitude: 2.12),
                                             de: ruta, antes: nil))
        XCTAssertEqual(km, 10, accuracy: 0.3)
    }

    func testAvanzaSinSaltosAtras() throws {
        var antes: Double?
        for lon in stride(from: 2.0, through: 2.24, by: 0.02) {
            let km = try XCTUnwrap(Carreteras.km(en: CLLocationCoordinate2D(latitude: 41.0, longitude: lon),
                                                 de: ruta, antes: antes))
            if let a = antes { XCTAssertGreaterThanOrEqual(km, a) }
            antes = km
        }
    }

    func testFueraDeLaRutaEsNil() {
        XCTAssertNil(Carreteras.km(en: CLLocationCoordinate2D(latitude: 41.5, longitude: 2.5), de: ruta, antes: nil))
    }

    func testLaFormaCabeEnLaTarjeta() {
        let f = Carreteras.forma(ruta.geometria)
        XCTAssertLessThanOrEqual(f.count, 120)
        let pts = FormaDeRuta.decodifica(f)
        XCTAssertEqual(pts.count, 40)
        // Girada: del origen, a la izquierda, al destino, a la derecha y a
        // la misma altura; la esquina (al este, luego al norte) queda por
        // debajo de esa línea.
        XCTAssertEqual(pts.first!.x, 0, accuracy: 0.01)
        XCTAssertEqual(pts.last!.x, pts.map(\.x).max()!, accuracy: 0.01)
        XCTAssertEqual(pts.first!.y, pts.last!.y, accuracy: 0.01)
        XCTAssertGreaterThan(pts[20].y, pts.last!.y)
    }

    func testQueTransporteVaPorCarretera() {
        XCTAssertEqual(Carreteras.tipo(.coche), .automobile)
        XCTAssertEqual(Carreteras.tipo(.andando), .walking)
        XCTAssertNil(Carreteras.tipo(.avion))
    }
}

/// Lo que enseña la tarjeta yendo por carretera.
final class ReglasDeViajePorCarreteraTests: XCTestCase {
    private let a = ViajeAtributos(
        origen: LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.3874, longitud: 2.1686),
        destino: LugarDeViaje(nombre: "Andorra la Vella", abreviatura: "AND", latitud: 42.5063, longitud: 1.5218),
        transporte: .coche)
    private let ahora = Date(timeIntervalSince1970: 1_800_000_000)

    func testLosKmSonLosDeLaRuta() {
        let pos = CLLocation(latitude: 41.8, longitude: 1.9)
        let llegada = ahora.addingTimeInterval(5400)
        let e = ReglasDeViaje.estado(en: pos, de: a, ruta: .init(km: 80, total: 192, forma: "AAA=", llegada: llegada),
                                     ahora: ahora)
        XCTAssertEqual(e.restanteKm, 112, accuracy: 0.01)
        XCTAssertEqual(e.progreso, 80.0 / 192, accuracy: 0.001)
        XCTAssertEqual(e.llegada, llegada, "la hora de Apple, con tráfico")
        XCTAssertTrue(e.porRuta)
        XCTAssertFalse(e.llegado)
    }

    /// Sin la hora de Apple (sin red), la de la velocidad, sobre lo que falta
    /// de ruta y no en línea recta.
    func testSinTraficoLaHoraSaleDeLaVelocidad() {
        let pos = CLLocation(coordinate: CLLocationCoordinate2D(latitude: 41.8, longitude: 1.9), altitude: 0,
                             horizontalAccuracy: 10, verticalAccuracy: 10, course: 0, speed: 25,
                             timestamp: ahora)
        let e = ReglasDeViaje.estado(en: pos, de: a, ruta: .init(km: 102, total: 192, forma: "AAA="), ahora: ahora)
        XCTAssertEqual(e.llegada!.timeIntervalSince(ahora), 90_000 / 25, accuracy: 1)
    }

    /// Llegado, por cercanía al destino marcado, aunque a la ruta le falte un
    /// trozo (acaba en la calle más cercana).
    func testLlegadoCercaDelDestino() {
        let pos = CLLocation(latitude: 42.5060, longitude: 1.5215)
        let e = ReglasDeViaje.estado(en: pos, de: a, ruta: .init(km: 190, total: 192, forma: "AAA="), ahora: ahora)
        XCTAssertTrue(e.llegado)
        XCTAssertEqual(e.progreso, 1)
        XCTAssertEqual(e.restanteKm, 0)
    }

    /// Cuando llega la ruta (o cambia), se manda aunque no se haya movido.
    func testLaRutaNuevaSeManda() {
        let viejo = ViajeAtributos.ContentState(restanteKm: 100, progreso: 0.5, actualizado: ahora)
        var nuevo = viejo
        nuevo.forma = "AAA="
        XCTAssertTrue(ReglasDeViaje.mereceMandar(nuevo, despuesDe: viejo, totalKm: 192))
    }

    /// Un estado guardado de antes de la ruta (sin `forma`) se sigue leyendo.
    func testElEstadoDeAntesSeLee() throws {
        let json = #"{"restanteKm":10,"progreso":0.5,"llegado":false,"actualizado":0}"#
        let e = try JSONDecoder().decode(ViajeAtributos.ContentState.self, from: Data(json.utf8))
        XCTAssertNil(e.forma)
        XCTAssertFalse(e.porRuta)
    }
}
