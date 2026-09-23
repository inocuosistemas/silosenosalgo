import SwiftUI
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 La carrera en directo, por TRAMOS. En una carrera lo que importa no
 es cuánto queda hasta meta, sino el tramo en el que se está: cuánto falta al
 próximo punto, cuánto sube y baja todavía, qué hay allí (agua, comida, bolsa)
 y con cuánto margen se llega al corte.

 Todo sale de datos que la app ya tiene mientras se comparte: el km de la ruta
 en el que se va (`trackKm`, lo calcula el móvil), y el plan descargado, con la
 altitud de cada punto de la traza, los puntos con su km, su tipo y su hora de
 corte, y la hora prevista de paso.

 Se eligió la forma A, con el perfil grande (`docs/propuestas/carreras`). Lo
 arranca y lo alimenta `CarreraEnDirecto`, en la app.
 */
public enum TipoDePunto: String, Codable, Hashable, Sendable, CaseIterable {
    case control, liquido, solido, completo, bolsa, meta

    public var simbolo: String {
        switch self {
        case .control: return "flag.fill"
        case .liquido: return "drop.fill"
        case .solido: return "fork.knife"
        case .completo: return "cup.and.saucer.fill"
        case .bolsa: return "bag.fill"
        case .meta: return "flag.checkered"
        }
    }

    public var nombre: String {
        switch self {
        case .control: return "Control"
        case .liquido: return "Líquido"
        case .solido: return "Sólido"
        case .completo: return "Completo"
        case .bolsa: return "Bolsa"
        case .meta: return "Meta"
        }
    }
}

public struct PuntoDeCarrera: Codable, Hashable, Sendable {
    public var nombre: String
    public var km: Double
    public var tipo: TipoDePunto?

    public init(nombre: String, km: Double, tipo: TipoDePunto? = nil) {
        self.nombre = nombre
        self.km = km
        self.tipo = tipo
    }
}

/// Lo que enseña la tarjeta del tramo. Es también lo que se le manda a la
/// Actividad en cada actualización, así que va justo: el sistema no admite más
/// de 4 KB, y por eso el perfil del tramo va en unas pocas muestras.
public struct DatosDeTramo: Codable, Hashable, Sendable {
    public var carrera: String
    public var numero: Int
    public var deTramos: Int
    public var desde: PuntoDeCarrera
    public var hasta: PuntoDeCarrera
    /// Km de la ruta en el que se va.
    public var posicionKm: Double
    /// La altitud del tramo, muestreada: (km, metros).
    public var perfil: [Muestra]
    public var subidaRestanteM: Int
    public var bajadaRestanteM: Int
    /// Hora de salida de la carrera, para el reloj de tiempo en carrera.
    public var salida: Date
    /// A qué hora se prevé llegar al próximo punto.
    public var prevision: Date?
    /// Hora de corte del próximo punto, si tiene.
    public var corte: Date?
    /// Ya en meta.
    public var enMeta: Bool = false
    /// Cuándo se calculó: con la última posición buena.
    public var actualizado: Date = Date()
    /// Hace rato que no llega nada (lo decide el sistema: ver `CarreraActividad`).
    /// Se dice, en vez de enseñar como actual un margen que puede ser viejo.
    public var sinSenal: Bool = false

    public struct Muestra: Codable, Hashable, Sendable {
        public var km: Double
        public var ele: Double
        public init(km: Double, ele: Double) { self.km = km; self.ele = ele }
    }

    public init(carrera: String, numero: Int, deTramos: Int, desde: PuntoDeCarrera, hasta: PuntoDeCarrera,
                posicionKm: Double, perfil: [Muestra], subidaRestanteM: Int, bajadaRestanteM: Int,
                salida: Date, prevision: Date?, corte: Date?, enMeta: Bool = false,
                actualizado: Date = Date()) {
        self.carrera = carrera
        self.numero = numero
        self.deTramos = deTramos
        self.desde = desde
        self.hasta = hasta
        self.posicionKm = posicionKm
        self.perfil = perfil
        self.subidaRestanteM = subidaRestanteM
        self.bajadaRestanteM = bajadaRestanteM
        self.salida = salida
        self.prevision = prevision
        self.corte = corte
        self.enMeta = enMeta
        self.actualizado = actualizado
    }

