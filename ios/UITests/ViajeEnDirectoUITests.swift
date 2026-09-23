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

    /// En coche, la ruta de Apple llega sola al empezar: se ve en «En
    /// marcha», y la tarjeta de la pantalla de bloqueo la dibuja.
    func testElViajeEnCocheVaPorCarretera() throws {
        addTeardownBlock {
            let inicio = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
                .press(forDuration: 0.1,
                       thenDragTo: inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
            sleep(1)
        }
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeViaje", "-ViajeEnCoche"]
        app.launch()
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 20))
        let ruta = app.staticTexts.containing(NSPredicate(format: "label ENDSWITH 'km por carretera'")).firstMatch
        guard ruta.waitForExistence(timeout: 30) else {
            throw XCTSkip("Sin ruta de Apple Maps (¿sin red?):\n\(app.debugDescription)")
        }
        guarda("coche-1-app")
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(3)
        guarda("coche-2-bloqueo")
        let bloqueo = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(bloqueo.staticTexts.containing(NSPredicate(format: "label CONTAINS 'km por carretera'"))
                        .firstMatch.waitForExistence(timeout: 5),
                      "la tarjeta no dice «km por carretera»:\n\(bloqueo.debugDescription)")
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

    /// La simulación del recorrido en la vista previa: capturas en la salida,
    /// a un tercio (como empieza), en lo alto y a punto de llegar.
    func testLaSimulacionDelRecorrido() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaDeViaje", "-ConViajeDeEjemplo"]
        app.launch()
        let entrar = app.buttons["Viaje en directo"]
        XCTAssertTrue(entrar.waitForExistence(timeout: 20))
        entrar.tap()
        let deslizador = app.sliders["simulacionDelRecorrido"]
        XCTAssertTrue(deslizador.waitForExistence(timeout: 10), "no está la simulación")
        sleep(1)
        guarda("simulacion-1-como-empieza")
        // Arriba del todo antes de cada captura: al mover el deslizador la
        // prueba desplaza la lista, y la tarjeta salía cortada.
        func alPrincipio() {
            let abajo = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            abajo.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
            sleep(1)
        }
        for (nombre, punto) in [("simulacion-2-salida", 0.0), ("simulacion-3-en-lo-alto", 0.5),
                                ("simulacion-4-aterrizando", 0.85)] {
            deslizador.adjust(toNormalizedSliderPosition: punto)
            alPrincipio()
            guarda(nombre)
        }
        // Y al final: arrastrando el mando más allá del borde, como con el dedo.
        deslizador.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: deslizador.coordinate(withNormalizedOffset: CGVector(dx: 1.3, dy: 0.5)))
        alPrincipio()
        guarda("simulacion-5-llegado")
        XCTAssertTrue(app.staticTexts["Has llegado"].exists, "al final del recorrido tiene que decir que se ha llegado")
    }

    /// La carrera en directo en la pantalla de bloqueo, pintada por el sistema.
    func testLaCarreraSeVeEnLaPantallaDeBloqueo() {
        addTeardownBlock {
            let inicio = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
                .press(forDuration: 0.1,
                       thenDragTo: inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
            sleep(1)
        }
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeCarrera"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Carrera de prueba en marcha"].waitForExistence(timeout: 20))
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(2)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(3)
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // La primera vez iOS pregunta si se permiten las actividades.
        let permitir = sistema.buttons["Permitir"]
        if permitir.waitForExistence(timeout: 2) { permitir.tap(); sleep(2) }
        guarda("carrera-bloqueo")

        // El selector de la tarjeta: «Carrera» cambia a la vista global SIN
        // abrir la app. Es un botón de la Actividad, que ejecuta el sistema.
        let carrera = sistema.buttons["Carrera"]
        XCTAssertTrue(carrera.waitForExistence(timeout: 5),
                      "no está el botón Carrera en la tarjeta:\n\(sistema.debugDescription)")
        carrera.tap()
        sleep(3)
        guarda("carrera-bloqueo-global")
        XCTAssertTrue(sistema.staticTexts.containing(NSPredicate(format: "label CONTAINS 'de 20,0 km'")).firstMatch
                        .waitForExistence(timeout: 5),
                      "no ha cambiado a la vista de la carrera:\n\(sistema.debugDescription)")

        // Y la de corredores, con su posición.
        let corredores = sistema.buttons["Corredores"]
        XCTAssertTrue(corredores.waitForExistence(timeout: 5),
                      "no está el botón de corredores:\n\(sistema.debugDescription)")
        corredores.tap()
        sleep(3)
        guarda("carrera-bloqueo-corredores")
        XCTAssertTrue(sistema.staticTexts["34.º"].waitForExistence(timeout: 5),
                      "no ha cambiado a la vista de corredores:\n\(sistema.debugDescription)")
    }

    /// La carrera simulada: el deslizador lleva la tarjeta por toda la
    /// carrera, y los botones del selector cambian de vista.
    func testLaCarreraSimulada() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaDeViaje"]
        app.launch()
        let entrar = app.buttons["Carrera en directo"]
        XCTAssertTrue(entrar.waitForExistence(timeout: 20))
        entrar.tap()

        let tiempo = app.sliders["tiempoDeLaSimulacion"]
        XCTAssertTrue(tiempo.waitForExistence(timeout: 10), "no está el deslizador:\n\(app.debugDescription)")
        sleep(1)
        guarda("sim-1-antes-de-salir")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Salida en'")).firstMatch.exists)

        tiempo.adjust(toNormalizedSliderPosition: 0.35)
        sleep(1)
        guarda("sim-2-en-carrera-tramo")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'en carrera'")).firstMatch.exists)

        app.buttons["Carrera"].firstMatch.tap()
        sleep(1)
        guarda("sim-3-vista-carrera")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'de 42,0 km'")).firstMatch.exists,
                      "no cambia a la vista de la carrera:\n\(app.debugDescription)")

        app.buttons["Corredores"].firstMatch.tap()
        sleep(1)
        guarda("sim-4-corredores")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label ENDSWITH '.º'")).firstMatch.exists,
                      "no cambia a la de corredores:\n\(app.debugDescription)")

        // Muy lento, y casi al final: fuera de corte, o ya en meta.
        app.buttons["Muy lento"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Tramo'")).firstMatch.tap()
        tiempo.adjust(toNormalizedSliderPosition: 1)
        sleep(1)
        guarda("sim-5-meta")
        XCTAssertTrue(app.staticTexts["En meta"].firstMatch.exists, "al final no está en meta:\n\(app.debugDescription)")
    }
}
