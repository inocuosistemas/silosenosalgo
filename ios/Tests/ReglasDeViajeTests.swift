import XCTest
import CoreLocation
@testable import SiLoSeNoSalgo

/// Las reglas del viaje en directo: de una posición a la tarjeta, y cuándo
/// mandarla. Es lo que no se ve en ninguna imagen y puede salir mal en silencio.
final class ReglasDeViajeTests: XCTestCase {
    private let mad = LugarDeViaje(nombre: "Madrid", abreviatura: "MAD", latitud: 40.4168, longitud: -3.7038)
    private let bcn = LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.3874, longitud: 2.1686)
    private var viaje: ViajeAtributos { ViajeAtributos(origen: mad, destino: bcn, transporte: .avion) }

    private func pos(_ lat: Double, _ lon: Double, velocidad: Double = -1) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                   altitude: 0, horizontalAccuracy: 50, verticalAccuracy: 50,
                   course: 0, speed: velocidad, timestamp: Date())
    }

    func testEnElOrigenNoSeHaHechoNada() {
        let e = ReglasDeViaje.estado(en: pos(mad.latitud, mad.longitud), de: viaje)
        XCTAssertEqual(e.progreso, 0, accuracy: 0.001)
        XCTAssertEqual(e.restanteKm, viaje.totalKm, accuracy: 0.5)
        XCTAssertFalse(e.llegado)
    }

    /// Zaragoza está más o menos a mitad de camino.
    func testAMitadDeCamino() {
        let e = ReglasDeViaje.estado(en: pos(41.6488, -0.8891), de: viaje)
        XCTAssertEqual(e.progreso, 0.5, accuracy: 0.12)
        XCTAssertFalse(e.llegado)
    }

    /// El aeropuerto de El Prat está a unos 12 km del centro: eso no es haber
    /// llegado. A 1 km, sí.
    func testSeLlegaCercaDelDestinoNoAntes() {
        let prat = ReglasDeViaje.estado(en: pos(41.2974, 2.0833), de: viaje)
        XCTAssertFalse(prat.llegado, "a 12 km todavía no se ha llegado")
        let casi = ReglasDeViaje.estado(en: pos(41.3874, 2.1806), de: viaje)
        XCTAssertTrue(casi.llegado)
        XCTAssertEqual(casi.progreso, 1)
        XCTAssertNil(casi.llegada, "llegado, ya no hay hora de llegada que dar")
    }

    /// En un trayecto corto el radio de llegada encoge: andando 5 km no se puede
    /// dar por llegado a los 3.
    func testElRadioDeLlegadaDependeDelViaje() {
        XCTAssertEqual(ReglasDeViaje.radioDeLlegada(totalKm: 10_000), 2)
        XCTAssertEqual(ReglasDeViaje.radioDeLlegada(totalKm: 5), 0.1, accuracy: 0.001)
        XCTAssertEqual(ReglasDeViaje.radioDeLlegada(totalKm: 50), 1, accuracy: 0.001)
    }

    func testLaHoraDeLlegadaSaleDeLaVelocidad() {
        let ahora = Date()
        // 900 km a 250 m/s (900 km/h): una hora.
        let h = ReglasDeViaje.llegada(restanteKm: 900, velocidad: 250, ahora: ahora)
        XCTAssertEqual(h?.timeIntervalSince(ahora) ?? 0, 3600, accuracy: 1)
        XCTAssertNil(ReglasDeViaje.llegada(restanteKm: 900, velocidad: -1, ahora: ahora), "sin velocidad, nada")
        XCTAssertNil(ReglasDeViaje.llegada(restanteKm: 900, velocidad: 0.5, ahora: ahora), "parado, nada")
        // Rodando por la pista a 30 km/h con 10.000 km por delante: dos semanas.
        XCTAssertNil(ReglasDeViaje.llegada(restanteKm: 10_000, velocidad: 8, ahora: ahora),
                     "una llegada a más de un día no se enseña")
    }

    func testSoloSeMandaCuandoSeNota() {
        let t = Date()
        let a = ViajeAtributos.ContentState(restanteKm: 500, progreso: 0, actualizado: t)
        XCTAssertTrue(ReglasDeViaje.mereceMandar(a, despuesDe: nil, totalKm: 505), "la primera, siempre")

        let poco = ViajeAtributos.ContentState(restanteKm: 499.8, progreso: 0, actualizado: t.addingTimeInterval(10))
        XCTAssertFalse(ReglasDeViaje.mereceMandar(poco, despuesDe: a, totalKm: 505),
                       "200 m en 505 km no se ven en la barra")

        let bastante = ViajeAtributos.ContentState(restanteKm: 499, progreso: 0, actualizado: t.addingTimeInterval(10))
        XCTAssertTrue(ReglasDeViaje.mereceMandar(bastante, despuesDe: a, totalKm: 505))

        let unMinuto = ViajeAtributos.ContentState(restanteKm: 499.9, progreso: 0, actualizado: t.addingTimeInterval(61))
        XCTAssertTrue(ReglasDeViaje.mereceMandar(unMinuto, despuesDe: a, totalKm: 505),
                      "cada minuto, aunque no se mueva, para que la hora no se quede vieja")

        let llegado = ViajeAtributos.ContentState(restanteKm: 499.9, progreso: 1, llegado: true, actualizado: t.addingTimeInterval(1))
        XCTAssertTrue(ReglasDeViaje.mereceMandar(llegado, despuesDe: a, totalKm: 505), "llegar se manda siempre")
    }

    /// El texto se pone solo: claro sobre fondo oscuro, oscuro sobre claro.
    func testElTextoSeLeeSobreCualquierFondo() {
        XCTAssertLessThan(PinturaDeViaje.luminancia("#0f1729"), 0.5)
        XCTAssertGreaterThan(PinturaDeViaje.luminancia("#fef3c7"), 0.5)
        XCTAssertGreaterThan(PinturaDeViaje.luminancia("#ffffff"), PinturaDeViaje.luminancia("#0000ff"))
        // El amarillo puro es claro aunque el azul puro no lo sea: el verde pesa más.
        XCTAssertGreaterThan(PinturaDeViaje.luminancia("#ffff00"), 0.5)
        XCTAssertLessThan(PinturaDeViaje.luminancia("#0000ff"), 0.5)
    }

    func testLaAbreviaturaPropuesta() {
        XCTAssertEqual(BuscadorDeLugares.abreviatura(de: "Málaga"), "MAL")
        XCTAssertEqual(BuscadorDeLugares.abreviatura(de: "Tokio"), "TOK")
        XCTAssertEqual(BuscadorDeLugares.abreviatura(de: "A Coruña"), "ACO")
    }
}

