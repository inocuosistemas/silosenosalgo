import XCTest
@testable import SiLoSeNoSalgo

/// Lo que el widget no puede enseñar mal: qué fecha cuenta y cuándo un
/// contador deja de tener algo que decir.
final class ContadoresTests: XCTestCase {
    private func fecha(_ año: Int, _ mes: Int, _ dia: Int, _ hora: Int = 8) -> Date {
        var c = DateComponents()
        c.year = año; c.month = mes; c.day = dia; c.hour = hora
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal.date(from: c)!
    }

    func testLaFechaDeUnoNormalNoSeMueve() {
        let c = Contador(nombre: "Viaje", fecha: fecha(2026, 10, 3))
        XCTAssertEqual(c.fechaVigente(desde: fecha(2026, 9, 20)), fecha(2026, 10, 3))
        // Aunque haya pasado: sin "cada año", su fecha es la suya.
        XCTAssertEqual(c.fechaVigente(desde: fecha(2027, 1, 1)), fecha(2026, 10, 3))
    }

    func testElAnualSaltaAlAñoQueViene() {
        let c = Contador(nombre: "La de siempre", fecha: fecha(2026, 10, 3), anual: true)
        XCTAssertEqual(c.fechaVigente(desde: fecha(2026, 9, 20)), fecha(2026, 10, 3))
        XCTAssertEqual(c.fechaVigente(desde: fecha(2026, 10, 4)), fecha(2027, 10, 3))
        XCTAssertEqual(c.fechaVigente(desde: fecha(2028, 1, 1)), fecha(2028, 10, 3))
    }

    func testAlPasarDecideSiSigueEnElWidget() {
        let ayer = Date().addingTimeInterval(-3600)
        XCTAssertFalse(Contador(nombre: "Pasada", fecha: ayer, alPasar: .ocultar).vigente())
        // La carrera del día no desaparece: cuenta el tiempo desde la salida.
        XCTAssertTrue(Contador(nombre: "Corriendo", fecha: ayer, alPasar: .contarArriba).vigente())
        XCTAssertTrue(Contador(nombre: "Por venir", fecha: Date().addingTimeInterval(3600)).vigente())
    }

    /// El widget en automático: la siguiente por llegar, y no la carrera de
    /// hoy que ya cuenta hacia arriba (se ponía delante y el widget se quedaba
    /// en ella). Sin ninguna por llegar, la que siga contando.
    func testLaSiguienteQueVence() {
        let ahora = Date()
        let hoy = Contador(nombre: "Hoy", fecha: ahora.addingTimeInterval(-3600), alPasar: .contarArriba)
        let luego = Contador(nombre: "Luego", fecha: ahora.addingTimeInterval(10 * 86_400))
        let despues = Contador(nombre: "Después", fecha: ahora.addingTimeInterval(40 * 86_400))
        AlmacenContadores.guarda([despues, hoy, luego])
        defer { AlmacenContadores.guarda([]) }
        XCTAssertEqual(AlmacenContadores.siguiente(ahora)?.nombre, "Luego")
        AlmacenContadores.guarda([hoy])
        XCTAssertEqual(AlmacenContadores.siguiente(ahora)?.nombre, "Hoy")
    }

    func testSeGuardanYSalenElMasCercanoPrimero() {
        let lejos = Contador(id: "a", nombre: "Lejos", fecha: Date().addingTimeInterval(20 * 86_400))
        let cerca = Contador(id: "b", nombre: "Cerca", fecha: Date().addingTimeInterval(2 * 86_400))
        let pasada = Contador(id: "c", nombre: "Pasada", fecha: Date().addingTimeInterval(-86_400), alPasar: .ocultar)
        AlmacenContadores.guarda([lejos, cerca, pasada])
        defer { AlmacenContadores.guarda([]) }

        XCTAssertEqual(AlmacenContadores.lee().contadores.count, 3)
        XCTAssertEqual(AlmacenContadores.vigentes().map(\.id), ["b", "a"])
    }
}
