import XCTest
@testable import SiLoSeNoSalgo

/// Las reglas de la carrera en directo: de un km y una hora a la tarjeta del
/// tramo. Lo que no sale en ninguna imagen y puede equivocarse en silencio.
final class ReglasDeCarreraTests: XCTestCase {
    /// 20 km: sube 400 m hasta el km 10 y baja 200 hasta meta. El plan prevé
    /// 10 min por km. Un líquido en el 5, un sólido con corte en el 12.
    private let salida = Date(timeIntervalSince1970: 1_800_000_000)
    private var hoja: HojaDeTramos {
        let perfil = stride(from: 0.0, through: 20.0, by: 0.1).map { km in
            HojaDeTramos.Muestra(km: km, ele: km <= 10 ? 1000 + 40 * km : 1400 - 20 * (km - 10))
        }
        let previsto = stride(from: 0.0, through: 20.0, by: 0.5).map { HojaDeTramos.Previsto(km: $0, min: $0 * 10) }
        return HojaDeTramos(
            version: 1, salida: salida.timeIntervalSince1970 * 1000, totalKm: 20,
            perfil: perfil, previsto: previsto,
            puntos: [
                .init(nombre: "Fuente", km: 5, tipo: "liquido", corte: nil),
                .init(nombre: "Refugio", km: 12, tipo: "solido",
                      corte: salida.addingTimeInterval(150 * 60).timeIntervalSince1970 * 1000),
                .init(nombre: "Meta", km: 20, tipo: "meta", corte: nil),
            ])
    }

    func testElTramoEsEntreElUltimoPuntoPasadoYElSiguiente() {
        let a = ReglasDeCarrera.tramo(en: 2, de: hoja)!
        XCTAssertEqual(a.numero, 1)
        XCTAssertEqual(a.desde.nombre, "Salida")
        XCTAssertEqual(a.hasta.nombre, "Fuente")
        XCTAssertEqual(a.hasta.tipo, .liquido)

        let b = ReglasDeCarrera.tramo(en: 7, de: hoja)!
        XCTAssertEqual(b.numero, 2)
        XCTAssertEqual(b.desde.nombre, "Fuente")
        XCTAssertEqual(b.hasta.nombre, "Refugio")

        // Justo pasado el punto, ya es el tramo siguiente.
        XCTAssertEqual(ReglasDeCarrera.tramo(en: 12.1, de: hoja)!.hasta.nombre, "Meta")
    }

    /// Del 7 al 12: sube hasta el 10 (120 m) y baja del 10 al 12 (40 m).
    func testLoQueQuedaPorSubirYBajar() {
        let d = ReglasDeCarrera.desnivel(de: 7, a: 12, hoja)
        XCTAssertEqual(d.sube, 120, accuracy: 2)
        XCTAssertEqual(d.baja, 40, accuracy: 2)
    }

    /// El perfil del tramo viaja en 40 muestras, de punta a punta del tramo.
    func testElPerfilDelTramo() {
        let p = ReglasDeCarrera.perfil(de: 5, a: 12, hoja)
        XCTAssertEqual(p.count, 40)
        XCTAssertEqual(p.first!.km, 5, accuracy: 0.001)
        XCTAssertEqual(p.last!.km, 12, accuracy: 0.001)
        XCTAssertEqual(p.first!.ele, 1200, accuracy: 1)
    }

    /// Sin historia, la previsión es la del plan: del 7 al 12, 50 min.
    func testSinHistoriaSeUsaElPlan() {
        let ahora = salida.addingTimeInterval(70 * 60)
        let p = ReglasDeCarrera.prevision(de: 7, a: 12, ahora: ahora, historia: [], hoja)!
        XCTAssertEqual(p.timeIntervalSince(ahora) / 60, 50, accuracy: 0.5)
    }

