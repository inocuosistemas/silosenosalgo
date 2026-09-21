import UIKit

/**
 Las fotos de un contador en el cajón compartido: guardar el encuadre, guardar
 el original para poder volver a encuadrarlo, y leerlas.

 Aparte de la pantalla —y no dentro de la vista— para poder probarlo: guardar y
 volver a leer es justo donde se perdía el encuadre, y eso no se puede
 comprobar mirando la pantalla.
 */
enum FotosDeContador {
    /// El fichero con la foto tal como se eligió, sin recortar.
    static func nombreOriginal(_ id: String) -> String { "\(id)-original.jpg" }

    static func original(_ id: String) -> UIImage? {
        UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal(id)).path)
    }

    static func guardaOriginal(_ img: UIImage, id: String) {
        guard let jpeg = reducida(img, lado: 1600).jpegData(compressionQuality: 0.85) else { return }
        try? jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal(id)), options: .atomic)
    }

    /// Guarda la foto ya encuadrada y devuelve su nombre.
    ///
    /// Con nombre NUEVO cada vez, y fuera la de antes: guardándola siempre con
    /// el mismo, quien ya la tuviera leída seguía enseñando la anterior —el
    /// widget es otro proceso y no se entera de que el fichero ha cambiado— y
    /// parecía que el encuadre no se guardaba.
    @discardableResult
    static func guardaEncuadre(_ img: UIImage, para contador: Contador) -> String? {
        let pequena = reducida(img, lado: 900)
        guard let jpeg = pequena.jpegData(compressionQuality: 0.8) else { return nil }
        let nombre = "\(contador.id)-\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        do {
            try jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombre), options: .atomic)
        } catch {
            return nil
        }
        if let viejo = contador.foto, viejo != nombre, !viejo.hasPrefix("cartel-") {
            try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(viejo))
        }
        return nombre
    }

    /// La foto que le toca enseñar a un contador.
    static func imagen(de contador: Contador) -> UIImage? {
        contador.foto.flatMap {
            UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent($0).path)
        }
    }

    static func borra(_ contador: Contador) {
        if let foto = contador.foto, !foto.hasPrefix("cartel-") {
            try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(foto))
        }
        try? FileManager.default.removeItem(
            at: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal(contador.id)))
    }

    /// Reducida a `lado` píxeles de largo. A escala 1: el formato por defecto
    /// multiplica por la densidad de la pantalla, y los puntos salían el triple
    /// de píxeles — justo lo que se quería evitarle al widget.
    static func reducida(_ img: UIImage, lado: CGFloat) -> UIImage {
        let escala = min(1, lado / max(img.size.width, img.size.height))
        guard escala < 1 else { return img }
        let tamano = CGSize(width: img.size.width * escala, height: img.size.height * escala)
        let formato = UIGraphicsImageRendererFormat.default()
        formato.scale = 1
        return UIGraphicsImageRenderer(size: tamano, format: formato).image { _ in
            img.draw(in: CGRect(origin: .zero, size: tamano))
        }
    }
}
