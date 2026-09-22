import XCTest

/**
 El viaje en directo EN EL SISTEMA: la Isla Dinámica y la pantalla de bloqueo
 que pinta iOS, no las vistas sueltas de la lámina.

 Hace falta porque lo que se ve fuera de la app no lo controla la app: lo pinta
 el sistema con lo que le mandamos, y ahí puede salir distinto (recortado,
 con otro fondo, sin actualizar). Arranca el viaje de prueba (Madrid →
 Barcelona), sale a la pantalla de inicio, bloquea el móvil y hace una captura
 en cada paso.

 La posición la pone quien lanza la prueba (`xcrun simctl location … set`).
 Las capturas van a la carpeta que diga `CAPTURAS_VIAJE`.
 */
final class ViajeEnDirectoUITests: XCTestCase {
    private func guarda(_ nombre: String) {
        let captura = XCUIScreen.main.screenshot()
        let adjunto = XCTAttachment(screenshot: captura)
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
        if let carpeta = ProcessInfo.processInfo.environment["CAPTURAS_VIAJE"] {
            try? captura.pngRepresentation.write(
                to: URL(fileURLWithPath: carpeta).appendingPathComponent("\(nombre).png"))
        }
    }

    func testSeVeFueraDeLaApp() throws {
        // Al acabar, DESBLOQUEADO: dejaba el simulador en la pantalla de
        // bloqueo, y la prueba que venía detrás no llegaba ni a abrir la app.
        addTeardownBlock {
            let inicio = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
                .press(forDuration: 0.1,
                       thenDragTo: inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
            sleep(1)
        }
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeViaje"]
        app.launch()
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 20),
                      "el viaje no ha arrancado:\n\(app.debugDescription)")
        sleep(3)
        guarda("viaje-1-app")

        // Fuera de la app: la Isla Dinámica.
        XCUIDevice.shared.press(.home)
        sleep(3)
        guarda("viaje-2-isla")

        // Y bloqueado: la tarjeta de la pantalla de bloqueo. El botón de
        // bloqueo no tiene API pública en las pruebas; esta es la de siempre.
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        // Encender la pantalla sin desbloquear: el botón de inicio despierta.
        XCUIDevice.shared.press(.home)
        sleep(3)
        guarda("viaje-3-bloqueo")
    }

    /// Lo que se configura sigue ahí al salir de la pantalla y volver a entrar.
    /// Antes se perdía: vivía solo en memoria y la pantalla se cierra al volver.
    func testLoConfiguradoSigueAlVolver() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaDeViaje"]
        app.launch()

        let entrar = app.buttons["Viaje en directo"]
        XCTAssertTrue(entrar.waitForExistence(timeout: 20))
        entrar.tap()

        let titulo = app.textFields["Viaje a Japón"]
        XCTAssertTrue(titulo.waitForExistence(timeout: 10), "no está el campo del título")
        titulo.tap()
        // Se borra lo que hubiera de otra vuelta, y se escribe uno nuevo.
        let nuevo = "Prueba \(Int.random(in: 1000...9999))"
        if let viejo = titulo.value as? String, viejo != "Viaje a Japón" {
            titulo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: viejo.count))
        }
        titulo.typeText(nuevo)

        // Atrás, y otra vez dentro.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(entrar.waitForExistence(timeout: 10))
        entrar.tap()

        let otraVez = app.textFields.firstMatch
        XCTAssertTrue(otraVez.waitForExistence(timeout: 10))
        XCTAssertEqual(otraVez.value as? String, nuevo, "el título se ha perdido al salir y volver")
    }

    /// El punto exacto en el mapa: buscar, saltar al resultado, afinar
    /// moviendo el mapa con el dedo y quedárselo.
    func testElPuntoExactoEnElMapa() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaDeViaje"]
        app.launch()
        let entrar = app.buttons["Viaje en directo"]
        XCTAssertTrue(entrar.waitForExistence(timeout: 20))
        entrar.tap()

        // El origen, si se quedó elegido de otra vuelta, se cambia primero.
        let cambiar = app.buttons["Cambiar origen"]
        if cambiar.waitForExistence(timeout: 3) { cambiar.tap() }
        let abrirMapa = app.buttons["Elegir el punto exacto en el mapa"].firstMatch
        XCTAssertTrue(abrirMapa.waitForExistence(timeout: 10), "no está el botón del mapa:\n\(app.debugDescription)")
        abrirMapa.tap()

        let buscar = app.textFields["buscadorDelMapa"]
        XCTAssertTrue(buscar.waitForExistence(timeout: 10), "no se abre el mapa")
        buscar.tap()
        buscar.typeText("Aeropuerto de Barcelona")
        let resultado = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] 'El Prat'")).firstMatch
        XCTAssertTrue(resultado.waitForExistence(timeout: 20), "el buscador no encuentra el aeropuerto:\n\(app.debugDescription)")
        resultado.tap()
        sleep(3)
        guarda("mapa-1-aeropuerto")
        let coordenadas = app.staticTexts["coordenadasDelMapa"]
        let antes = coordenadas.label
        XCTAssertTrue(antes.hasPrefix("41.2"), "el mapa no ha ido al aeropuerto: \(antes)")

        // Afinar: arrastrar el mapa. El punto tiene que cambiar.
        let mapa = app.maps.firstMatch
        mapa.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
            .press(forDuration: 0.1, thenDragTo: mapa.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.45)))
        sleep(3)
        guarda("mapa-2-afinado")
        let despues = coordenadas.label
        XCTAssertNotEqual(antes, despues, "arrastrar el mapa no ha movido el punto")

        app.buttons["usarEstePunto"].tap()
        // De vuelta: el origen es el punto afinado.
        let enLista = app.staticTexts[despues]
        XCTAssertTrue(enLista.waitForExistence(timeout: 10) ||
                      app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH '41.2'")).firstMatch.exists,
                      "el punto no ha llegado a la pantalla del viaje:\n\(app.debugDescription)")
        guarda("mapa-3-elegido")
    }
}