    /// Yendo un 20 % más lento que el plan en la última hora, lo que queda
    /// también: 50 min del plan se vuelven 60.
    func testLaPrevisionSigueComoSeEstaRindiendo() {
        let ahora = salida.addingTimeInterval(84 * 60)
        // Hace 60 min iba por el km 2; el plan preveía 50 min para llegar al 7.
        let historia: [(Date, Double)] = [(ahora.addingTimeInterval(-60 * 60), 2)]
        let r = ReglasDeCarrera.rendimiento(ahora: ahora, posicion: 7, historia: historia, hoja)
        XCTAssertEqual(r, 1.2, accuracy: 0.01)
        let p = ReglasDeCarrera.prevision(de: 7, a: 12, ahora: ahora, historia: historia, hoja)!
        XCTAssertEqual(p.timeIntervalSince(ahora) / 60, 60, accuracy: 0.5)
    }

    /// Con poco recorrido la proporción no se fía: una parada de unos minutos
    /// en medio kilómetro no puede doblar la previsión.
    func testConPocoRecorridoNoSeFia() {
        let ahora = salida.addingTimeInterval(20 * 60)
        let historia: [(Date, Double)] = [(ahora.addingTimeInterval(-8 * 60), 1.8)]
        XCTAssertEqual(ReglasDeCarrera.rendimiento(ahora: ahora, posicion: 2, historia: historia, hoja), 1)
    }

    /// El margen al corte: con la previsión del plan, del 7 a las 1:10 se
    /// llega al refugio a las 2:00, y el corte es a las 2:30.
    func testElMargenAlCorte() {
        let d = ReglasDeCarrera.datos(carrera: "Prueba", km: 7, ahora: salida.addingTimeInterval(70 * 60),
                                      historia: [], hoja)!
        XCTAssertEqual(d.margenMin, 30)
        XCTAssertEqual(d.deTramos, 3)
    }

    /// En meta, el reloj se para y no hay corte que mirar.
    func testEnMeta() {
        let ahora = salida.addingTimeInterval(201 * 60)
        let d = ReglasDeCarrera.datos(carrera: "Prueba", km: 19.9, ahora: ahora, historia: [], hoja)!
        XCTAssertTrue(d.enMeta)
        XCTAssertEqual(d.prevision, ahora)
        XCTAssertNil(d.corte)
    }

    /// Cabe en lo que admite el sistema para una Actividad: 4 KB, con las dos
    /// vistas dentro y en el peor caso: nombres largos y muchos puntos.
    func testCabeEnLos4KB() throws {
        let largo = "Refugio de la Collada de los Nombres Muy Largos"
        let muchos = (1...24).map {
            HojaDeTramos.Punto(nombre: "\(largo) \($0)", km: Double($0) * 0.8, tipo: "completo",
                               corte: salida.addingTimeInterval(Double($0) * 1800).timeIntervalSince1970 * 1000)
        } + [.init(nombre: "Meta", km: 20, tipo: "meta", corte: nil)]
        let h = HojaDeTramos(version: 1, salida: hoja.salida, totalKm: 20, perfil: hoja.perfil,
                             previsto: hoja.previsto, puntos: muchos)
        let e = ReglasDeCarrera.estado(carrera: "Ultra Trail de los Nombres Largos 2026", km: 7,
                                       ahora: salida.addingTimeInterval(70 * 60), historia: [],
                                       anterior: nil, h)!
        let bytes = try JSONEncoder().encode(e).count
        XCTAssertLessThan(bytes, 4096, "la tarjeta ocupa \(bytes) bytes")
    }

    /// El perfil viaja compacto y vuelve igual: solo altitudes, con los km
    /// repartidos a lo parejo entre el primero y el último.
    func testElPerfilCompactoVuelveIgual() throws {
        let d = ReglasDeCarrera.datos(carrera: "P", km: 7, ahora: salida, historia: [], hoja)!
        let vuelta = try JSONDecoder().decode(DatosDeTramo.self, from: JSONEncoder().encode(d))
        XCTAssertEqual(vuelta.perfil.count, d.perfil.count)
        for (a, b) in zip(vuelta.perfil, d.perfil) {
            XCTAssertEqual(a.km, b.km, accuracy: 0.002)
            XCTAssertEqual(a.ele, b.ele, accuracy: 0.5)
        }
    }

