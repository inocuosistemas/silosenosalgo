import XCTest
import ImageIO
import UniformTypeIdentifiers
@testable import SiLoSeNoSalgo

/// Leer las fotos ya reducidas (ver `Imagen`), sin perder la orientación.
final class ImagenTests: XCTestCase {
    /// Un JPEG de `ancho`×`alto` con la orientación EXIF dada (6 = girada 90°).
    private func jpeg(ancho: Int, alto: Int, orientacion: Int = 1) -> Data {
        let ctx = CGContext(data: nil, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.setFillColor(UIColor.systemTeal.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: ancho, height: alto))
        let datos = NSMutableData()
        let destino = CGImageDestinationCreateWithData(datos, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destino, ctx.makeImage()!, [kCGImagePropertyOrientation: orientacion] as CFDictionary)
        CGImageDestinationFinalize(destino)
        return datos as Data
    }

    func testUnaGrandeSaleAlLadoPedido() throws {
        let img = try XCTUnwrap(Imagen.reducida(jpeg(ancho: 6000, alto: 4000), lado: 1600))
        XCTAssertEqual(max(img.size.width, img.size.height), 1600, accuracy: 1)
        XCTAssertEqual(img.size.width / img.size.height, 1.5, accuracy: 0.01)
    }

    func testEnderezaSegunElExif() throws {
        // Guardada apaisada con «girar 90°»: tiene que salir vertical.
        let img = try XCTUnwrap(Imagen.reducida(jpeg(ancho: 3000, alto: 2000, orientacion: 6), lado: 1600))
        XCTAssertGreaterThan(img.size.height, img.size.width)
    }

    func testUnaPequenaNoSeAgranda() throws {
        let img = try XCTUnwrap(Imagen.reducida(jpeg(ancho: 800, alto: 600), lado: 1600))
        XCTAssertEqual(img.size.width, 800, accuracy: 1)
    }

    func testLoQueNoEsImagenDaNil() {
        XCTAssertNil(Imagen.reducida(Data("hola".utf8), lado: 1600))
    }
}
