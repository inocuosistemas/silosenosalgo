import SwiftUI
import UIKit

/**
 El contador GRANDE: el cartel arriba a sangre, fundiéndose con el fondo, y
 debajo la cuenta atrás a todo el ancho. Es el montaje de la tarjeta de «Mis
 carreras» de la app, que es donde nació.

 Vive en `Compartido` —y no dentro del widget— por dos razones: la app lo
 enseña como vista previa, y así se puede pintar en una prueba. Lo que vive
 solo en el widget no se puede mirar sin instalarlo en un iPhone.
 */
public struct TarjetaGrande: View {
    public let contador: Contador
    public let ahora: Date
    public let foto: UIImage?
    /// Lo que mide el widget grande. Se pasa en vez de mirarlo con un
    /// `GeometryReader`: ahí dentro el reloj del sistema deja de correr.
    ///
    /// Es una REFERENCIA, no un corsé: da el alto del cartel y el ancho del
    /// número, pero la tarjeta se estira a lo que haya. Clavándole este tamaño,
    /// en un móvil más ancho que el de referencia la tarjeta salía metida hacia
    /// dentro, con su margen oscuro alrededor y sus esquinas en pico, en vez de
    /// llegar al borde y redondearse con el widget.
    public let tamano: CGSize

    public init(
        contador: Contador, ahora: Date = Date(), foto: UIImage? = nil,
        tamano: CGSize = CGSize(width: 338, height: 354)
    ) {
        self.contador = contador
        self.ahora = ahora
        self.foto = foto
        self.tamano = tamano
    }

    private var fondo: Color { Color(red: 0.06, green: 0.09, blue: 0.16) }

