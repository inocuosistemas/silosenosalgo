import SwiftUI

/**
 Cómo se ve un viaje en directo: la tarjeta de la pantalla de bloqueo y las
 piezas de la Isla Dinámica.

 Aquí, en `Compartido`, y no dentro del widget, por lo mismo que la tarjeta
 grande: así la app la enseña como vista previa y una prueba la puede pintar.
 Lo que vive solo en el widget no se puede mirar sin instalarlo en un iPhone.

 Las vistas reciben los datos sueltos (ver `DatosDeViaje`) y no la Actividad:
 así se pintan igual en la pantalla de bloqueo, en la app y en una prueba.
 */
public struct DatosDeViaje: Hashable, Sendable {
    public var origen: LugarDeViaje
    public var destino: LugarDeViaje
    public var transporte: TransporteDeViaje
    public var restanteKm: Double
    public var progreso: Double
    public var llegada: Date?
    public var llegado: Bool
    /// Hace rato que no hay posición buena: se dice, en vez de enseñar como
    /// actual un número que puede ser de hace una hora.
    public var sinSenal: Bool
    public var actualizado: Date

    public init(origen: LugarDeViaje, destino: LugarDeViaje, transporte: TransporteDeViaje,
                restanteKm: Double, progreso: Double, llegada: Date? = nil,
                llegado: Bool = false, sinSenal: Bool = false, actualizado: Date = Date()) {
        self.origen = origen
        self.destino = destino
        self.transporte = transporte
        self.restanteKm = restanteKm
        self.progreso = progreso
        self.llegada = llegada
        self.llegado = llegado
        self.sinSenal = sinSenal
        self.actualizado = actualizado
    }
}

public enum ColoresViaje {
    public static let fondo = Color(red: 0.06, green: 0.09, blue: 0.16)
    public static let acento = Color(hexContador: "#38bdf8")
    public static let acentoHondo = Color(hexContador: "#0284c7")
    public static let apagado = Color.white.opacity(0.6)

    /// Los kilómetros como se escriben aquí: sin decimales en cuanto pasan de
    /// diez, que un vuelo no se mide en metros; con uno cuando quedan pocos.
    ///
    /// Con el punto de los millares SIEMPRE, y no el del idioma del móvil: en
    /// español el sistema no separa los de cuatro cifras («4389» pero
    /// «10.437»), y en un número que va bajando se veía aparecer y desaparecer
    /// el punto.
    public static func km(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        f.groupingSeparator = "."
        f.groupingSize = 3
        f.decimalSeparator = ","
        f.minimumFractionDigits = v >= 10 ? 0 : 1
        f.maximumFractionDigits = v >= 10 ? 0 : 1
        return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
    }
}

/// La barra del trayecto: hecha en color, por hacer punteada, y el medio de
/// transporte donde se va.
public struct BarraDeViaje: View {
    public let progreso: Double
    public let transporte: TransporteDeViaje
    /// El tamaño de la chapa del icono; la barra se deja ese margen a cada lado
    /// para que la chapa no se salga ni al salir ni al llegar.
    public var chapa: CGFloat = 26

    public init(progreso: Double, transporte: TransporteDeViaje, chapa: CGFloat = 26) {
        self.progreso = progreso
        self.transporte = transporte
        self.chapa = chapa
    }

    public var body: some View {
        GeometryReader { g in
            let r = chapa / 2
            let medio = g.size.height / 2
            let x = r + (g.size.width - chapa) * CGFloat(min(1, max(0, progreso)))
            ZStack(alignment: .topLeading) {
                // Lo que falta, punteado.
                Path { p in
                    p.move(to: CGPoint(x: r, y: medio))
                    p.addLine(to: CGPoint(x: g.size.width - r, y: medio))
                }
                .stroke(Color.white.opacity(0.3),
                        style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.5, 6]))
                // Lo hecho, lleno.
                Capsule()
                    .fill(LinearGradient(colors: [ColoresViaje.acentoHondo, ColoresViaje.acento],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(0, x - r), height: 4)
                    .offset(x: r, y: medio - 2)
                // Los dos extremos: el de salida lleno, el de llegada hueco.
                Circle().fill(ColoresViaje.acentoHondo)
                    .frame(width: 8, height: 8)
                    .position(x: r, y: medio)
                Circle().strokeBorder(Color.white.opacity(0.7), lineWidth: 1.5)
                    .frame(width: 10, height: 10)
                    .position(x: g.size.width - r, y: medio)
                // Y el que viaja.
                Image(systemName: transporte.simbolo)
                    .font(.system(size: chapa * 0.5, weight: .bold))
                    .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
                    .foregroundStyle(ColoresViaje.fondo)
                    .frame(width: chapa, height: chapa)
                    .background(Circle().fill(ColoresViaje.acento))
                    .shadow(color: ColoresViaje.acento.opacity(0.5), radius: 5)
                    .position(x: x, y: medio)
            }
        }
        .frame(height: chapa)
    }
}

