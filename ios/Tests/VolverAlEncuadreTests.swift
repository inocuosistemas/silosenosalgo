import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 Volver a «Ajustar el encuadre» y encontrárselo donde se dejó.

 Esto es lo que se veía roto y no lo estaba del todo: el recorte SÍ se
 guardaba —eso ya lo comprueba `GuardarEncuadreTests`—, pero lo que no se
 guardaba era CÓMO se había hecho. Al volver a abrir la pantalla de encuadre,
 la foto salía otra vez centrada y al 100 %, y desde dentro de la app no hay
 manera de distinguir eso de «no se ha guardado nada».

 Se prueba en dos mitades, que es donde puede romperse cada una:
 - que el ajuste sobreviva a guardar y volver a leer los contadores;
 - que el ajuste, medido en fracción de marco, signifique lo mismo en un
   marco de otro tamaño (el mismo trozo de foto).
 */
final class VolverAlEncuadreTests: XCTestCase {
    private func fotoPartida() -> UIImage {
        let tam = CGSize(width: 1200, height: 600)
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: tam, format: fmt).image { ctx in
            UIColor.red.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 600, height: 600))
            UIColor.blue.setFill(); ctx.fill(CGRect(x: 600, y: 0, width: 600, height: 600))
        }
    }

    /// El ajuste pasa por el disco y vuelve entero.
    func testElAjusteSobreviveAGuardarYLeer() throws {
        let hecho = EncuadreFoto(escala: 2.4, x: 0.31, y: -0.12)
        var c = Contador(id: "prueba-volver", nombre: "P", fecha: Date().addingTimeInterval(86_400))
        c.foto = "loquesea.jpg"
        c.encuadre = hecho

        let datos = try JSONEncoder().encode(ContadoresGuardados(contadores: [c]))
        let leido = try JSONDecoder().decode(ContadoresGuardados.self, from: datos)
        let vuelto = try XCTUnwrap(leido.contadores.first?.encuadre)

        XCTAssertEqual(vuelto.escala, hecho.escala, accuracy: 0.0001)
        XCTAssertEqual(vuelto.x, hecho.x, accuracy: 0.0001)
        XCTAssertEqual(vuelto.y, hecho.y, accuracy: 0.0001)
    }

    /// Un contador guardado ANTES de que esto existiera se lee sin encuadre y
    /// sin romperse: es lo que hay ahora mismo en los móviles.
    func testUnContadorViejoSeLeeSinEncuadre() throws {
        let viejo = """
        {"contadores":[{"id":"x","origen":"propio","nombre":"P","fecha":0,"conHora":true,
        "color":"#8b5cf6","anual":false,"alPasar":"ocultar","aspectoPropio":false}],"at":0}
        """
        let leido = try JSONDecoder().decode(ContadoresGuardados.self, from: Data(viejo.utf8))
        XCTAssertNil(leido.contadores.first?.encuadre)
    }

    /// Lo que se guarda es una FRACCIÓN del marco, no puntos de pantalla: en un
    /// marco más ancho tiene que salir el mismo trozo de foto. Si se guardaran
    /// puntos, el encuadre se descolocaría en cuanto cambiara el ancho.
    func testElMismoAjusteDaElMismoTrozoEnOtroMarco() {
        let foto = fotoPartida().size
        let ajuste = EncuadreFoto(escala: 2, x: 0.25, y: 0)

        func trozo(anchoDelMarco w: CGFloat) -> CGRect {
            let marco = CGSize(width: w, height: w / (TamanoWidget.mediano.width / TamanoWidget.mediano.height))
            return RecortadorDeFoto.trozoVisible(
                foto: foto, marco: marco, escala: CGFloat(ajuste.escala),
                movida: CGSize(width: CGFloat(ajuste.x) * marco.width, height: CGFloat(ajuste.y) * marco.height))
        }

        let estrecho = trozo(anchoDelMarco: 320)
        let ancho = trozo(anchoDelMarco: 430)
        XCTAssertEqual(estrecho.origin.x, ancho.origin.x, accuracy: 0.5)
        XCTAssertEqual(estrecho.width, ancho.width, accuracy: 0.5)
        XCTAssertEqual(estrecho.height, ancho.height, accuracy: 0.5)
    }

    /// Y lo de siempre: que un ajuste guardado recorte de verdad el trozo que
    /// se eligió, y no el del medio. Arrastrar la foto a la derecha enseña lo
    /// que hay a su IZQUIERDA — aquí, la mitad roja.
    func testElAjusteGuardadoRecortaElTrozoElegido() {
        let foto = fotoPartida()
        let marco = CGSize(width: 320, height: 148)
        let ajuste = EncuadreFoto(escala: 3, x: 400 / 320, y: 0)
        let rect = RecortadorDeFoto.trozoVisible(
            foto: foto.size, marco: marco, escala: CGFloat(ajuste.escala),
            movida: CGSize(width: CGFloat(ajuste.x) * marco.width, height: CGFloat(ajuste.y) * marco.height))
        XCTAssertLessThan(rect.midX, 600, "el trozo tiene que caer en la mitad roja")
    }
}