    public var body: some View {
        let c = contador
        let color = Color(hexContador: c.color)
        let fecha = c.fechaVigente(desde: ahora)
        let pasada = fecha <= ahora
        // Hasta dónde baja el TÍTULO. Va más abajo de lo que parecería: ahí la
        // fundida ya ha apagado el cartel, y un título sobre un cartel claro
        // —de los que son casi blancos— no se lee por mucha sombra que lleve.
        let altoCartel = tamano.height * 0.66
        // Y hasta dónde llega la FOTO, que es más abajo: sigue por detrás del
        // rótulo y se apaga del todo justo encima de los números. Cortándola
        // donde acaba el título, la tarjeta se partía en dos mitades —foto
        // arriba, gris liso abajo— y se veía la costura.
        let altoFoto = tamano.height * 0.78
        return ZStack(alignment: .top) {
            // La foto, de fondo y a lo alto, con su fundida encima.
            fondoDeCartel(color: color, alto: altoFoto)
                .frame(maxHeight: .infinity, alignment: .top)

            VStack(spacing: 0) {
                // El título, abajo del todo de su banda.
                HStack(alignment: .center, spacing: 8) {
                    if let emoji = c.emoji, foto != nil {
                        marca(emoji, color, 38)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(c.nombre)
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(fecha, format: c.conHora
                            ? .dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()
                            : .dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }
                .shadow(color: .black.opacity(0.8), radius: 3, x: 0, y: 1)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: altoCartel, alignment: .bottom)

                VStack(spacing: 6) {
                    // El rótulo solo cuando hace falta explicar algo. En la
                    // cuenta atrás no hace falta: debajo del número ya pone
                    // Días · Hrs · Min · Seg. Contando hacia arriba sí, porque
                    // un número subiendo no dice por sí solo desde cuándo.
                    if pasada {
                        Text("DESDE LA SALIDA")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(2)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    numero(c, fecha: fecha, pasada: pasada, color: color)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(fondo)
        .clipped()
    }

    /// La foto (o el color, si no hay) y la fundida que la apaga hacia abajo.
    ///
    /// Las paradas van en fracción de la CARTA, no de la foto, y se convierten
    /// aquí: lo que importa es dónde queda cada cosa en la tarjeta —el título
    /// sobre algo que ya está oscuro, y el sólido justo antes del número—, no a
    /// qué altura de la banda cae.
    @ViewBuilder
    private func fondoDeCartel(color: Color, alto: CGFloat) -> some View {
        let enLaFoto = { (deLaCarta: CGFloat) in min(1, deLaCarta * tamano.height / alto) }
        ZStack {
            if let foto {
                // La foto va DENTRO de un hueco del tamaño de la banda, no al
                // revés. `scaledToFill` la hace más ancha que la tarjeta y
                // `clipped` solo recorta lo que se PINTA, no lo que mide:
                // dejándola mandar, toda la banda medía lo que la foto.
                Color.clear
                    .frame(maxWidth: .infinity)
                    .frame(height: alto)
                    .overlay { Image(uiImage: foto).resizable().scaledToFill() }
                    .clipped()
            } else {
                // Sin cartel, su color y su marca: que no se quede en un hueco.
                LinearGradient(
                    colors: [color.opacity(0.55), color.opacity(0.12)],
                    startPoint: .top, endPoint: .bottom
                )
                if let emoji = contador.emoji {
                    marca(emoji, color, 92)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.bottom, tamano.height * 0.18)
                }
            }
            // La fundida: limpia arriba, ya oscura donde va el título, y
            // sólida encima del número.
            //
            // Las últimas paradas van muy juntas y casi opacas a propósito. Con
            // una sola que llegara a opaco, la pendiente se cortaba en seco ahí
            // y aparecía una raya: el ojo ve el cambio de pendiente aunque los
            // colores a un lado y otro sean casi el mismo. Acercándose poco a
            // poco (0,95 · 0,99 · 1) no hay cambio brusco que ver, y a partir de
            // 0,63 del alto ya es indistinguible del fondo.
            LinearGradient(
                stops: [
                    .init(color: fondo.opacity(0), location: enLaFoto(0.28)),
                    .init(color: fondo.opacity(0.32), location: enLaFoto(0.44)),
                    .init(color: fondo.opacity(0.66), location: enLaFoto(0.54)),
                    .init(color: fondo.opacity(0.88), location: enLaFoto(0.62)),
                    .init(color: fondo.opacity(0.96), location: enLaFoto(0.67)),
                    .init(color: fondo.opacity(0.99), location: enLaFoto(0.71)),
                    .init(color: fondo, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
        .frame(maxWidth: .infinity)
        .frame(height: alto)
        .clipped()
    }

    @ViewBuilder
    private func marca(_ emoji: String, _ color: Color, _ tam: CGFloat) -> some View {
        if contador.origen == .carrera {
            MarcaContador(emoji: emoji, color: color, tam: tam)
        } else {
            Text(emoji).font(.system(size: tam * 0.7))
        }
    }

    @ViewBuilder
    private func numero(_ c: Contador, fecha: Date, pasada: Bool, color: Color) -> some View {
        if pasada {
            Text(fecha, style: .timer)
                .font(.system(size: 52, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .multilineTextAlignment(.center)
        } else if c.estilo == .completo && c.conHora {
            let (dias, corte) = c.diasYCorte(desde: ahora)
            NumeroCuentaAtras(
                dias: dias, corte: corte, prefijoHoras: c.prefijoHoras(desde: ahora),
                color: color, cuerpo: 60, etiqueta: 11, colorEtiqueta: .white.opacity(0.55),
                ancho: tamano.width - 32,
                degradado: c.color2.map { (c.color, $0) }
            )
        } else {
            // El compacto, aquí, son los días en grande y ya está: la baldosa de
            // color no pega debajo de un cartel.
            let cuenta = TarjetaCompacta.cuenta(hasta: fecha, desde: ahora)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(cuenta.dias)")
                    .font(.system(size: 62, weight: .heavy))
                    .foregroundStyle(color)
                Text(cuenta.dias == 1 ? "día" : "días")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        }
    }
}
