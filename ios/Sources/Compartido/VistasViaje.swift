import SwiftUI
import UIKit

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
    /// El nombre del viaje, si tiene: «Viaje a Japón».
    public var titulo: String?
    public var origen: LugarDeViaje
    public var destino: LugarDeViaje
    public var transporte: TransporteDeViaje
    public var colores: ColoresDeViaje
    public var restanteKm: Double
    public var progreso: Double
    public var llegada: Date?
    public var llegado: Bool
    /// Hace rato que no hay posición buena: se dice, en vez de enseñar como
    /// actual un número que puede ser de hace una hora.
    public var sinSenal: Bool
    public var actualizado: Date

    public init(titulo: String? = nil, origen: LugarDeViaje, destino: LugarDeViaje,
                transporte: TransporteDeViaje, colores: ColoresDeViaje = .porDefecto,
                restanteKm: Double, progreso: Double, llegada: Date? = nil,
                llegado: Bool = false, sinSenal: Bool = false, actualizado: Date = Date()) {
        self.titulo = titulo
        self.origen = origen
        self.destino = destino
        self.transporte = transporte
        self.colores = colores
        self.restanteKm = restanteKm
        self.progreso = progreso
        self.llegada = llegada
        self.llegado = llegado
        self.sinSenal = sinSenal
        self.actualizado = actualizado
    }

    /// El título, si lo hay y no está en blanco.
    public var tituloVisible: String? {
        guard let t = titulo?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    public var pintura: PinturaDeViaje { PinturaDeViaje(colores) }
}

/**
 Los colores ya resueltos para pintar: los elegidos, y los que se SACAN de
 ellos para que todo se lea sea cual sea la elección.

 El texto va claro sobre un fondo oscuro y oscuro sobre uno claro; y el icono de
 la chapa, igual respecto a la chapa. Dejándolos fijos en blanco, un fondo
 amarillo o un trayecto blanco se comían las letras o el avión.
 */
public struct PinturaDeViaje {
    public let fondo: Color
    public let trayecto: Color
    /// El final del degradado del trayecto; el mismo si es de un solo color.
    public let trayectoFin: Color
    public let texto: Color
    public let apagado: Color
    /// El del icono dentro de la chapa.
    public let sobreChapa: Color

    private static let oscuro = Color(red: 0.06, green: 0.09, blue: 0.16)

    public init(_ c: ColoresDeViaje) {
        fondo = Color(hexContador: c.fondo)
        trayecto = Color(hexContador: c.trayecto)
        trayectoFin = Color(hexContador: c.trayecto2 ?? c.trayecto)
        texto = Self.luminancia(c.fondo) > 0.5 ? Self.oscuro : .white
        apagado = texto.opacity(0.6)
        sobreChapa = Self.luminancia(c.trayecto2 ?? c.trayecto) > 0.5 ? Self.oscuro : .white
    }

    /// Lo claro que se ve un color, de 0 a 1: la luminancia relativa de las
    /// normas de accesibilidad, donde el verde pesa mucho más que el azul.
    public static func luminancia(_ hex: String) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(Color(hexContador: hex)).getRed(&r, green: &g, blue: &b, alpha: &a)
        func lineal(_ v: CGFloat) -> Double {
            let v = Double(v)
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b)
    }
}

