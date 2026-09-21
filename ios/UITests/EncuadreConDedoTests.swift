import XCTest

/**
 El encuadre, con un dedo de verdad, en la app entera.

 Esto es lo que faltaba. El encuadre se ha dado por arreglado tres veces
 mirando cuentas y ficheros, y en el móvil seguía saliendo la foto de siempre:
 lo que se rompía estaba entre el GESTO y lo que se guarda, y por ahí no pasa
 ninguna prueba normal. Aquí se arrastra, se pulsa «Usar» y se lee lo que ha
 quedado guardado.

 La app arranca con `-PruebaDeEncuadre` directamente en el editor, con un
 contador y una foto de franjas ya puestos: por el camino normal harían falta
 cuenta, carreras y el carrete del sistema, que en un simulador no hay.
 */
final class EncuadreConDedoTests: XCTestCase {
    private func abre() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-PruebaDeEncuadre"]
        app.launch()
        return app
    }

    /// Arrastrar la foto y pulsar «Usar» tiene que guardar ESE encuadre.
    func testArrastrarYUsarGuardaElEncuadre() {
        let app = abre()

        // La lista es perezosa: lo que no se ve no existe todavía, así que hay
        // que bajar hasta encontrarlo, igual que haría cualquiera.
        let ajustar = app.buttons["Ajustar el encuadre"]
        XCTAssertTrue(app.staticTexts["CÓMO SE VE"].waitForExistence(timeout: 20)
                      || ajustar.waitForExistence(timeout: 5), "la app no llega al editor:\n\(app.debugDescription)")
        var intentos = 0
        while !ajustar.exists && intentos < 12 {
            app.swipeUp()
            intentos += 1
        }
        XCTAssertTrue(ajustar.waitForExistence(timeout: 5),
                      "no se llega al botón de encuadre:\n\(app.debugDescription)")
        ajustar.tap()

        let usar = app.buttons["Usar"]
        XCTAssertTrue(usar.waitForExistence(timeout: 10), "no se abre la pantalla de encuadre")

        // Acercar con el deslizador y arrastrar la foto hacia la derecha: se
        // queda mirando el principio de la foto, que es un cambio que se ve.
        let zoom = app.sliders.firstMatch
        XCTAssertTrue(zoom.waitForExistence(timeout: 5), "no hay deslizador de zoom")
        zoom.adjust(toNormalizedSliderPosition: 0.7)

        let marco = app.images.firstMatch.exists ? app.images.firstMatch : app.otherElements.firstMatch
        marco.press(forDuration: 0.1,
                    thenDragTo: marco,
                    withVelocity: .default,
                    thenHoldForDuration: 0.1)
        // Un arrastre de verdad, de izquierda a derecha por el centro del marco.
        let desde = marco.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
        let hasta = marco.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        desde.press(forDuration: 0.15, thenDragTo: hasta)

        usar.tap()

        // Y ahora se guarda el contador, que es cuando el usuario ve si ha
        // servido de algo.
        let guardar = app.buttons["Guardar"]
        XCTAssertTrue(guardar.waitForExistence(timeout: 10), "no se vuelve al editor")
        guardar.tap()

        let resultado = app.staticTexts["resultadoDelEncuadre"]
        XCTAssertTrue(resultado.waitForExistence(timeout: 10), "no se ha guardado nada")
        let texto = resultado.label
        print("RESULTADO \(texto)")

        // La foto de franjas mide 1200 de ancho. Acercada al triple, el
        // recorte tiene que salir con un tercio de eso; sin guardar el
        // acercamiento, salía con el ancho entero.
        let ancho = valor("ancho", texto)
        XCTAssertGreaterThan(ancho, 0, "no hay foto guardada — \(texto)")
        XCTAssertLessThan(ancho, 800, "el recorte salió sin acercar: el encuadre no se guardó — \(texto)")
    }

    private func valor(_ clave: String, _ texto: String) -> Double {
        guard let r = texto.range(of: "\(clave)=") else { return .nan }
        let resto = texto[r.upperBound...]
        let num = resto.prefix { "0123456789.-".contains($0) }
        return Double(num) ?? .nan
    }
}
