import SwiftUI

/**
 La MARCA de un contador de carrera: su emoji dentro del aro de su color, igual
 que se le ve en el mapa del evento. Suelto, el emoji es un adorno; con su aro
 es "yo en esta carrera", que es lo que se reconoce de un vistazo.

 Los contadores propios no llevan aro: su emoji es un icono, no una marca.
 */
public struct MarcaContador: View {
    public let emoji: String
    public let color: Color
    public let tam: CGFloat

    public init(emoji: String, color: Color, tam: CGFloat) {
        self.emoji = emoji
        self.color = color
        self.tam = tam
    }

    public var body: some View {
        ZStack {
            Circle().fill(Color(red: 0.06, green: 0.09, blue: 0.16))
            Circle().strokeBorder(color, lineWidth: max(2, tam / 11))
            // Los emojis se apoyan un pelo por debajo del centro óptico.
            Text(emoji).font(.system(size: tam * 0.55)).offset(y: tam * 0.02)
        }
        .frame(width: tam, height: tam)
    }
}