public enum ColoresViaje {
    /// Los kilómetros como se escriben aquí: sin decimales en cuanto pasan de
    /// diez, que un vuelo no se mide en metros; con uno cuando quedan pocos.
    ///
    /// Con el punto de los millares SIEMPRE, y no el del idioma del móvil: en
    /// español el sistema no separa los de cuatro cifras («4389» pero
    /// «10.437»), y en un número que va bajando se veía aparecer y desaparecer
    /// el punto.
    public static func km(_ v: Double) -> String {
        let f = NumberFormatter()
        // Con un idioma fijo y neutro, y los separadores puestos a mano. Con
        // el del móvil en español el sistema NO separa los de cuatro cifras
        // aunque se le pida: en el iPhone salía «2224». En el simulador, en
        // inglés, sí salía el punto, y por eso no se vio antes.
        f.locale = Locale(identifier: "en_US_POSIX")
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
    public let pintura: PinturaDeViaje
    /// El tamaño de la chapa del icono; la barra se deja ese margen a cada lado
    /// para que la chapa no se salga ni al salir ni al llegar.
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
            let r = chapa / 2
            let medio = g.size.height / 2
            let x = r + (g.size.width - chapa) * CGFloat(min(1, max(0, progreso)))
            ZStack(alignment: .topLeading) {
                // Lo que falta, punteado.
                Path { p in
                    p.move(to: CGPoint(x: r, y: medio))
                    p.addLine(to: CGPoint(x: g.size.width - r, y: medio))
                }
                .stroke(pintura.texto.opacity(0.3),
                        style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.5, 6]))
                // Lo hecho, lleno.
                Capsule()
                    .fill(LinearGradient(colors: [pintura.trayecto, pintura.trayectoFin],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(0, x - r), height: 4)
                    .offset(x: r, y: medio - 2)
                // Los dos extremos: el de salida lleno, el de llegada hueco.
                Circle().fill(pintura.trayecto)
                    .frame(width: 8, height: 8)
                    .position(x: r, y: medio)
                Circle().strokeBorder(pintura.texto.opacity(0.7), lineWidth: 1.5)
                    .frame(width: 10, height: 10)
                    .position(x: g.size.width - r, y: medio)
                // Y el que viaja.
                Image(systemName: transporte.simbolo)
                    .font(.system(size: chapa * 0.5, weight: .bold))
                    .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
                    .foregroundStyle(pintura.sobreChapa)
                    .frame(width: chapa, height: chapa)
                    .background(Circle().fill(pintura.trayectoFin))
                    .shadow(color: pintura.trayectoFin.opacity(0.5), radius: 5)
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

    private var pintura: PinturaDeViaje { datos.pintura }

    public var body: some View {
        Group {
            switch variante {
            case .a: variantaA
            case .b: varianteB
            }
        }
        .padding(.horizontal, 16)
        // Con título se aprieta un poco: el sistema recorta la tarjeta de la
        // pantalla de bloqueo a 160 puntos de alto, y sin apretar no cabía.
        .padding(.vertical, datos.tituloVisible == nil ? 14 : 12)
        .foregroundStyle(pintura.texto)
        // Con el texto de accesibilidad más grande la tarjeta crecía y el
        // sistema la cortaba por abajo, justo por los kilómetros. Crece hasta
        // un punto y ahí se queda.
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// El título del viaje, en una línea, encima de todo. Si es largo se corta
    /// con puntos suspensivos: una segunda línea no cabe en el alto.
    @ViewBuilder
    private var cabecera: some View {
        if let t = datos.tituloVisible {
            Text(t)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(pintura.texto.opacity(0.85))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A: los códigos grandes arriba, en cada punta, como en un panel de salidas.
    private var variantaA: some View {
        let conTitulo = datos.tituloVisible != nil
        return VStack(spacing: conTitulo ? 7 : 10) {
            cabecera
            HStack(alignment: .top) {
                ExtremoDeViaje(lugar: datos.origen, alineado: .leading,
                               apagado: pintura.apagado, tamano: conTitulo ? 24 : 28)
                Spacer(minLength: 8)
                ExtremoDeViaje(lugar: datos.destino, alineado: .trailing,
                               apagado: pintura.apagado, tamano: conTitulo ? 24 : 28)
            }
            BarraDeViaje(progreso: datos.llegado ? 1 : datos.progreso,
                         transporte: datos.transporte, pintura: pintura)
            PieDeViaje(datos: datos)
        }
    }

    /// B: más apretada, con los códigos a los lados de la barra.
    private var varianteB: some View {
        VStack(alignment: .leading, spacing: 8) {
            cabecera
            HStack(spacing: 10) {
                Text(datos.origen.abreviatura)
                    .font(.system(size: 22, weight: .heavy)).tracking(1)
                BarraDeViaje(progreso: datos.llegado ? 1 : datos.progreso,
                             transporte: datos.transporte, pintura: pintura, chapa: 24)
                Text(datos.destino.abreviatura)
                    .font(.system(size: 22, weight: .heavy)).tracking(1)
            }
            Text("\(datos.origen.nombre) → \(datos.destino.nombre)")
                .font(.caption).foregroundStyle(pintura.apagado).lineLimit(1)
            PieDeViaje(datos: datos)
        }
    }
}

/// Lo que falta y a qué hora se llega; o que ya se ha llegado; o que no hay
/// señal y desde cuándo. Suelto porque lo usan la tarjeta y la isla abierta.
public struct PieDeViaje: View {
    public let datos: DatosDeViaje
    /// En la isla abierta el fondo es siempre negro, sea cual sea el elegido.
    public var sobreNegro = false
    public var tamano: CGFloat = 22

    public init(datos: DatosDeViaje, sobreNegro: Bool = false, tamano: CGFloat = 22) {
        self.datos = datos
        self.sobreNegro = sobreNegro
        self.tamano = tamano
    }

    public var body: some View {
        let p = datos.pintura
        let apagado = sobreNegro ? Color.white.opacity(0.6) : p.apagado
        if datos.llegado {
            HStack {
                Label("Has llegado a \(datos.destino.nombre)", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(p.trayectoFin)
                Spacer()
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(ColoresViaje.km(datos.restanteKm))
                    .font(.system(size: tamano, weight: .bold)).monospacedDigit()
                Text(sobreNegro ? "km" : "km en línea recta")
                    .font(.caption).foregroundStyle(apagado)
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
                        .font(.caption).foregroundStyle(apagado)
                }
            }
        }
    }
}

/// Una punta del viaje: el código en grande y la ciudad debajo.
public struct ExtremoDeViaje: View {
    public let lugar: LugarDeViaje
    public let alineado: HorizontalAlignment
    public var apagado: Color = .white.opacity(0.6)
    public var tamano: CGFloat = 28

    public init(lugar: LugarDeViaje, alineado: HorizontalAlignment,
                apagado: Color = .white.opacity(0.6), tamano: CGFloat = 28) {
        self.lugar = lugar
        self.alineado = alineado
        self.apagado = apagado
        self.tamano = tamano
    }

    public var body: some View {
        VStack(alignment: alineado, spacing: 0) {
            Text(lugar.abreviatura)
                .font(.system(size: tamano, weight: .heavy)).tracking(1)
            Text(lugar.nombre)
                .font(.caption).foregroundStyle(apagado).lineLimit(1)
        }
    }
}

/// La Isla Dinámica abierta. Su fondo es SIEMPRE negro —lo pone el sistema—,
/// así que el texto va en blanco y de lo elegido solo manda el trayecto.
public struct IslaViajeAbierta: View {
    public let datos: DatosDeViaje
    public init(datos: DatosDeViaje) { self.datos = datos }

    /// Los colores elegidos, pero con el fondo negro de la isla: el texto sale
    /// blanco aunque el fondo elegido para la tarjeta sea claro.
    private var pintura: PinturaDeViaje {
        var c = datos.colores
        c.fondo = "#000000"
        return PinturaDeViaje(c)
    }

    public var body: some View {
        VStack(spacing: 10) {
            // En el centro de arriba, bajo la cámara: el único sitio de la isla
            // abierta donde cabe una línea de texto.
            if let t = datos.tituloVisible {
                Text(t)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(1)
            }
            HStack(alignment: .top) {
                ExtremoDeViaje(lugar: datos.origen, alineado: .leading, tamano: 24)
                Spacer()
                ExtremoDeViaje(lugar: datos.destino, alineado: .trailing, tamano: 24)
            }
            BarraDeViaje(progreso: datos.llegado ? 1 : datos.progreso,
                         transporte: datos.transporte, pintura: pintura, chapa: 24)
            PieDeViaje(datos: datos, sobreNegro: true, tamano: 18)
        }
        .foregroundStyle(.white)
    }
}

/// La Isla Dinámica recogida: el icono a un lado y lo que falta al otro.
public struct IslaViajeInicio: View {
    public let datos: DatosDeViaje
    public init(datos: DatosDeViaje) { self.datos = datos }
    public var body: some View {
        Image(systemName: datos.transporte.simbolo)
            .font(.system(size: 14, weight: .bold))
            .scaleEffect(x: datos.transporte.miraALaIzquierda ? -1 : 1)
            .foregroundStyle(datos.pintura.trayectoFin)
    }
}

public struct IslaViajeFin: View {
    public let datos: DatosDeViaje
    public init(datos: DatosDeViaje) { self.datos = datos }
    public var body: some View {
        Group {
            if datos.llegado {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(datos.pintura.trayectoFin)
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
        let p = datos.pintura
        ZStack {
            Circle().stroke(Color.white.opacity(0.2), lineWidth: 2.5)
            Circle().trim(from: 0, to: datos.llegado ? 1 : datos.progreso)
                .stroke(p.trayectoFin, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: datos.transporte.simbolo)
                .font(.system(size: 9, weight: .bold))
                .scaleEffect(x: datos.transporte.miraALaIzquierda ? -1 : 1)
                .foregroundStyle(p.trayectoFin)
        }
        .frame(width: 22, height: 22)
    }
}
