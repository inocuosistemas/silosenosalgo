import SwiftUI
import UIKit

/**
 El editor de un contador, a solas, para poder probar el ENCUADRE de verdad.

 Existe porque el encuadre se ha dado por arreglado tres veces sin estarlo: las
 pruebas de las cuentas pasaban y en el móvil seguía saliendo la foto de
 siempre. Lo que fallaba estaba entre el dedo y lo que se guarda, y eso solo se
 ve moviendo la foto con un dedo y pulsando «Usar» — en la app entera, no en un
 trozo suelto.

 Llegar hasta aquí por el camino normal pide cuenta, carreras y el carrete del
 sistema, que en un simulador recién hecho no hay. Con `-PruebaDeEncuadre` la
 app arranca directamente en el editor, con un contador y una foto puestos a
 mano: franjas de colores, que dicen de un vistazo qué trozo se está viendo.

 No es una puerta trasera: solo responde a un argumento de arranque, que solo
 puede poner quien lanza el proceso.
 */
enum PruebaDeEncuadre {
    static let argumento = "-PruebaDeEncuadre"

    static var pedida: Bool {
        ProcessInfo.processInfo.arguments.contains(argumento)
    }

    static let idContador = "prueba-encuadre-ui"

    /// Seis franjas de colores, cada una con su número: se ve qué parte de la
    /// foto está saliendo aunque esté acercada.
    static func fotoDeFranjas() -> UIImage {
        let colores: [UIColor] = [.systemRed, .systemGreen, .systemBlue, .systemPurple, .systemOrange, .systemTeal]
        let tam = CGSize(width: 1200, height: 600)
        let ancho = tam.width / CGFloat(colores.count)
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: tam, format: fmt).image { ctx in
            for (i, c) in colores.enumerated() {
                c.setFill()
                let r = CGRect(x: CGFloat(i) * ancho, y: 0, width: ancho, height: tam.height)
                ctx.fill(r)
                let t = "\(i + 1)" as NSString
                let atrib: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 150, weight: .heavy),
                    .foregroundColor: UIColor.white,
                ]
                let s = t.size(withAttributes: atrib)
                t.draw(at: CGPoint(x: r.midX - s.width / 2, y: r.midY - s.height / 2), withAttributes: atrib)
            }
        }
    }

    /// Deja el contador y su foto original en el cajón, y lo devuelve.
    @MainActor
    static func preparaContador() -> Contador {
        let foto = fotoDeFranjas()
        FotosDeContador.guardaOriginal(foto, id: idContador)
        var c = Contador(
            id: idContador, origen: .propio, nombre: "Encuadre",
            fecha: Date().addingTimeInterval(12 * 86_400 + 5 * 3600),
            color: "#f8fafc", emoji: "🏁"
        )
        // Sin recortar todavía: la primera vez se encuadra desde el centro.
        if let nombre = FotosDeContador.guardaEncuadre(foto, para: c) {
            c.foto = nombre
            c.fotoVersion = Date().timeIntervalSince1970
        }
        return c
    }
}

/// La pantalla de la prueba: el editor de verdad, y debajo lo que se ha
/// guardado, para que la prueba pueda leerlo sin adivinar nada.
struct PantallaDePruebaDeEncuadre: View {
    @State private var contador = PruebaDeEncuadre.preparaContador()
    @State private var guardado: Contador?

    var body: some View {
        EditorContador(contador: contador) { nuevo in
            if let nuevo { guardado = nuevo; contador = nuevo }
        }
        .overlay(alignment: .bottom) {
            // Lo que ha quedado guardado, escrito: la prueba lo lee de aquí en
            // vez de mirar píxeles, que es frágil.
            if let g = guardado {
                // El TAMAÑO EN PÍXELES de la foto guardada, que es la prueba
                // de verdad: sin acercar, el recorte sale con el ancho entero
                // de la foto; acercada al triple, con un tercio. Se mide así, y
                // no por el ajuste guardado, para poder correr la misma prueba
                // contra la versión de antes, que no guardaba ajuste ninguno.
                let img = FotosDeContador.imagen(de: g)
                let an = Int(img?.size.width ?? 0), al = Int(img?.size.height ?? 0)
                Text("GUARDADO ancho=\(an) alto=\(al) foto=\(g.foto ?? "-")")
                    .font(.caption2.monospaced())
                    .padding(6)
                    .background(.black)
                    .foregroundStyle(.white)
                    .accessibilityIdentifier("resultadoDelEncuadre")
            }
        }
    }
}
