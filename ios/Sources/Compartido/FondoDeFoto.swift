import SwiftUI
import UIKit

/**
 La foto de fondo de un contador, con su velo.

 El velo es una FUNDIDA hacia abajo, como la de la tarjeta de «Mis carreras»:
 arriba la foto se ve casi tal cual —el nombre se sostiene con su sombra— y
 abajo, donde va el NÚMERO, se apaga casi del todo, porque es lo que se lee de
 un vistazo y una foto clara se lo come. Oscurecerla entera por igual hasta que
 el número se lea la dejaría irreconocible.
 */
public struct FondoDeFoto: View {
    public let imagen: UIImage

    public init(imagen: UIImage) { self.imagen = imagen }

    public var body: some View {
        ZStack {
            Image(uiImage: imagen)
                .resizable()
                .scaledToFill()
            Self.velo
        }
    }
}

public extension FondoDeFoto {
    /// El velo, suelto: lo usa también la pantalla de encuadre, para enseñar
    /// ahí mismo qué parte de la foto se va a apagar.
    static var velo: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.18), location: 0),
                .init(color: .black.opacity(0.35), location: 0.38),
                .init(color: .black.opacity(0.88), location: 0.78),
                .init(color: .black.opacity(0.94), location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
    }
}
