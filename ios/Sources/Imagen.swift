import ImageIO
import UIKit

/// Leer una imagen YA reducida, sin pasar por el tamaño completo.
///
/// `UIImage(data:)` y luego reducirla decodifica la foto entera: una de 48 MP
/// son ~190 MB de memoria justo al elegirla, y aquí casi siempre se quiere a
/// 1600 px. ImageIO la decodifica ya al tamaño pedido y enderezada según su
/// EXIF, como la dejaba `UIImage` al dibujarla. Espejo de `Imagen` en Android.
enum Imagen {
    static func reducida(_ datos: Data, lado: CGFloat) -> UIImage? {
        guard let fuente = CGImageSourceCreateWithData(datos as CFData, nil) else { return nil }
        return reducida(fuente, lado: lado)
    }

    static func reducida(fichero: URL, lado: CGFloat) -> UIImage? {
        guard let fuente = CGImageSourceCreateWithURL(fichero as CFURL, nil) else { return nil }
        return reducida(fuente, lado: lado)
    }

    private static func reducida(_ fuente: CGImageSource, lado: CGFloat) -> UIImage? {
        let opciones: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(lado),
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(fuente, 0, opciones as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}