    public var restanteKm: Double { max(0, hasta.km - posicionKm) }

    /// Minutos de margen entre la llegada prevista al próximo punto y su corte.
    public var margenMin: Int? {
        guard let p = prevision, let c = corte else { return nil }
        return Int((c.timeIntervalSince(p) / 60).rounded())
    }
}

/// El color del margen al corte: holgado, justo, o en peligro.
public enum ColorDeMargen {
    public static func de(_ min: Int?) -> Color {
        guard let m = min else { return .white.opacity(0.6) }
        if m >= 30 { return Color(hexContador: "#4ade80") }
        if m >= 10 { return Color(hexContador: "#fbbf24") }
        return Color(hexContador: "#f87171")
    }

    public static func texto(_ min: Int) -> String {
        let signo = min >= 0 ? "+" : "−"
        let a = abs(min)
        return a >= 60 ? "\(signo)\(a / 60) h \(a % 60) min" : "\(signo)\(a) min"
    }
}

/**
 El perfil del tramo: el terreno en gris, lo ya corrido en color, y un punto
 donde se va. La altura se escala al tramo, no a la carrera entera: así se ve
 la forma de lo que queda por delante, que es lo que se quiere saber.
 */
public struct PerfilDeTramo: View {
    public let datos: DatosDeTramo
    public var color: Color = Color(hexContador: "#38bdf8")

    public init(datos: DatosDeTramo, color: Color = Color(hexContador: "#38bdf8")) {
        self.datos = datos
        self.color = color
    }

    public var body: some View {
        GeometryReader { g in grafico(g.size) }
    }

    private func grafico(_ tam: CGSize) -> some View {
        let m = datos.perfil
        let kmIni = m.first?.km ?? datos.desde.km
        let kmFin = m.last?.km ?? datos.hasta.km
        let eles = m.map(\.ele)
        let bajo = (eles.min() ?? 0), alto = (eles.max() ?? 1)
        let margen = max(20, (alto - bajo) * 0.12)
        let yMin = bajo - margen, yMax = alto + margen
        let x = { (km: Double) -> CGFloat in CGFloat((km - kmIni) / max(0.001, kmFin - kmIni)) * tam.width }
        let y = { (e: Double) -> CGFloat in tam.height * CGFloat(1 - (e - yMin) / max(1, yMax - yMin)) }
        let linea = Path { p in
            for (i, s) in m.enumerated() {
                let pt = CGPoint(x: x(s.km), y: y(s.ele))
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
        }
        let area = Path { p in
            p.addPath(linea)
            p.addLine(to: CGPoint(x: x(kmFin), y: tam.height))
            p.addLine(to: CGPoint(x: x(kmIni), y: tam.height))
            p.closeSubpath()
        }
        let aqui = min(max(datos.posicionKm, kmIni), kmFin)
        let eleAqui = Self.altura(en: aqui, m)
        return ZStack(alignment: .topLeading) {
            area.fill(Color.white.opacity(0.08))
            linea.stroke(Color.white.opacity(0.28), lineWidth: 1.5)
            // Lo corrido, en color.
            area.fill(LinearGradient(colors: [color.opacity(0.55), color.opacity(0.08)],
                                     startPoint: .top, endPoint: .bottom))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            linea.stroke(color, style: StrokeStyle(lineWidth: 2.5, lineJoin: .round))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            // Donde se va.
            Circle().fill(.white)
                .frame(width: 11, height: 11)
                .overlay(Circle().stroke(color, lineWidth: 3))
                .shadow(color: color.opacity(0.8), radius: 4)
                .position(x: x(aqui), y: y(eleAqui))
        }
    }

    static func altura(en km: Double, _ m: [DatosDeTramo.Muestra]) -> Double {
        guard let i = m.firstIndex(where: { $0.km >= km }) else { return m.last?.ele ?? 0 }
        guard i > 0 else { return m[0].ele }
        let a = m[i - 1], b = m[i]
        let t = (km - a.km) / max(0.0001, b.km - a.km)
        return a.ele + (b.ele - a.ele) * t
    }
}

/// La tarjeta del tramo en la pantalla de bloqueo. Dos formas para elegir.
public struct TarjetaTramo: View {
    public enum Forma: Sendable { case perfilGrande, proximoPunto }

