import SwiftUI

/**
 PROPUESTA: el trayecto de un vuelo como un ARCO en vez de una barra, que cuenta
 el despegue y el aterrizaje sin palabras. El avión va girando con la curva: el
 morro hacia arriba al salir, recto en lo alto y hacia abajo al llegar.

 Todavía no lo usa la Actividad: está para verlo en la lámina y decidir
 (`docs/propuestas/viaje-en-directo/arco`).

 El arco es media ELIPSE apoyada en su base: del mismo ancho que alto es un
 semicírculo, y más ancho que alto, un arco tendido.
 */
public struct ArcoDeViaje: View {
    public let progreso: Double
    public let transporte: TransporteDeViaje
    public let pintura: PinturaDeViaje
    public var chapa: CGFloat = 26

    public init(progreso: Double, transporte: TransporteDeViaje, pintura: PinturaDeViaje,
                chapa: CGFloat = 26) {
        self.progreso = progreso
        self.transporte = transporte
        self.pintura = pintura
        self.chapa = chapa
    }

    public var body: some View {
        GeometryReader { g in
            let geo = Geometria(tamano: g.size, chapa: chapa)
            let p = min(1, max(0, progreso))
            let aqui = geo.punto(p)
            ZStack(alignment: .topLeading) {
                // Lo que falta, punteado.
                geo.camino(desde: p, hasta: 1)
                    .stroke(pintura.texto.opacity(0.3),
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.5, 6]))
                // Lo hecho, lleno. El degradado va de izquierda a derecha, como
                // en la barra.
                geo.camino(desde: 0, hasta: p)
                    .stroke(LinearGradient(colors: [pintura.trayecto, pintura.trayectoFin],
                                           startPoint: .leading, endPoint: .trailing),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round))
                Circle().fill(pintura.trayecto)
                    .frame(width: 8, height: 8)
                    .position(geo.punto(0))
                Circle().strokeBorder(pintura.texto.opacity(0.7), lineWidth: 1.5)
                    .frame(width: 10, height: 10)
                    .position(geo.punto(1))
                Image(systemName: transporte.simbolo)
                    .font(.system(size: chapa * 0.5, weight: .bold))
                    .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
                    // Siguiendo la curva: es lo que hace que se lea como un
                    // despegue y un aterrizaje, y no como un punto que sube.
                    .rotationEffect(.radians(geo.angulo(p)))
                    .foregroundStyle(pintura.sobreChapa)
                    .frame(width: chapa, height: chapa)
                    .background(Circle().fill(pintura.trayectoFin))
                    .shadow(color: pintura.trayectoFin.opacity(0.5), radius: 5)
                    .position(aqui)
            }
        }
    }

    /// Las cuentas del arco. El recorrido va por ÁNGULO, de 180° (a la
    /// izquierda) a 0° (a la derecha); en lo alto, a mitad de viaje.
    struct Geometria {
        let centro: CGPoint
        let rx: CGFloat
        let ry: CGFloat

        init(tamano: CGSize, chapa: CGFloat) {
            // Se deja media chapa de margen por todos lados: la chapa no se
            // sale ni en las puntas ni en lo alto.
            rx = max(1, (tamano.width - chapa) / 2)
            ry = max(1, tamano.height - chapa)
            centro = CGPoint(x: tamano.width / 2, y: tamano.height - chapa / 2)
        }

        func punto(_ t: Double) -> CGPoint {
            let a = Double.pi * (1 - t)
            return CGPoint(x: centro.x + rx * CGFloat(cos(a)), y: centro.y - ry * CGFloat(sin(a)))
        }

        /// Lo más que se inclina el avión: 35°, lo que parece un despegue.
        static let inclinacionMaxima = 35 * Double.pi / 180

        /// Hacia dónde apunta el avión en `t`, en radianes de pantalla (0 = a
        /// la derecha, negativo = hacia arriba).
        ///
        /// Sigue la curva, pero sin pasar de `inclinacionMaxima`: en las puntas
        /// de un semicírculo la curva cae a plomo, y el avión llegaba en
        /// picado, más de accidente que de aterrizaje.
        func angulo(_ t: Double) -> Double {
            let a = Double.pi * (1 - t)
            let curva = atan2(Double(ry) * cos(a), Double(rx) * sin(a))
            return min(Self.inclinacionMaxima, max(-Self.inclinacionMaxima, curva))
        }

        func camino(desde a: Double, hasta b: Double) -> Path {
            Path { p in
                guard b > a else { return }
                let n = 64
                p.move(to: punto(a))
                for i in 1...n { p.addLine(to: punto(a + (b - a) * Double(i) / Double(n))) }
            }
        }
    }
}

