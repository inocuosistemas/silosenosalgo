import SwiftUI
import UIKit

/**
 La foto de fondo de un contador, con su velo.

 El velo es un degradado y no un gris parejo: arriba, donde van el nombre y la
 fecha, basta un poco; abajo, donde va el NÚMERO, hace falta mucho, porque es
 lo que se lee de un vistazo y una foto clara se lo come. Oscurecer toda la
 foto por igual hasta que el número se lea la dejaría irreconocible.
 */
public struct FondoDeFoto: View {
    public let imagen: UIImage

    public init(imagen: UIImage) { self.imagen = imagen }

    public var body: some View {
        ZStack {
            Image(uiImage: imagen)
                .resizable()
                .scaledToFill()
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.45), location: 0),
                    .init(color: .black.opacity(0.55), location: 0.35),
                    .init(color: .black.opacity(0.82), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
    }
}
