import XCTest
@testable import SiLoSeNoSalgo

/// Las horas de «Preparar la carrera»: el aviso, el recordatorio, y que una
/// preparación vieja no se quede para siempre.
final class PreparacionDeCarreraTests: XCTestCase {
    override func setUp() { PreparacionDeCarrera.olvida() }
    override func tearDown() { PreparacionDeCarrera.olvida() }

    func testElAvisoYElRecordatorio() {
        let salida = Date().addingTimeInterval(20 * 3600)
        let p = PreparacionDeCarrera(eventoId: "e", nombre: "X", salida: salida, avisoMin: 60)
        XCTAssertEqual(p.avisoA, salida.addingTimeInterval(-3600))
        XCTAssertEqual(p.recordatorioA, salida.addingTimeInterval(-600))
    }

    func testPorDefectoUnaHora() {
        UserDefaults.standard.removeObject(forKey: "carrera.avisoMin")
        XCTAssertEqual(PreparacionDeCarrera.avisoElegido, 60)
    }

    func testSeGuardaYSeRecuerdaElAviso() {
        let p = PreparacionDeCarrera(eventoId: "e1", nombre: "X", salida: Date().addingTimeInterval(86_400), avisoMin: 90)
        p.guarda()
        XCTAssertEqual(PreparacionDeCarrera.de(evento: "e1"), p)
        XCTAssertNil(PreparacionDeCarrera.de(evento: "otra"))
        XCTAssertEqual(PreparacionDeCarrera.avisoElegido, 90)
    }

    /// De una salida de hace más de seis horas ya no queda nada.
    func testUnaViejaSeOlvida() {
        PreparacionDeCarrera(eventoId: "e1", nombre: "X", salida: Date().addingTimeInterval(-7 * 3600), avisoMin: 60).guarda()
        XCTAssertNil(PreparacionDeCarrera.lee())
    }
}