/**
 PROPUESTA: la tarjeta de un vuelo con el arco. Dos formas, porque la tarjeta
 no puede pasar de 160 puntos de alto y un semicírculo de verdad a todo lo ancho
 mediría más que eso:

 - `tendido`: un arco bajo ENTRE los dos códigos, en la misma fila; el pie con
   los km, igual que la tarjeta A.
 - `semicirculo`: un semicírculo de verdad entre los códigos, con los km y la
   hora de llegada DENTRO de la cúpula. Sin pie: lo que iba debajo va dentro.
 */
public struct TarjetaViajeArco: View {
    public enum Forma: Sendable { case tendido, semicirculo }

    public let datos: DatosDeViaje
    public let forma: Forma

    public init(datos: DatosDeViaje, forma: Forma) {
        self.datos = datos
        self.forma = forma
    }

    private var pintura: PinturaDeViaje { datos.pintura }
    private var progreso: Double { datos.llegado ? 1 : datos.progreso }

    public var body: some View {
        VStack(spacing: 8) {
            if let t = datos.tituloVisible {
                Text(t)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(pintura.texto.opacity(0.85))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            switch forma {
            case .tendido: tendido
            case .semicirculo: semicirculo
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .foregroundStyle(pintura.texto)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private var tendido: some View {
        VStack(spacing: 8) {
            HStack(alignment: .bottom, spacing: 6) {
                ExtremoDeViaje(lugar: datos.origen, alineado: .leading, apagado: pintura.apagado, tamano: 26)
                ArcoDeViaje(progreso: progreso, transporte: datos.transporte, pintura: pintura, chapa: 24)
                    .frame(height: 54)
                ExtremoDeViaje(lugar: datos.destino, alineado: .trailing, apagado: pintura.apagado, tamano: 26)
            }
            PieDeViaje(datos: datos)
        }
    }

    private var semicirculo: some View {
        HStack(alignment: .bottom, spacing: 4) {
            // Los códigos, con su sitio asegurado: sin esto la cúpula, que se
            // estira a lo que le dejen, echaba al de destino fuera de la tarjeta.
            ExtremoDeViaje(lugar: datos.origen, alineado: .leading, apagado: pintura.apagado, tamano: 26)
                .fixedSize().layoutPriority(1)
            ZStack(alignment: .bottom) {
                ArcoDeViaje(progreso: progreso, transporte: datos.transporte, pintura: pintura, chapa: 24)
                // Dentro de la cúpula, lo que se mira: cuánto falta y cuándo se
                // llega (o que se ha llegado, o que no hay señal).
                VStack(spacing: 0) {
                    if datos.llegado {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(pintura.trayectoFin)
                        Text("Has llegado").font(.caption.weight(.semibold))
                    } else {
                        Text(ColoresViaje.km(datos.restanteKm))
                            .font(.system(size: 24, weight: .bold)).monospacedDigit()
                            .minimumScaleFactor(0.7).lineLimit(1)
                        if datos.sinSenal {
                            (Text("sin señal ") + Text(datos.actualizado, style: .time))
                                .font(.caption2).foregroundStyle(Color.orange)
                        } else if let llegada = datos.llegada {
                            (Text("km · llega ") + Text(llegada, style: .time).bold())
                                .font(.caption2).foregroundStyle(pintura.apagado)
                        } else {
                            Text("km").font(.caption2).foregroundStyle(pintura.apagado)
                        }
                    }
                }
                .padding(.bottom, 4)
                .padding(.horizontal, 30)
            }
            // Un semicírculo de verdad: el doble de ancho que de alto. Con tope
            // de alto, que la tarjeta no puede pasar de 160 puntos.
            .aspectRatio(2, contentMode: .fit)
            .frame(maxWidth: .infinity, maxHeight: 92)
            ExtremoDeViaje(lugar: datos.destino, alineado: .trailing, apagado: pintura.apagado, tamano: 26)
                .fixedSize().layoutPriority(1)
        }
    }
}
