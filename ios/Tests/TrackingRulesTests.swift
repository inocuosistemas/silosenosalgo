import XCTest
@testable import SiLoSeNoSalgo

/// El evento que la baliza propone sola el día de la carrera. Espejo de
/// `TrackingRulesTest` en Android: si las dos apps no coinciden en qué carrera
/// es "la de hoy", la misma persona ve una cosa en cada teléfono.
final class TrackingRulesTests: XCTestCase {

    private let zona = TimeZone(identifier: "Europe/Madrid")!

    private var calendario: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zona
        return c
    }

    /// Una hora local a epoch ms, para escribir los casos en horas de reloj.
    private func cuando(_ dia: String, _ hora: String) -> Double {
        let f = DateFormatter()
        f.calendar = calendario
        f.timeZone = zona
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(dia) \(hora)")!.timeIntervalSince1970 * 1000
    }

    private func evento(_ id: String, salida: Double? = nil, terminado: Bool = false) -> EventSummary {
        EventSummary(
            id: id, name: id, planShareId: nil, planName: nil,
            startsAt: salida, endedAt: terminado ? salida : nil,
            myEmoji: nil, myColor: nil, activity: nil
        )
    }

    private func deHoy(_ eventos: [EventSummary], _ ahora: Double) -> EventSummary? {
        TrackingRules.todaysEvent(
            eventos,
            now: Date(timeIntervalSince1970: ahora / 1000),
            calendar: calendario
        )
    }

    func testLaCarreraDeHoySeProponeSolaYLaDeMananaNo() {
        let hoy = evento("hoy", salida: cuando("2026-09-12", "08:00"))
        let manana = evento("manana", salida: cuando("2026-09-13", "08:00"))
        let ayer = evento("ayer", salida: cuando("2026-09-11", "08:00"))
        XCTAssertEqual(deHoy([ayer, manana, hoy], cuando("2026-09-12", "07:10"))?.id, "hoy")
        // La víspera NO propone nada: abrir la baliza el día antes es para
        // preparar el móvil, no para salir.
        XCTAssertNil(deHoy([hoy], cuando("2026-09-11", "22:00")))
    }

    func testUnaCarreraYaEmpezadaSigueSiendoLaDeHoy() {
        // Llegar tarde a encender la baliza es de lo más normal.
        let ev = evento("ultra", salida: cuando("2026-09-12", "07:00"))
        XCTAssertEqual(deHoy([ev], cuando("2026-09-12", "09:30"))?.id, "ultra")
    }

    func testConDosCarrerasElMismoDiaGanaLaMasCercana() {
        let manana = evento("manana", salida: cuando("2026-09-12", "09:00"))
        let tarde = evento("tarde", salida: cuando("2026-09-12", "18:00"))
        XCTAssertEqual(deHoy([tarde, manana], cuando("2026-09-12", "08:30"))?.id, "manana")
        XCTAssertEqual(deHoy([manana, tarde], cuando("2026-09-12", "16:00"))?.id, "tarde")
    }

    // La cuenta atrás: mismos casos que en Android, para que las dos apps
    // escriban lo mismo. Una que cambia de ancho cada segundo no se puede leer
    // de reojo, que es como se lee.
    private func faltan(_ segundos: Double) -> String? {
        let ahora = Date(timeIntervalSince1970: 1_000_000)
        return TrackingRules.countdown(
            startsAtMs: (1_000_000 + segundos) * 1000, now: ahora
        )
    }

    func testLaCuentaAtrasEscribeSoloLasUnidadesQueHacenFalta() {
        XCTAssertEqual(faltan(2 * 86_400 + 3 * 3_600 + 4 * 60 + 5), "2 d 03 h 04 m 05 s")
        XCTAssertEqual(faltan(3 * 3_600 + 4 * 60 + 5), "3 h 04 m 05 s")
        XCTAssertEqual(faltan(4 * 60 + 5), "4 m 05 s")
        XCTAssertEqual(faltan(5), "5 s")
        XCTAssertEqual(faltan(86_400 + 9), "1 d 00 h 00 m 09 s")
    }

    func testPasadaLaHoraYSinHoraNoHayCuentaAtras() {
        XCTAssertNil(faltan(0))
        XCTAssertNil(faltan(-1))
        XCTAssertNil(TrackingRules.countdown(startsAtMs: nil))
        XCTAssertNil(TrackingRules.countdown(startsAtMs: 0))
    }

    func testNoSeProponeLoQueNoSePuedeCorrer() {
        let ahora = cuando("2026-09-12", "07:10")
        // Terminada por el organizador: ya no admite balizas.
        XCTAssertNil(deHoy([evento("cerrada", salida: cuando("2026-09-12", "06:00"), terminado: true)], ahora))
        // Sin hora no hay nada que heredar, y sin hora tampoco hay "hoy".
        XCTAssertNil(deHoy([evento("sinhora")], ahora))
        XCTAssertNil(deHoy([evento("cero", salida: 0)], ahora))
        XCTAssertNil(deHoy([], ahora))
    }
}
