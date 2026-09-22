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
}
