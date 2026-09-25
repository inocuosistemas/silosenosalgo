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

    /// La app cerrada con un viaje en marcha, y la tarjeta ya caducada (sin
    /// actualizar): al volver a abrirla se engancha a ella y se puede
    /// terminar. Antes solo buscaba las activas, se quedaba sin «En marcha» ni
    /// botón de terminar, y con el GPS de respaldo encendido.
    func testAlReabrirSeEnganchaALaTarjetaCaducada() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeViaje", "-CaducidadCorta"]
        app.launch()
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 20))
        app.terminate()
        sleep(8)

        app.launchArguments = ["-PruebaDeViaje", "-SoloReanudar"]
        app.launch()
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 15),
                      "no se ha enganchado a la tarjeta caducada:\n\(app.debugDescription)")
        let terminar = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Terminar el viaje'")).firstMatch
        if !terminar.exists { app.swipeUp() }
        XCTAssertTrue(terminar.waitForExistence(timeout: 5))
        terminar.tap()
        XCTAssertFalse(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 3))
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

    /// Tocar la tarjeta en la pantalla de bloqueo abre la app en la pantalla
    /// del viaje —aunque estuviera cerrada—, y desde ahí se termina.
    func testTocarLaTarjetaAbreElViajeParaTerminarlo() {
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
        sleep(2)
        app.terminate()
        XCUIDevice.shared.press(.home)
        sleep(2)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(3)
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permitir = sistema.buttons["Permitir siempre"]
        if permitir.waitForExistence(timeout: 2) { permitir.tap(); sleep(2) }
        let tarjeta = sistema.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Esquí en Grandvalira'")).firstMatch
        XCTAssertTrue(tarjeta.waitForExistence(timeout: 5), "no está la tarjeta:\n\(sistema.debugDescription)")
        tarjeta.tap()
        // Sin código en el simulador: se abre la app sin más.
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "no se ha abierto la app")
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 15),
                      "no se ha abierto la pantalla del viaje:\n\(app.debugDescription)")
        guarda("viaje-abierto-desde-la-tarjeta")
        let terminar = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Terminar el viaje'")).firstMatch
        for _ in 0..<4 where !terminar.isHittable { app.swipeUp() }
        terminar.tap()
        XCTAssertFalse(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 3))
    }

    /// La tarjeta de carrera con una ruta propia, sin carrera ni baliza: el
    /// formulario, y en marcha en la pantalla de bloqueo SIN vista de
    /// corredores; se termina desde la app.
    func testLaCarreraConRutaPropia() {
        addTeardownBlock {
            let inicio = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
                .press(forDuration: 0.1,
                       thenDragTo: inicio.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
            sleep(1)
        }
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeCarreraConTrazado"]
        app.launch()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS 'Empezar'")).firstMatch
                        .waitForExistence(timeout: 20), "no está el formulario:\n\(app.debugDescription)")
        XCTAssertTrue(app.staticTexts["Vuelta al Montseny"].exists || app.buttons.containing(
            NSPredicate(format: "label CONTAINS 'Vuelta al Montseny'")).firstMatch.exists)
        guarda("carrera-ruta-1-formulario")
        app.terminate()

        app.launchArguments = ["-PruebaDeCarreraConTrazado", "-EnMarcha"]
        app.launch()
        XCTAssertTrue(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 20),
                      "no ha empezado:\n\(app.debugDescription)")
        sleep(2)
        guarda("carrera-ruta-2-en-marcha")
        XCUIDevice.shared.press(.home)
        sleep(2)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(3)
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permitir = sistema.buttons["Permitir siempre"]
        if permitir.waitForExistence(timeout: 2) { permitir.tap(); sleep(2) }
        guarda("carrera-ruta-3-bloqueo")
        XCTAssertTrue(sistema.buttons["Carrera"].waitForExistence(timeout: 5),
                      "no está la tarjeta:\n\(sistema.debugDescription)")
        XCTAssertFalse(sistema.buttons["Corredores"].exists, "con una ruta propia no hay corredores")

        // Desbloquear, volver a la app y terminarla.
        sistema.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
            .press(forDuration: 0.1, thenDragTo: sistema.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
        sleep(1)
        app.activate()
        let terminar = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Terminar la tarjeta'")).firstMatch
        for _ in 0..<4 where !terminar.isHittable { app.swipeUp() }
        terminar.tap()
        XCTAssertFalse(app.staticTexts["EN MARCHA"].waitForExistence(timeout: 3))
    }

    /// La pantalla principal en cuatro pestañas: cada una con lo suyo, y al
    /// elegir una carrera se salta a la de la baliza.
    func testLaPantallaPrincipalEnPestanas() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaPrincipal"]
        app.launch()
        let barra = app.tabBars.firstMatch
        XCTAssertTrue(barra.buttons["Baliza"].waitForExistence(timeout: 20))
        sleep(1)
        guarda("principal-1-baliza")
        XCTAssertTrue(app.staticTexts["QUÉ SALIDA ES ESTA"].exists)
        XCTAssertFalse(app.staticTexts["MIS CARRERAS"].exists)

        barra.buttons["Carreras"].tap()
        XCTAssertTrue(app.staticTexts["MIS CARRERAS"].waitForExistence(timeout: 5))
        sleep(1)
        guarda("principal-2-carreras")

        barra.buttons["En directo"].tap()
        XCTAssertTrue(app.staticTexts["Viaje en directo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Cuenta atrás y widget"].exists)
        guarda("principal-3-en-directo")

        barra.buttons["Archivo"].tap()
        XCTAssertTrue(app.staticTexts["LO QUE TIENES GRABADO"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Salir de la cuenta"].exists, "salir está en «Mi cuenta»")
        guarda("principal-4-archivo")

        // Elegir una carrera lleva a la baliza, con ella puesta.
        barra.buttons["Carreras"].tap()
        let carrera = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS 'Matxicots 26'")).firstMatch
        XCTAssertTrue(carrera.waitForExistence(timeout: 5))
        carrera.tap()
        XCTAssertTrue(app.staticTexts["QUÉ SALIDA ES ESTA"].waitForExistence(timeout: 5),
                      "no ha saltado a la baliza")
        guarda("principal-5-baliza-con-carrera")
    }

    /// La marca de arriba a la derecha abre «Mi cuenta»: la marca, la
    /// contraseña y salir. Sin sesión de verdad no se guarda nada: aquí se mira
    /// cómo se ve y que el botón de cambiar solo se enciende cuando toca.
    func testLaMarcaAbreMiCuenta() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaPrincipal"]
        app.launch()
        let marca = app.buttons["botonMiCuenta"]
        XCTAssertTrue(marca.waitForExistence(timeout: 20))
        sleep(1)
        guarda("cuenta-1-cabecera")
        marca.tap()
        XCTAssertTrue(app.navigationBars["Mi cuenta"].waitForExistence(timeout: 5))
        sleep(1)
        guarda("cuenta-2-marca")

        let cambiar = app.buttons["cambiarContrasena"]
        app.swipeUp()
        XCTAssertTrue(cambiar.waitForExistence(timeout: 5))
        XCTAssertFalse(cambiar.isEnabled)
        app.secureTextFields["claveActual"].tap()
        app.typeText("vieja-1234")
        app.secureTextFields["claveNueva"].tap()
        app.typeText("nueva-5678")
        app.secureTextFields["claveRepetida"].tap()
        app.typeText("nueva-567")
        XCTAssertTrue(app.staticTexts["No coinciden."].waitForExistence(timeout: 3))
        XCTAssertFalse(cambiar.isEnabled)
        app.typeText("8")
        XCTAssertTrue(cambiar.isEnabled)
        guarda("cuenta-3-contrasena")
        app.swipeUp()
        XCTAssertTrue(app.buttons["salirDeLaCuenta"].exists)
        guarda("cuenta-4-salir")
    }

    /// Sin marca elegida: la inicial en el botón, y los emojis y colores ya
    /// desplegados para elegir.
    func testMiCuentaSinMarca() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaPrincipal", "-SinMarca"]
        app.launch()
        let marca = app.buttons["botonMiCuenta"]
        XCTAssertTrue(marca.waitForExistence(timeout: 20))
        marca.tap()
        XCTAssertTrue(app.buttons["🦊"].waitForExistence(timeout: 5), "los emojis no están desplegados")
        sleep(1)
        guarda("cuenta-5-sin-marca")
        app.swipeUp()
        XCTAssertTrue(app.buttons["Naranja"].waitForExistence(timeout: 5))
        guarda("cuenta-6-colores")
    }

    /// Fotos en una salida terminada: la cuadrícula con cómo se colocó cada
    /// una, el repaso en el mapa, poner a mano la que no tiene sitio, y subir.
    func testFotosEnUnaSalidaTerminada() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeFotosEnRuta"]
        app.launch()
        let alMapa = app.buttons["verEnElMapa"]
        XCTAssertTrue(alMapa.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["6 fotos · 1 sin sitio (se ponen en el mapa)"].exists)
        sleep(1)
        guarda("fotos-1-elegidas")

        alMapa.tap()
        let subir = app.buttons["subirFotos"]
        XCTAssertTrue(subir.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 sin sitio: toca en el mapa dónde va, o no se subirá."].exists)
        sleep(2)
        guarda("fotos-2-repaso")

        // La que no tiene sitio ya está elegida: se toca el mapa y va ahí.
        app.maps.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'puesta a mano'")).firstMatch
            .waitForExistence(timeout: 5), "no se ha colocado a mano")
        XCTAssertFalse(app.staticTexts["1 sin sitio: toca en el mapa dónde va, o no se subirá."].exists)
        guarda("fotos-3-a-mano")

        subir.tap()
        XCTAssertTrue(app.staticTexts["6 fotos añadidas"].waitForExistence(timeout: 15))
        guarda("fotos-4-hecho")
    }

    /// «Buscar las fotos de la ruta» con fotos de verdad en el carrete: tres
    /// hechas durante la salida (una con GPS lejos de donde dice su hora) y una
    /// de antes, que no debe salir. Las pone quien lanza la prueba
    /// (`xcrun simctl addmedia`), con el permiso de fotos ya dado.
    func testBuscarLasFotosDeLaRuta() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeFotosEnRuta", "-SinFotos"]
        app.launch()
        let buscar = app.buttons["buscarFotos"]
        XCTAssertTrue(buscar.waitForExistence(timeout: 20))
        buscar.tap()
        // El permiso de la fototeca, la primera vez.
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for boton in ["Allow Full Access", "Permitir acceso total", "Allow Access to All Photos"] {
            let b = sistema.buttons[boton]
            if b.waitForExistence(timeout: 3) { b.tap(); break }
        }
        XCTAssertTrue(app.staticTexts["Hay 3 fotos hechas durante la salida."].waitForExistence(timeout: 10),
                      app.debugDescription)
        guarda("carrete-1-halladas")
        app.buttons["anadirHalladas"].tap()
        XCTAssertTrue(app.staticTexts["3 fotos"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["GPS"].exists, "la del GPS lejos de su hora va por el GPS")
        guarda("carrete-2-anadidas")
        app.buttons["verEnElMapa"].tap()
        XCTAssertTrue(app.buttons["subirFotos"].waitForExistence(timeout: 5))
        sleep(2)
        guarda("carrete-3-mapa")
    }

    /// El enlace del widget de la cuenta atrás abre esa sección, no la
    /// pantalla principal.
    func testElWidgetAbreLasCuentasAtras() {
        let app = XCUIApplication()
        app.launch()
        sleep(2)
        app.open(URL(string: "silosenosalgo://cuenta-atras")!)
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let abrir = sistema.buttons["Abrir"]
        if abrir.waitForExistence(timeout: 3) { abrir.tap() }
        XCTAssertTrue(app.navigationBars["Cuenta atrás"].waitForExistence(timeout: 10),
                      "no ha abierto las cuentas atrás:\n\(app.debugDescription)")
        guarda("widget-abre-cuentas-atras")
    }

    /// La foto de la nota: los dos botones grandes, elegir de la galería, y la
    /// foto puesta (con «Cambiar» y «Quitar»).
    func testLaFotoDeLaNota() {
        let app = XCUIApplication()
        app.launchArguments = ["-PruebaDeNota"]
        app.launch()
        let galeria = app.buttons["Galería"]
        XCTAssertTrue(galeria.waitForExistence(timeout: 15), "no está «Galería»:\n\(app.debugDescription)")
        guarda("nota-1-sin-foto")
        galeria.tap()
        // El selector de fotos es otro proceso: la primera foto, por su sitio.
        sleep(3)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.16, dy: 0.43)).tap()
        let lista = app.staticTexts["Lista"]
        XCTAssertTrue(lista.waitForExistence(timeout: 20), "no ha quedado la foto:\n\(app.debugDescription)")
        sleep(1)
        guarda("nota-3-con-foto")
        XCTAssertTrue(app.buttons["Cambiar"].exists && app.buttons["Quitar"].exists)
        app.terminate()
        // Y cómo se ve mientras se trae una foto de iCloud.
        app.launchArguments = ["-PruebaDeNota", "-NotaPreparando"]
        app.launch()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Trayendo la foto'")).firstMatch
                        .waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Preparando…"].isEnabled, "no se puede guardar a medias")
        guarda("nota-2-preparando")
    }

    /// Sin la lista de carreras todavía, o sin poder traerla: se dice, y no
    /// «no estás inscrito a ninguna».
    func testCarrerasCargandoOSinConexion() {
        let app = XCUIApplication()
        app.launchArguments = ["-PruebaDePantallaPrincipal", "-CarrerasCargando"]
        app.launch()
        app.tabBars.buttons["Carreras"].tap()
        XCTAssertTrue(app.staticTexts["Cargando tus carreras…"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'No estás inscrito'")).firstMatch.exists)
        guarda("carreras-cargando")
        app.terminate()
        app.launchArguments = ["-PruebaDePantallaPrincipal", "-CarrerasFallo"]
        app.launch()
        app.tabBars.buttons["Carreras"].tap()
        XCTAssertTrue(app.staticTexts["No se han podido cargar tus carreras"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Reintentar"].exists)
        guarda("carreras-sin-conexion")
    }

    /// Preparar la carrera la noche antes: la lista, «Dejar lista», y la
    /// tarjeta de la carrera dice «Lista».
    func testPrepararLaCarreraLaNocheAntes() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaPrincipal", "-CarreraManana", "-SinPreparar"]
        app.launch()
        app.tabBars.buttons["Carreras"].tap()
        let preparar = app.buttons["Preparar"].firstMatch
        XCTAssertTrue(preparar.waitForExistence(timeout: 10), "no está «Preparar»:\n\(app.debugDescription)")
        preparar.tap()
        XCTAssertTrue(app.staticTexts["LA NOCHE ANTES"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Ubicación «Siempre»"].exists)
        sleep(2)
        guarda("preparar-1-lista")
        let dejar = app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Dejar lista para las'")).firstMatch
        for _ in 0..<3 where !dejar.isHittable { app.swipeUp() }
        dejar.tap()
        XCTAssertTrue(app.staticTexts["Todo listo"].waitForExistence(timeout: 5))
        guarda("preparar-2-todo-listo")
        app.buttons["Cerrar"].tap()
        XCTAssertTrue(app.buttons["Lista"].waitForExistence(timeout: 5), "la tarjeta no dice «Lista»")
        guarda("preparar-3-tarjeta-lista")
    }

    /// El día de la carrera, ya a la hora del aviso: «Armar ya» deja la baliza
    /// armada y en la pestaña de la baliza sale «Lista para salir».
    func testArmarLaCarreraElMismoDia() {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDePantallaPrincipal", "-CarreraEnUnRato", "-SinPreparar"]
        app.launch()
        app.tabBars.buttons["Carreras"].tap()
        let preparar = app.buttons["Preparar"].firstMatch
        XCTAssertTrue(preparar.waitForExistence(timeout: 10))
        preparar.tap()
        let armar = app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Armar ya'")).firstMatch
        for _ in 0..<3 where !armar.isHittable { app.swipeUp() }
        XCTAssertTrue(armar.waitForExistence(timeout: 5), "no está «Armar ya»:\n\(app.debugDescription)")
        armar.tap()
        let lista = app.staticTexts["Lista para salir"]
        XCTAssertTrue(lista.waitForExistence(timeout: 20), "no ha quedado armada:\n\(app.debugDescription)")
        XCTAssertTrue(app.tabBars.buttons["Baliza"].isSelected)
        sleep(1)
        guarda("preparar-4-lista-para-salir")
        // Y se desarma.
        app.buttons["Desarmar"].firstMatch.tap()
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
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'de 42,0 km'")).firstMatch
                        .waitForExistence(timeout: 5),
                      "no cambia a la vista de la carrera:\n\(app.debugDescription)")

        app.buttons["Corredores"].firstMatch.tap()
        sleep(1)
        guarda("sim-4-corredores")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label ENDSWITH '.º'")).firstMatch
                        .waitForExistence(timeout: 5),
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
