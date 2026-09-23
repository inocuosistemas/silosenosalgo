import XCTest
@testable import SiLoSeNoSalgo

/// La carrera simulada de la vista previa: que el deslizador de tiempo lleve la
/// tarjeta por toda la carrera y que el ritmo mueva los márgenes.
@MainActor
final class SimulacionDeCarreraTests: XCTestCase {
    private let salida = Date(timeIntervalSince1970: 1_800_000_000)
    private var sim: SimulacionDeCarrera {
        SimulacionDeCarrera(hoja: .ejemplo(salida: salida), carrera: "Prueba")
    }

    func testElHorarioAlReves() {
        let h = HojaDeTramos.ejemplo(salida: salida)
        for km in [0.5, 10.0, 21.3, 41.0] {
            let min = ReglasDeCarrera.previsto(en: km, h)!
            XCTAssertEqual(SimulacionDeCarrera.km(enMinutoDelPlan: min, h), km, accuracy: 0.05)
        }
    }

    func testAntesDeLaSalidaEsLaVistaDeLaCarrera() {
        var s = sim
        s.minuto = -15
        XCTAssertEqual(s.km, 0)
        XCTAssertEqual(s.estado?.vista, .carrera)
    }

    func testEnCarreraEsLaVistaDelTramoYAvanza() {
        var s = sim
        s.minuto = 120
        XCTAssertGreaterThan(s.km, 5)
        XCTAssertEqual(s.estado?.vista, .tramo)
        let antes = s.km
        s.minuto = 240
        XCTAssertGreaterThan(s.km, antes)
    }

    func testAlFinalEstaEnMeta() {
        var s = sim
        s.minuto = s.rango.upperBound
        XCTAssertEqual(s.estado?.tramo.enMeta, true)
    }

    /// A su ritmo se llega a los cortes con margen; muy lento, fuera.
    func testElRitmoMueveElMargenAlCorte() {
        var s = sim
        s.minuto = 90
        XCTAssertGreaterThan(s.estado?.global.margenMin ?? -1, 0, "como el plan, con margen")
        s.ritmo = 1.4
        XCTAssertLessThan(s.estado?.global.margenMin ?? 1, 0, "muy lento, fuera de corte")
    }

    func testLaVistaElegidaManda() {
        var s = sim
        s.minuto = 120
        s.vistaElegida = .corredores
        XCTAssertEqual(s.estado?.vista, .corredores)
        XCTAssertEqual(s.estado?.vistaElegida, true)
    }

    /// Los demás, con las reglas del servidor: el primero, los de alrededor y
    /// la posición.
    func testLosCorredoresSimulados() {
        var s = sim
        s.minuto = 180
        let c = s.corredores
        XCTAssertEqual(c.de, SimulacionDeCarrera.otros.count + 1)
        XCTAssertEqual(c.corredores.first?.nombre, "Aitor")
        XCTAssertTrue(c.corredores.first?.lider ?? false)
        XCTAssertTrue(c.corredores.dropFirst().allSatisfy { abs($0.km - s.km) <= 4 })
        // Yendo más rápido que todos, primero.
        s.ritmo = 0.5
        XCTAssertEqual(s.corredores.posicion, 1)
    }
}
