import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// El recorte de verdad: que el trozo que se lleva sea el que se estaba viendo.
final class RecorteFotoTests: XCTestCase {
    /// Una foto partida en dos: la mitad izquierda roja y la derecha azul.
    private func fotoPartida(_ tam: CGSize = CGSize(width: 1200, height: 600)) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: tam, format: fmt).image { ctx in
            UIColor.red.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: tam.width / 2, height: tam.height))
            UIColor.blue.setFill()
            ctx.fill(CGRect(x: tam.width / 2, y: 0, width: tam.width / 2, height: tam.height))
        }
    }

    /// El color de en medio del recorte, para saber con qué mitad se ha quedado.
    private func colorCentral(_ img: UIImage) -> (rojo: CGFloat, azul: CGFloat) {
        let punto = CGPoint(x: img.size.width / 2, y: img.size.height / 2)
        var pixel = [UInt8](repeating: 0, count: 4)
        let espacio = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                            space: espacio, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.translateBy(x: -punto.x, y: -punto.y)
        ctx.draw(img.cgImage!, in: CGRect(origin: .zero, size: img.size))
        return (CGFloat(pixel[0]) / 255, CGFloat(pixel[2]) / 255)
    }

    func testArrastrandoALaDerechaSeQuedaLaMitadIzquierda() {
        let foto = fotoPartida()
        let marco = CGSize(width: 300, height: 140)
        // Acercada, y movida a la derecha: por el marco se ve lo de la izquierda.
        let recorte = RecortadorDeFoto.recorta(foto, marco: marco, escala: 3, movida: CGSize(width: 400, height: 0))
        let c = colorCentral(recorte)
        XCTAssertGreaterThan(c.rojo, 0.8, "tendría que haberse quedado con lo rojo")
        XCTAssertLessThan(c.azul, 0.2)
    }

    func testArrastrandoALaIzquierdaSeQuedaLaMitadDerecha() {
        let foto = fotoPartida()
        let marco = CGSize(width: 300, height: 140)
        let recorte = RecortadorDeFoto.recorta(foto, marco: marco, escala: 3, movida: CGSize(width: -400, height: 0))
        let c = colorCentral(recorte)
        XCTAssertGreaterThan(c.azul, 0.8, "tendría que haberse quedado con lo azul")
        XCTAssertLessThan(c.rojo, 0.2)
    }

    func testAcercarDejaUnRecorteMasPequeño() {
        let foto = fotoPartida()
        let marco = CGSize(width: 300, height: 140)
        let lejos = RecortadorDeFoto.recorta(foto, marco: marco, escala: 1, movida: .zero)
        let cerca = RecortadorDeFoto.recorta(foto, marco: marco, escala: 2.5, movida: .zero)
        XCTAssertLessThan(cerca.size.width, lejos.size.width)
    }
}
