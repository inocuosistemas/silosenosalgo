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

 Y el ancho lo DA QUIEN LA COLOCA, en vez de mirarlo con un `GeometryReader`.
 No es un capricho: dentro de un widget, un reloj del sistema metido en un
 `GeometryReader` deja de correr —el sistema es quien lo refresca, y ahí no lo
 encuentra—, que es como se quedó parada la cuenta atrás. En la app se ve el
 ancho de sobra; en el widget se sabe por el tamaño que tiene.

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
    /// El ancho donde tiene que caber el número.
    public let ancho: CGFloat
    /// Va encima de una foto: las cifras llevan halo oscuro y las etiquetas van
    /// en blanco, para leerse sobre cualquier cosa.
    public let sobreFoto: Bool
    /// Los dos colores del degradado, en hexadecimal; nil = un solo color.
    public let degradado: (String, String)?

    public init(
        dias: Int, corte: Date, prefijoHoras: String, color: Color,
        cuerpo: CGFloat, etiqueta: CGFloat, colorEtiqueta: Color, ancho: CGFloat,
        sobreFoto: Bool = false, degradado: (String, String)? = nil
    ) {
        self.ancho = ancho
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


    public var body: some View {
        let w = ancho
        // Medido a tamaño base y escalado: las anchuras crecen con el cuerpo.
        let base = Self.fuente(cuerpo)
        let par0 = Self.anchoDe("00", base)
        let colon0 = Self.anchoDe(":", base)
        let total0 = 4 * par0 + 3 * colon0
        let tam = min(cuerpo, cuerpo * (w / total0))
        let f = Self.fuente(tam)
        let par = Self.anchoDe("00", f)
        let colon = Self.anchoDe(":", f)
        let total = 4 * par + 3 * colon
        let x0 = (w - total) / 2
        let centros = (0..<4).map { i in x0 + CGFloat(i) * (par + colon) + par / 2 }
        let anchoPrefijo = prefijoHoras.isEmpty ? 0 : Self.anchoDe(prefijoHoras, f)
        let anchoReloj = 3 * par + 2 * colon - anchoPrefijo
        return VStack(spacing: 1) {
            // Cada pieza, con su ancho MEDIDO y no el que ella pida. En un
            // widget el reloj del sistema reserva mucho más ancho del que
            // pinta (el del texto más largo que podría llegar a enseñar) y se
            // dibuja pegado a la izquierda de ese hueco: dejándole elegir, la
            // fila salía más ancha que la tarjeta y el número entero se iba a
            // la izquierda, fuera de sus etiquetas.
            HStack(spacing: 0) {
                Text(String(format: "%02d", dias))
                    .frame(width: par, alignment: .center)
                    .foregroundStyle(tramo(0, par, total))
                Text(":")
                    .frame(width: colon, alignment: .center)
                    .foregroundStyle(tramo(par, par + colon, total))
                if !prefijoHoras.isEmpty {
                    Text(prefijoHoras)
                        .frame(width: anchoPrefijo, alignment: .leading)
                        .foregroundStyle(tramo(par + colon, par + colon + anchoPrefijo, total))
                }
                reloj(tam: tam, par: par, colon: colon,
                      anchoPrefijo: anchoPrefijo, anchoReloj: anchoReloj, total: total)
            }
            .font(Font(f))
            .foregroundStyle(color)
            .lineLimit(1)
            .frame(width: total + 4, alignment: .leading)
            .offset(x: 2)
            // Sobre una foto, dos sombras: una pegada que hace de filo y otra
            // ancha que hace de halo. Un color sobre una foto cualquiera no se
            // lee sin algo oscuro alrededor, por mucho que se oscurezca la
            // foto: siempre hay una zona clara.
            .shadow(color: .black.opacity(sobreFoto ? 0.9 : 0), radius: 1, x: 0, y: 1)
            .shadow(color: .black.opacity(sobreFoto ? 0.7 : 0), radius: 6, x: 0, y: 0)
            .frame(width: w)
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

    /**
     El RELOJ DEL SISTEMA: las horas, los minutos y los segundos.

     Lo pinta el sistema solo, cada segundo, y a cambio hay que dejarlo casi en
     paz: con una `UIFont` convertida con `Font(_:)` se queda parado, y con un
     degradado por encima —probado en el móvil— también. Solo admite COLOR LISO.

     El problema es que es UNA pieza y ocupa tres cuartas partes del número, así
     que pintándolo de un solo color el degradado se veía como dos bloques de
     color pegados: los días de un tono y todo lo demás de otro.

     La salida es partirlo en columnas: el mismo reloj pintado tres veces, cada
     copia recortada a su par de cifras y con su propio color liso, el del
     degradado en ese punto. Cada copia sigue siendo un reloj del sistema sin
     nada encima —así que sigue corriendo—, y como dentro de dos cifras el
     degradado apenas cambia, juntas se leen como una transición.

     Sin degradado no hay nada que repartir y va de una pieza, como siempre.
     */
    @ViewBuilder
    private func reloj(
        tam: CGFloat, par: CGFloat, colon: CGFloat,
        anchoPrefijo: CGFloat, anchoReloj: CGFloat, total: CGFloat
    ) -> some View {
        let fuente = Font.system(size: tam, weight: .bold).monospacedDigit()
        if let d = degradado {
            // Dónde acaba cada columna dentro del hueco entero de hh:mm:ss. Lo
            // que ya escribe el prefijo se descuenta: con "00:" delante, el
            // reloj empieza directamente por los minutos.
            let finales: [CGFloat] = [par + colon, 2 * par + 2 * colon, 3 * par + 2 * colon]
            let iniciales: [CGFloat] = [0, finales[0], finales[1]]
            HStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { k in
                    let ini = max(0, iniciales[k] - anchoPrefijo)
                    let fin = max(0, finales[k] - anchoPrefijo)
                    if fin > ini {
                        // Un pelo de holgura en la última, por si el reloj mide
                        // medio punto más que la cuenta y se corta con "…".
                        let anchoTrozo = fin - ini + (k == 2 ? 4 : 0)
                        let centro = par + colon + anchoPrefijo + (ini + fin) / 2
                        Text(corte, style: .timer)
                            .font(fuente)
                            .foregroundColor(ColoresContador.mezcla(d.0, d.1, centro / total))
                            .frame(width: anchoReloj + 4, alignment: .leading)
                            .offset(x: -ini)
                            .frame(width: anchoTrozo, alignment: .leading)
                            .clipped()
                    }
                }
            }
        } else {
            Text(corte, style: .timer)
                .font(fuente)
                .foregroundColor(color)
                .frame(width: anchoReloj + 4, alignment: .leading)
        }
    }

    /// El trozo de degradado que le toca a una pieza (ver `ColoresContador.mezcla`).
    private func tramo(_ desde: CGFloat, _ hasta: CGFloat, _ total: CGFloat) -> AnyShapeStyle {
        guard let d = degradado else { return AnyShapeStyle(color) }
        return AnyShapeStyle(LinearGradient(
            colors: [ColoresContador.mezcla(d.0, d.1, desde / total), ColoresContador.mezcla(d.0, d.1, hasta / total)],
            startPoint: .leading, endPoint: .trailing
        ))
    }

    private static func anchoDe(_ texto: String, _ f: UIFont) -> CGFloat {
        (texto as NSString).size(withAttributes: [.font: f]).width
    }
}
