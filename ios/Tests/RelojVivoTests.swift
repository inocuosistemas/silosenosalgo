import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// ¿Sigue MOVIÉNDOSE el reloj del sistema con lo que le ponemos encima?
///
/// `Text(style: .timer)` se pinta solo, sin que nadie lo refresque, pero deja
/// de hacerlo en cuanto se le mete en según qué envoltorio. Aquí se pinta de
/// verdad en una ventana, se fotografía, se esperan unos segundos y se vuelve
/// a fotografiar: si las dos fotos son idénticas, el reloj está parado.
@MainActor
final class RelojVivoTests: XCTestCase {
    private func semueve<V: View>(_ vista: V, _ segundos: TimeInterval = 2.5) -> Bool {
        let host = UIHostingController(rootView: vista)
        host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 90)
        host.view.backgroundColor = .black
        let ventana = UIWindow(frame: host.view.frame)
        ventana.rootViewController = host
        ventana.isHidden = false
        ventana.layoutIfNeeded()
        // `drawHierarchy(afterScreenUpdates:)` y no `layer.render`: el reloj
        // lo pinta el sistema al presentar, y una copia de la capa se lo pierde.
        let foto = {
            UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
            }.pngData()
        }
        let antes = foto()
        RunLoop.current.run(until: Date().addingTimeInterval(segundos))
        return antes != foto()
    }

    func testElRelojSoloSeMueve() {
        let hasta = Date().addingTimeInterval(3600)
        XCTAssertTrue(semueve(Text(hasta, style: .timer).font(.system(size: 30))),
                      "el reloj del sistema, tal cual, tiene que ir solo")
    }

    func testConDegradadoEncima() {
        let hasta = Date().addingTimeInterval(3600)
        let conDegradado = Text(hasta, style: .timer)
            .font(.system(size: 30))
            .foregroundStyle(LinearGradient(colors: [.blue, .purple], startPoint: .leading, endPoint: .trailing))
        XCTAssertTrue(semueve(conDegradado), "con un degradado encima el reloj tiene que seguir corriendo")
    }

    func testElNumeroDeLaCuentaAtrasSeMueve() {
        let c = Contador(nombre: "P", fecha: Date().addingTimeInterval(12 * 86_400 + 5 * 3600))
        let (dias, corte) = c.diasYCorte()
        let vista = NumeroCuentaAtras(
            dias: dias, corte: corte, prefijoHoras: c.prefijoHoras(),
            color: .red, cuerpo: 34, etiqueta: 9, colorEtiqueta: .gray, ancho: 289
        )
        XCTAssertTrue(semueve(vista), "el número de la cuenta atrás tiene que correr solo")
    }

    func testElNumeroConDegradadoSeMueve() {
        let c = Contador(nombre: "P", fecha: Date().addingTimeInterval(12 * 86_400 + 5 * 3600))
        let (dias, corte) = c.diasYCorte()
        let vista = NumeroCuentaAtras(
            dias: dias, corte: corte, prefijoHoras: c.prefijoHoras(),
            color: .red, cuerpo: 34, etiqueta: 9, colorEtiqueta: .gray, ancho: 289,
            degradado: ("#3b82f6", "#8b5cf6")
        )
        XCTAssertTrue(semueve(vista), "con degradado también")
    }

    /// Cada envoltorio que le hemos ido poniendo encima al reloj, por separado.
    func testLosEnvoltoriosQueLePusimos() {
        let hasta = Date().addingTimeInterval(3600)
        let reloj = Text(hasta, style: .timer).font(.system(size: 28))

        XCTAssertTrue(semueve(reloj.shadow(color: .black, radius: 4)), "con sombra")
        XCTAssertTrue(semueve(reloj.frame(width: 160, alignment: .leading)), "con ancho fijo")
        XCTAssertTrue(semueve(HStack(spacing: 0) { Text("00:"); reloj }.fixedSize()), "con fixedSize")
        XCTAssertTrue(semueve(GeometryReader { _ in reloj }.frame(height: 40)), "dentro de GeometryReader")
        XCTAssertTrue(semueve(reloj.monospacedDigit()), "con cifras de ancho fijo")
    }
}
