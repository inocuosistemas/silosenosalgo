import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// El viaje entero del encuadre: recortar, guardar y volver a leer.
///
/// Es donde se perdía: el recorte salía bien, pero lo que acababa enseñándose
/// era otra cosa. Aquí se comprueba con una foto partida en dos colores.
final class GuardarEncuadreTests: XCTestCase {
    private let marco = CGSize(width: 320, height: 148)

    private func fotoPartida() -> UIImage {
        let tam = CGSize(width: 1200, height: 600)
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: tam, format: fmt).image { ctx in
            UIColor.red.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 600, height: 600))
            UIColor.blue.setFill(); ctx.fill(CGRect(x: 600, y: 0, width: 600, height: 600))
        }
    }

    private func colorCentral(_ img: UIImage) -> (rojo: CGFloat, azul: CGFloat) {
        var pixel = [UInt8](repeating: 0, count: 4)
        let ctx = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.translateBy(x: -img.size.width / 2, y: -img.size.height / 2)
        ctx.draw(img.cgImage!, in: CGRect(origin: .zero, size: img.size))
        return (CGFloat(pixel[0]) / 255, CGFloat(pixel[2]) / 255)
    }

    func testLoQueSeEncuadraEsLoQueSeGuardaYSeLee() throws {
        var c = Contador(id: "prueba-encuadre", nombre: "P", fecha: Date().addingTimeInterval(86_400))
        defer { FotosDeContador.borra(c) }

        // Encuadrado hacia la mitad ROJA (arrastrando la foto a la derecha).
        let recorte = RecortadorDeFoto.recorta(
            fotoPartida(), marco: marco, escala: 3, movida: CGSize(width: 400, height: 0))
        let nombre = try XCTUnwrap(FotosDeContador.guardaEncuadre(recorte, para: c))
        c.foto = nombre

        let leida = try XCTUnwrap(FotosDeContador.imagen(de: c), "lo guardado tiene que poder leerse")
        let color = colorCentral(leida)
        XCTAssertGreaterThan(color.rojo, 0.8, "lo que se lee tiene que ser el trozo encuadrado")
        XCTAssertLessThan(color.azul, 0.2)
    }

    func testCadaEncuadreGuardaUnFicheroNuevoYTiraElAnterior() throws {
        var c = Contador(id: "prueba-encuadre-2", nombre: "P", fecha: Date().addingTimeInterval(86_400))
        defer { FotosDeContador.borra(c) }

        let primero = try XCTUnwrap(FotosDeContador.guardaEncuadre(
            RecortadorDeFoto.recorta(fotoPartida(), marco: marco, escala: 2, movida: .zero), para: c))
        c.foto = primero
        // Un milisegundo, que el nombre lleva la hora.
        Thread.sleep(forTimeInterval: 0.002)
        let segundo = try XCTUnwrap(FotosDeContador.guardaEncuadre(
            RecortadorDeFoto.recorta(fotoPartida(), marco: marco, escala: 3,
                                     movida: CGSize(width: -400, height: 0)), para: c))
        XCTAssertNotEqual(primero, segundo, "cada encuadre, su fichero")
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: AlmacenContadores.fotos.appendingPathComponent(primero).path),
            "y el anterior se va")
        c.foto = segundo
        let color = colorCentral(try XCTUnwrap(FotosDeContador.imagen(de: c)))
        XCTAssertGreaterThan(color.azul, 0.8, "se lee el encuadre NUEVO")
    }
}