/// La tarjeta de la pantalla de bloqueo.
public struct TarjetaViaje: View {
    public enum Variante: Sendable { case a, b }

    public let datos: DatosDeViaje
    public var variante: Variante = .a

    public init(datos: DatosDeViaje, variante: Variante = .a) {
        self.datos = datos
        self.variante = variante
    }

    public var body: some View {
        Group {
            switch variante {
            case .a: variantaA
            case .b: varianteB
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .foregroundStyle(.white)
    }

    /// A: los códigos grandes arriba, en cada punta, como en un panel de salidas.
    private var variantaA: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top) {
                ExtremoDeViaje(lugar: datos.origen, alineado: .leading)
                Spacer(minLength: 8)
                ExtremoDeViaje(lugar: datos.destino, alineado: .trailing)
            }
            BarraDeViaje(progreso: datos.llegado ? 1 : datos.progreso, transporte: datos.transporte)
            pie
        }
    }

    /// B: más apretada, con los códigos a los lados de la barra.
    private var varianteB: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(datos.origen.abreviatura)
                    .font(.system(size: 22, weight: .heavy)).tracking(1)
                BarraDeViaje(progreso: datos.llegado ? 1 : datos.progreso,
                             transporte: datos.transporte, chapa: 24)
                Text(datos.destino.abreviatura)
                    .font(.system(size: 22, weight: .heavy)).tracking(1)
            }
            Text("\(datos.origen.nombre) → \(datos.destino.nombre)")
                .font(.caption).foregroundStyle(ColoresViaje.apagado).lineLimit(1)
            pie
        }
    }

    /// Lo que falta y a qué hora se llega; o que ya se ha llegado; o que no
    /// hay señal y desde cuándo.
    @ViewBuilder
    private var pie: some View {
        if datos.llegado {
            HStack {
                Label("Has llegado a \(datos.destino.nombre)", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ColoresViaje.acento)
                Spacer()
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(ColoresViaje.km(datos.restanteKm))
                    .font(.system(size: 22, weight: .bold)).monospacedDigit()
                Text("km en línea recta")
                    .font(.caption).foregroundStyle(ColoresViaje.apagado)
                Spacer(minLength: 6)
                if datos.sinSenal {
                    // Desde QUÉ HORA, y no «hace tanto»: sin señal no llegan
                    // actualizaciones, y el reloj relativo del sistema lo
                    // escribía con segundos («25 min y 0 s»).
                    (Text("sin señal desde las ") + Text(datos.actualizado, style: .time))
                        .font(.caption).foregroundStyle(Color.orange)
                        .lineLimit(1)
                } else if let llegada = datos.llegada {
                    (Text("llegada ") + Text(llegada, style: .time).bold())
                        .font(.caption).foregroundStyle(ColoresViaje.apagado)
                }
            }
        }
    }
}

/// Una punta del viaje: el código en grande y la ciudad debajo.
public struct ExtremoDeViaje: View {
    public let lugar: LugarDeViaje
    public let alineado: HorizontalAlignment
    public var tamano: CGFloat = 28

    public init(lugar: LugarDeViaje, alineado: HorizontalAlignment, tamano: CGFloat = 28) {
        self.lugar = lugar
        self.alineado = alineado
        self.tamano = tamano
    }

    public var body: some View {
        VStack(alignment: alineado, spacing: 0) {
            Text(lugar.abreviatura)
                .font(.system(size: tamano, weight: .heavy)).tracking(1)
            Text(lugar.nombre)
                .font(.caption).foregroundStyle(ColoresViaje.apagado).lineLimit(1)
        }
    }
}

/// La Isla Dinámica recogida: el icono a un lado y lo que falta al otro.
public struct IslaViajeInicio: View {
    public let transporte: TransporteDeViaje
    public init(transporte: TransporteDeViaje) { self.transporte = transporte }
    public var body: some View {
        Image(systemName: transporte.simbolo)
            .font(.system(size: 14, weight: .bold))
            .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
            .foregroundStyle(ColoresViaje.acento)
    }
}

public struct IslaViajeFin: View {
    public let datos: DatosDeViaje
    public init(datos: DatosDeViaje) { self.datos = datos }
    public var body: some View {
        Group {
            if datos.llegado {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(ColoresViaje.acento)
            } else {
                Text("\(ColoresViaje.km(datos.restanteKm)) km")
                    .monospacedDigit()
                    .foregroundStyle(datos.sinSenal ? Color.orange : .white)
            }
        }
        .font(.system(size: 14, weight: .semibold))
    }
}

/// La mínima, cuando comparte la isla con otra: un anillo con lo hecho.
public struct IslaViajeMinima: View {
    public let datos: DatosDeViaje
    public init(datos: DatosDeViaje) { self.datos = datos }
    public var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.2), lineWidth: 2.5)
            Circle().trim(from: 0, to: datos.llegado ? 1 : datos.progreso)
                .stroke(ColoresViaje.acento, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: datos.transporte.simbolo)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(ColoresViaje.acento)
        }
        .frame(width: 22, height: 22)
    }
}