    public let datos: DatosDeTramo
    public let forma: Forma
    /// Con el selector de vista (Tramo / Carrera) en la cabecera, marcando cuál.
    public var selector: VistaDeCarrera?

    public init(datos: DatosDeTramo, forma: Forma, selector: VistaDeCarrera? = nil) {
        self.datos = datos
        self.forma = forma
        self.selector = selector
    }

    private let apagado = Color.white.opacity(0.6)
    private let acento = Color(hexContador: "#38bdf8")

    public var body: some View {
        Group {
            switch forma {
            case .perfilGrande: perfilGrande
            case .proximoPunto: proximoPunto
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .foregroundStyle(.white)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// Cabecera: la carrera, el tramo y el tiempo en carrera, que corre solo.
    private var cabecera: some View {
        HStack(spacing: 6) {
            Text(datos.carrera.uppercased())
                .font(.system(size: 11, weight: .heavy)).tracking(selector == nil ? 0.8 : 0.3)
                .lineLimit(1)
            if let selector {
                Spacer(minLength: 4)
                SelectorDeVista(vista: selector, numero: datos.numero, deTramos: datos.deTramos)
            } else {
                Text("· TRAMO \(datos.numero)/\(datos.deTramos)")
                    .font(.system(size: 11, weight: .semibold)).tracking(0.5)
                    .foregroundStyle(apagado)
            }
            Spacer(minLength: 4)
            // Con el selector no cabe el icono: el nombre se cortaba.
            if selector == nil {
                Image(systemName: "stopwatch").font(.system(size: 11)).foregroundStyle(apagado)
            }
            Group {
                if datos.enMeta, let fin = datos.prevision, fin > datos.salida {
                    // En meta, el reloj se para en la hora de llegada.
                    Text(timerInterval: datos.salida...fin, pauseTime: fin, countsDown: false)
                } else {
                    Text(datos.salida, style: .timer)
                }
            }
            .font(.system(size: 13, weight: .semibold)).monospacedDigit()
            .frame(width: 58, alignment: .trailing)
        }
    }

    private func icono(_ p: PuntoDeCarrera, tam: CGFloat = 12) -> some View {
        Image(systemName: p.tipo?.simbolo ?? "mappin")
            .font(.system(size: tam, weight: .bold))
            .foregroundStyle(p.tipo == nil ? apagado : acento)
    }

    private var margen: some View {
        Group {
            if datos.sinSenal {
                // Sin posiciones nuevas, el margen de hace un rato no vale.
                VStack(alignment: .trailing, spacing: 0) {
                    Text("sin señal").font(.caption2.weight(.semibold))
                    (Text("desde ") + Text(datos.actualizado, style: .time)).font(.caption2)
                }
                .foregroundStyle(Color.orange)
            } else if let m = datos.margenMin, let c = datos.corte {
                VStack(alignment: .trailing, spacing: 0) {
                    (Text("corte ") + Text(c, style: .time))
                        .font(.caption2).foregroundStyle(apagado)
                    Text(ColorDeMargen.texto(m))
                        .font(.system(size: 13, weight: .bold)).monospacedDigit()
                        .foregroundStyle(ColorDeMargen.de(m))
                }
            } else if let p = datos.prevision {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("llegada").font(.caption2).foregroundStyle(apagado)
                    Text(p, style: .time).font(.system(size: 13, weight: .bold))
                }
            }
        }
    }

    /// A: el perfil del tramo, grande, y debajo lo que queda.
    private var perfilGrande: some View {
        VStack(spacing: 6) {
            cabecera
            PerfilDeTramo(datos: datos, color: acento)
                // Un pelo más bajo con el selector, que es más alto que la
                // línea de texto a la que sustituye: si no, se pasaba de 160.
                .frame(height: selector == nil ? 50 : 47)
            HStack(spacing: 4) {
                icono(datos.desde, tam: 10)
                Text(datos.desde.nombre).lineLimit(1)
                Spacer(minLength: 6)
                Text(datos.hasta.nombre).lineLimit(1)
                icono(datos.hasta, tam: 10)
            }
            .font(.caption2).foregroundStyle(apagado)
            if datos.enMeta {
                HStack {
                    Label("En meta", systemImage: "flag.checkered")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(acento)
                    Spacer()
                }
            } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                (Text(ColoresViaje.km(datos.restanteKm)).font(.system(size: 20, weight: .bold))
                 + Text(" km").font(.caption).foregroundColor(apagado))
                    .monospacedDigit()
                Label("\(datos.subidaRestanteM) m", systemImage: "arrow.up.right")
                    .font(.system(size: 13, weight: .semibold))
                Label("\(datos.bajadaRestanteM) m", systemImage: "arrow.down.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(apagado)
                Spacer(minLength: 4)
                margen
            }
            }
        }
    }

    /// B: el PRÓXIMO PUNTO en grande —qué hay y cuánto falta— y el perfil en
    /// una tira abajo.
    private var proximoPunto: some View {
        VStack(spacing: 7) {
            cabecera
            HStack(alignment: .center, spacing: 10) {
                icono(datos.hasta, tam: 20)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(acento.opacity(0.18)))
                VStack(alignment: .leading, spacing: 0) {
                    Text(datos.hasta.nombre)
                        .font(.system(size: 16, weight: .bold)).lineLimit(1)
                    HStack(spacing: 8) {
                        Text("\(ColoresViaje.km(datos.restanteKm)) km").monospacedDigit()
                        Label("\(datos.subidaRestanteM)", systemImage: "arrow.up.right")
                        Label("\(datos.bajadaRestanteM)", systemImage: "arrow.down.right")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(apagado)
                }
                Spacer(minLength: 4)
                margen
            }
            PerfilDeTramo(datos: datos, color: acento)
                .frame(height: 30)
        }
    }
}

/// La Isla Dinámica recogida: lo que falta al próximo punto, y el margen.
public struct IslaTramoInicio: View {
    public let datos: DatosDeTramo
    public init(datos: DatosDeTramo) { self.datos = datos }
    public var body: some View {
        HStack(spacing: 4) {
            Image(systemName: datos.hasta.tipo?.simbolo ?? "figure.run")
                .foregroundStyle(Color(hexContador: "#38bdf8"))
            Text("\(ColoresViaje.km(datos.restanteKm))").monospacedDigit()
        }
        .font(.system(size: 14, weight: .semibold))
    }
}

public struct IslaTramoFin: View {
    public let datos: DatosDeTramo
    public init(datos: DatosDeTramo) { self.datos = datos }
    public var body: some View {
        Group {
            if let m = datos.margenMin {
                Text(m >= 0 ? "+\(m)′" : "−\(abs(m))′")
                    .foregroundStyle(ColorDeMargen.de(m))
            } else {
                Text(datos.salida, style: .timer).frame(width: 50)
            }
        }
        .font(.system(size: 14, weight: .semibold)).monospacedDigit()
    }
}

#if canImport(ActivityKit)
/// La Actividad de la carrera: lo fijo es el nombre; lo que cambia, el tramo.
public struct CarreraAtributos: ActivityAttributes {
    public typealias ContentState = DatosDeTramo
    public var carrera: String
    public init(carrera: String) { self.carrera = carrera }
}
#endif
