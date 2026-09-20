import SwiftUI
import UIKit

/**
 El número de la cuenta atrás: `12:07:37:11`, con cada par encima de su
 etiqueta (Días · Hrs · Min · Seg), como en un marcador.

 Lo que obliga a medir: las horas, los minutos y los segundos los pinta el
 RELOJ DEL SISTEMA (`Text(style: .timer)`), que es una sola pieza de texto y no
 se puede partir en tres columnas. Así que se hace al revés: se mide lo que
 ocupan dos cifras y un dos puntos con la fuente de verdad, se elige el tamaño
 que llena el ancho, y las etiquetas se ponen justo debajo del centro de cada
 par. Centrar a ojo dejaba los números fuera de sus etiquetas.

 La misma vista la usan el widget y la tarjeta de la app, para que lo que se
 elige sea lo que se ve.
 */
public struct NumeroCuentaAtras: View {
    public let dias: Int
    /// Hasta cuándo cuenta el reloj del sistema: la misma hora, el día que falta.
    public let corte: Date
    /// Lo que va delante del reloj para que las horas lleven dos cifras.
    public let prefijoHoras: String
    public let color: Color
    /// El tamaño MÁXIMO de las cifras: se baja hasta que el número quepa.
    public let cuerpo: CGFloat
    public let etiqueta: CGFloat
    public let colorEtiqueta: Color
    /// Va encima de una foto: las cifras llevan halo oscuro y las etiquetas van
    /// en blanco, para leerse sobre cualquier cosa.
    public let sobreFoto: Bool
    /// Los dos colores del degradado, en hexadecimal; nil = un solo color.
    public let degradado: (String, String)?

    public init(
        dias: Int, corte: Date, prefijoHoras: String, color: Color,
        cuerpo: CGFloat, etiqueta: CGFloat, colorEtiqueta: Color, sobreFoto: Bool = false,
        degradado: (String, String)? = nil
    ) {
        self.sobreFoto = sobreFoto
        self.degradado = degradado
        self.dias = dias
        self.corte = corte
        self.prefijoHoras = prefijoHoras
        self.color = color
        self.cuerpo = cuerpo
        self.etiqueta = etiqueta
        self.colorEtiqueta = colorEtiqueta
    }

    /// La fuente de las cifras: la del sistema tal cual (sin redondear) y en
    /// negrita, con cifras de ancho fijo — que es lo que hace que cada par
    /// ocupe siempre lo mismo y las etiquetas caigan en su sitio. Redonda y
    /// gruesa, que fue lo primero, quedaba tosca al lado de la referencia.
    static func fuente(_ tam: CGFloat) -> UIFont {
        UIFont.monospacedDigitSystemFont(ofSize: tam, weight: .bold)
    }

    private static func ancho(_ texto: String, _ f: UIFont) -> CGFloat {
        (texto as NSString).size(withAttributes: [.font: f]).width
    }

    public var body: some View {
        GeometryReader { g in
            let w = g.size.width
            // Medido a tamaño base y escalado: las anchuras crecen con el cuerpo.
            let base = Self.fuente(cuerpo)
            let par0 = Self.ancho("00", base)
            let colon0 = Self.ancho(":", base)
            let total0 = 4 * par0 + 3 * colon0
            let tam = min(cuerpo, cuerpo * (w / total0))
            let f = Self.fuente(tam)
            let par = Self.ancho("00", f)
            let colon = Self.ancho(":", f)
            let total = 4 * par + 3 * colon
            let x0 = (w - total) / 2
            let centros = (0..<4).map { i in x0 + CGFloat(i) * (par + colon) + par / 2 }
            let altoCifras = f.lineHeight
            VStack(spacing: 0) {
                // Cada pieza, con su ancho MEDIDO y no el que ella pida. En un
                // widget el reloj del sistema reserva mucho más ancho del que
                // pinta (el del texto más largo que podría llegar a enseñar) y
                // se dibuja pegado a la izquierda de ese hueco: dejándole
                // elegir, la fila salía más ancha que la tarjeta y el número
                // entero se iba a la izquierda, fuera de sus etiquetas. En la
                // app no pasa, así que ahí se veía bien y en el widget no.
                let anchoPrefijo = prefijoHoras.isEmpty ? 0 : Self.ancho(prefijoHoras, f)
                let anchoReloj = 3 * par + 2 * colon - anchoPrefijo
                // A cada pieza, su trozo del degradado (ver `ColoresContador.mezcla`).
                let tramo = { (desde: CGFloat, hasta: CGFloat) -> AnyShapeStyle in
                    guard let d = degradado else { return AnyShapeStyle(color) }
                    return AnyShapeStyle(LinearGradient(
                        colors: [ColoresContador.mezcla(d.0, d.1, desde / total), ColoresContador.mezcla(d.0, d.1, hasta / total)],
                        startPoint: .leading, endPoint: .trailing
                    ))
                }
                let xReloj = par + colon + anchoPrefijo
                HStack(spacing: 0) {
                    Text(String(format: "%02d", dias))
                        .frame(width: par, alignment: .center)
                        .foregroundStyle(tramo(0, par))
                    Text(":")
                        .frame(width: colon, alignment: .center)
                        .foregroundStyle(tramo(par, par + colon))
                    if !prefijoHoras.isEmpty {
                        Text(prefijoHoras)
                            .frame(width: anchoPrefijo, alignment: .leading)
                            .foregroundStyle(tramo(par + colon, xReloj))
                    }
                    Text(corte, style: .timer)
                        .foregroundStyle(tramo(xReloj, total))
                        .multilineTextAlignment(.leading)
                        // Un pelo de holgura a la derecha: si el reloj midiera
                        // medio punto más que la cuenta, se cortaría con "…".
                        .frame(width: anchoReloj + 4, alignment: .leading)
                }
                .font(Font(f))
                .foregroundStyle(color)
                .lineLimit(1)
                .frame(width: total + 4, height: altoCifras, alignment: .leading)
                .offset(x: 2)
                // Sobre una foto, dos sombras: una pegada que hace de filo y
                // otra ancha que hace de halo. Un color sobre una foto
                // cualquiera no se lee sin algo oscuro alrededor, por mucho
                // que se oscurezca la foto: siempre hay una zona clara.
                .shadow(color: .black.opacity(sobreFoto ? 0.9 : 0), radius: 1, x: 0, y: 1)
                .shadow(color: .black.opacity(sobreFoto ? 0.7 : 0), radius: 6, x: 0, y: 0)
                .frame(width: w, height: altoCifras)
                ZStack {
                    ForEach(Array(["Días", "Hrs", "Min", "Seg"].enumerated()), id: \.offset) { i, t in
                        Text(t)
                            .font(.system(size: etiqueta, weight: .semibold))
                            .foregroundStyle(sobreFoto ? Color.white.opacity(0.9) : colorEtiqueta)
                            .shadow(color: .black.opacity(sobreFoto ? 0.9 : 0), radius: 2, x: 0, y: 1)
                            .position(x: centros[i], y: etiqueta * 0.7)
                    }
                }
                .frame(width: w, height: etiqueta * 1.4)
            }
        }
        .frame(height: cuerpo * 1.2 + etiqueta * 1.4)
    }
}