/// La configuración del viaje se guarda y se vuelve a leer igual: al salir de
/// la pantalla y entrar otra vez estaba todo vacío.
final class BorradorDeViajeTests: XCTestCase {
    func testLoQueSeConfiguraSeVuelveALeerIgual() throws {
        let d = try XCTUnwrap(UserDefaults(suiteName: "prueba-borrador-viaje"))
        defer { d.removePersistentDomain(forName: "prueba-borrador-viaje") }
        XCTAssertNil(BorradorDeViaje.lee(de: d), "sin nada guardado, nada")

        let b = BorradorDeViaje(
            titulo: "Viaje a Japón",
            origen: LugarDeViaje(nombre: "Aeropuerto de Barcelona-El Prat", abreviatura: "BCN", latitud: 41.2886, longitud: 2.0743),
            destino: LugarDeViaje(nombre: "Tokio", abreviatura: "NRT", latitud: 35.7633, longitud: 140.3829),
            transporte: .avion,
            colores: ColoresDeViaje(fondo: "#3b0764", trayecto: "#f472b6", trayecto2: "#f59e0b"),
            conHora: true, hora: Date(timeIntervalSince1970: 1_800_000_000))
        b.guarda(en: d)
        XCTAssertEqual(BorradorDeViaje.lee(de: d), b)
    }
}
