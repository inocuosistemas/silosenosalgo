import SwiftUI

/**
 Los días que faltan, a lo grande: el número llenando el hueco y la palabra
 debajo, pequeña.

 Es para cuando no hay hora que contar —«un viaje en abril», una fecha sin
 hora— y lo único que se puede decir son los días. Puestos en fila y a tamaño
 de texto («12 días»), la baldosa pequeña se quedaba casi vacía con un número
 diminuto en una esquina. Si el widget solo enseña un número, ese número es el
 widget.

 La misma vista la usan el widget y la vista previa de la app, para que lo que
 se elige sea lo que se ve.
 */
public struct NumeroDeDias: View {
    public let dias: Int
    public let color: Color
    /// El tamaño de la cifra; se encoge si el número es largo.
    public let cuerpo: CGFloat
    /// Encima de una foto: con halo, para leerse sobre cualquier cosa.
    public let sobreFoto: Bool

    public init(dias: Int, color: Color, cuerpo: CGFloat, sobreFoto: Bool = false) {
        self.dias = dias
        self.color = color
        self.cuerpo = cuerpo
        self.sobreFoto = sobreFoto
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: -cuerpo * 0.08) {
            Text("\(dias)")
                .font(.system(size: cuerpo, weight: .heavy))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.35)
                .shadow(color: .black.opacity(sobreFoto ? 0.85 : 0), radius: 5, x: 0, y: 1)
            Text(dias == 1 ? "día" : "días")
                .font(.system(size: max(11, cuerpo * 0.2), weight: .semibold))
                .foregroundStyle(sobreFoto ? Color.white.opacity(0.85) : .secondary)
                .shadow(color: .black.opacity(sobreFoto ? 0.85 : 0), radius: 2, x: 0, y: 1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