    /// Antes de la salida, la vista de la carrera; después, la del tramo.
    func testLaVistaCambiaSolaALaHoraDeSalida() {
        let antes = ReglasDeCarrera.estado(carrera: "P", km: 0, ahora: salida.addingTimeInterval(-600),
                                           historia: [], anterior: nil, hoja)!
        XCTAssertEqual(antes.vista, .carrera)
        let despues = ReglasDeCarrera.estado(carrera: "P", km: 0.3, ahora: salida.addingTimeInterval(120),
                                             historia: [], anterior: antes, hoja)!
        XCTAssertEqual(despues.vista, .tramo, "a la hora de salida, sola a la del tramo")
        XCTAssertFalse(despues.vistaElegida)
    }

    /// Pero si quien corre la ha elegido, esa manda.
    func testLaVistaElegidaSeRespeta() {
        var elegida = ReglasDeCarrera.estado(carrera: "P", km: 0, ahora: salida.addingTimeInterval(-600),
                                             historia: [], anterior: nil, hoja)!
        elegida.vista = .carrera
        elegida.vistaElegida = true
        let despues = ReglasDeCarrera.estado(carrera: "P", km: 3, ahora: salida.addingTimeInterval(1800),
                                             historia: [], anterior: elegida, hoja)!
        XCTAssertEqual(despues.vista, .carrera)
        XCTAssertTrue(despues.vistaElegida)
    }

    /// La vista global: lo que queda hasta meta y el próximo corte.
    func testLaVistaGlobal() {
        let g = ReglasDeCarrera.global(km: 7, ahora: salida.addingTimeInterval(70 * 60), historia: [], hoja)
        XCTAssertEqual(g.totalKm, 20)
        XCTAssertEqual(g.perfil.count, ReglasDeCarrera.muestrasGlobales)
        XCTAssertEqual(g.subidaAMetaM, 120, accuracy: 3, "del 7 al 10 sube 120")
        XCTAssertEqual(g.bajadaAMetaM, 200, accuracy: 3, "del 10 a meta baja 200")
        XCTAssertEqual(g.proximoCorte, "Refugio")
        XCTAssertEqual(g.margenMin, 30)
        XCTAssertEqual(g.marcas.count, 2, "la meta no lleva marca")
        // A meta, con el plan: del 7 al 20, 130 min.
        let meta = g.llegadaAMeta!.timeIntervalSince(salida.addingTimeInterval(70 * 60)) / 60
        XCTAssertEqual(meta, 130, accuracy: 1)
    }

    func testSoloSeMandaCuandoSeNota() {
        let t = salida.addingTimeInterval(70 * 60)
        let a = ReglasDeCarrera.datos(carrera: "P", km: 7, ahora: t, historia: [], hoja)!
        XCTAssertTrue(ReglasDeCarrera.mereceMandar(a, despuesDe: nil, ahora: t, ultimoEnvio: nil))
        let poco = ReglasDeCarrera.datos(carrera: "P", km: 7.02, ahora: t.addingTimeInterval(10), historia: [], hoja)!
        XCTAssertFalse(ReglasDeCarrera.mereceMandar(poco, despuesDe: a, ahora: t.addingTimeInterval(10), ultimoEnvio: t))
        let otroTramo = ReglasDeCarrera.datos(carrera: "P", km: 12.2, ahora: t.addingTimeInterval(10), historia: [], hoja)!
        XCTAssertTrue(ReglasDeCarrera.mereceMandar(otroTramo, despuesDe: a, ahora: t.addingTimeInterval(10), ultimoEnvio: t))
        XCTAssertTrue(ReglasDeCarrera.mereceMandar(poco, despuesDe: a, ahora: t.addingTimeInterval(61), ultimoEnvio: t),
                      "cada minuto, para que el margen no se quede viejo")
    }
}
