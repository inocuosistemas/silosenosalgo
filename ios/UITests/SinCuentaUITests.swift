import XCTest

/// Usar la app sin cuenta (ver `ModoLocal`): se entra sin invitación, se graba
/// una salida en el móvil y queda en el Archivo, sin tocar el servidor.
final class SinCuentaUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func guarda(_ nombre: String) {
        let adjunto = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
        if let carpeta = ProcessInfo.processInfo.environment["CAPTURAS_VIAJE"] {
            try? XCUIScreen.main.screenshot().pngRepresentation
                .write(to: URL(fileURLWithPath: carpeta).appendingPathComponent("\(nombre).png"))
        }
    }

    /// Los avisos del sistema (ubicación, notificaciones, movimiento): se acepta
    /// lo que salga.
    private func aceptaAvisos() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<4 {
            let boton = springboard.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Permitir' OR label CONTAINS[c] 'Allow' OR label CONTAINS[c] 'mientras'")).firstMatch
            guard boton.waitForExistence(timeout: 3) else { return }
            boton.tap()
        }
    }

    func testGrabarSinCuentaYVerlaEnElArchivo() {
        let app = XCUIApplication()
        app.launchArguments = ["-EmpiezaSinSesion"]
        app.launch()
        let sinCuenta = app.buttons["usarSinCuenta"]
        XCTAssertTrue(sinCuenta.waitForExistence(timeout: 10))
        guarda("sincuenta-1-entrar")
        sinCuenta.tap()
        XCTAssertTrue(app.staticTexts["Baliza · sin cuenta"].waitForExistence(timeout: 10))
        aceptaAvisos()

        app.tabBars.buttons["Archivo"].tap()
        XCTAssertTrue(app.staticTexts["Aún no has grabado ninguna. Al terminar una salida queda aquí, con su mapa."]
            .waitForExistence(timeout: 10))
        app.tabBars.buttons["Carreras"].tap()
        XCTAssertTrue(app.buttons["Entrar con una cuenta"].waitForExistence(timeout: 10))
        guarda("sincuenta-2-carreras")

        app.tabBars.buttons["Baliza"].tap()
        let empezar = app.buttons["Empezar a grabar"]
        XCTAssertTrue(empezar.waitForExistence(timeout: 10))
        empezar.tap()
        aceptaAvisos()
        XCTAssertTrue(app.staticTexts["Grabando en este móvil"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sesión caducada'")).firstMatch.exists)
        guarda("sincuenta-3-grabando")

        app.buttons["Terminar la salida"].tap()
        let si = app.buttons["Sí, terminar"]
        XCTAssertTrue(si.waitForExistence(timeout: 5))
        si.tap()
        app.tabBars.buttons["Archivo"].tap()
        XCTAssertTrue(app.staticTexts["· Solo en este móvil"].waitForExistence(timeout: 10))
        guarda("sincuenta-4-archivo")
    }
}
