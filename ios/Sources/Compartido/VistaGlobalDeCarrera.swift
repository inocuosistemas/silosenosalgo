import SwiftUI

/**
 PROPUESTA: la vista GLOBAL de la carrera en directo, y el selector para
 cambiar entre ella y la del tramo desde la propia tarjeta.

 La del tramo dice cómo va lo de ahora; esta, cómo va la carrera entera: el
 perfil completo con el punto donde se va y marcas en cada avituallamiento y
 cada corte, lo hecho de lo total, lo que queda por subir hasta meta, el
 próximo corte con su margen y la llegada prevista a meta.

 Todavía no la usa la Actividad: está para verla y decidir
 (`docs/propuestas/carreras/global`).
 */
public enum VistaDeCarrera: String, Codable, Hashable, Sendable {
    case tramo, carrera
}

public struct DatosGlobales: Codable, Hashable, Sendable {
    public var totalKm: Double
    public var posicionKm: Double
    /// El perfil de la carrera entera, en pocas muestras.
    public var perfil: [DatosDeTramo.Muestra]
    /// Los puntos que cierran tramo: sus marcas en el perfil.
    public var marcas: [Marca]
    public var subidaAMetaM: Int
    public var bajadaAMetaM: Int
    public var llegadaAMeta: Date?
    /// El próximo punto con corte, su hora y la llegada prevista a él.
    public var proximoCorte: String?
    public var corte: Date?
    public var previsionAlCorte: Date?

    public struct Marca: Codable, Hashable, Sendable {
        public var km: Double
        public var tipo: TipoDePunto?
        public var conCorte: Bool
        public init(km: Double, tipo: TipoDePunto?, conCorte: Bool) {
            self.km = km
            self.tipo = tipo
            self.conCorte = conCorte
        }
    }

    public init(totalKm: Double, posicionKm: Double, perfil: [DatosDeTramo.Muestra], marcas: [Marca],
                subidaAMetaM: Int, bajadaAMetaM: Int, llegadaAMeta: Date?,
                proximoCorte: String?, corte: Date?, previsionAlCorte: Date?) {
        self.totalKm = totalKm
        self.posicionKm = posicionKm
        self.perfil = perfil
        self.marcas = marcas
        self.subidaAMetaM = subidaAMetaM
        self.bajadaAMetaM = bajadaAMetaM
        self.llegadaAMeta = llegadaAMeta
        self.proximoCorte = proximoCorte
        self.corte = corte
        self.previsionAlCorte = previsionAlCorte
    }

    public var margenMin: Int? {
        guard let p = previsionAlCorte, let c = corte else { return nil }
        return Int((c.timeIntervalSince(p) / 60).rounded())
    }
}

/// El selector de la cabecera: dos pastillas, la elegida encendida. En la
/// Actividad sería un botón (las tarjetas admiten botones desde iOS 17): un
/// toque cambia de vista sin abrir la app.
public struct SelectorDeVista: View {
    public let vista: VistaDeCarrera
    public let numero: Int
    public let deTramos: Int

    public init(vista: VistaDeCarrera, numero: Int, deTramos: Int) {
        self.vista = vista
        self.numero = numero
        self.deTramos = deTramos
    }

    public var body: some View {
        HStack(spacing: 2) {
            pastilla("Tramo \(numero)/\(deTramos)", encendida: vista == .tramo)
            pastilla("Carrera", encendida: vista == .carrera)
        }
        .padding(2)
        .background(Capsule().fill(Color.white.opacity(0.1)))
        .fixedSize()
    }

    private func pastilla(_ t: String, encendida: Bool) -> some View {
        Text(t)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(encendida ? Color(hexContador: "#0f1729") : Color.white.opacity(0.65))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(encendida ? Color(hexContador: "#38bdf8") : .clear))
    }
}

/// El perfil de la carrera entera, con las marcas de los puntos debajo: azul
/// los avituallamientos, ámbar los que tienen corte.
public struct PerfilDeCarrera: View {
    public let datos: DatosGlobales
    public var color: Color = Color(hexContador: "#38bdf8")

    public init(datos: DatosGlobales, color: Color = Color(hexContador: "#38bdf8")) {
        self.datos = datos
        self.color = color
    }

    public var body: some View {
        GeometryReader { g in grafico(g.size) }
    }

    private func grafico(_ tam: CGSize) -> some View {
        let m = datos.perfil
        let alto = tam.height - 12   // lo de abajo, para las marcas
        let total = max(0.001, datos.totalKm)
        let eles = m.map(\.ele)
        let bajo = eles.min() ?? 0, techo = eles.max() ?? 1
        let holgura = max(20, (techo - bajo) * 0.1)
        let yMin = bajo - holgura, yMax = techo + holgura
        let x = { (km: Double) -> CGFloat in CGFloat(km / total) * tam.width }
        let y = { (e: Double) -> CGFloat in alto * CGFloat(1 - (e - yMin) / max(1, yMax - yMin)) }
        let linea = Path { p in
            for (i, s) in m.enumerated() {
                let pt = CGPoint(x: x(s.km), y: y(s.ele))
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
        }
        let area = Path { p in
            p.addPath(linea)
            p.addLine(to: CGPoint(x: x(total), y: alto))
            p.addLine(to: CGPoint(x: 0, y: alto))
            p.closeSubpath()
        }
        let aqui = min(max(datos.posicionKm, 0), total)
        let eleAqui = PerfilDeTramo.altura(en: aqui, m)
        let ambar = Color(hexContador: "#fbbf24")
        return ZStack(alignment: .topLeading) {
            area.fill(Color.white.opacity(0.08))
            linea.stroke(Color.white.opacity(0.28), lineWidth: 1.5)
            area.fill(LinearGradient(colors: [color.opacity(0.5), color.opacity(0.06)],
                                     startPoint: .top, endPoint: .bottom))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            linea.stroke(color, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            // Las marcas: una raya fina hasta el perfil y el icono debajo.
            ForEach(Array(datos.marcas.enumerated()), id: \.offset) { _, marca in
                let tinta = marca.conCorte ? ambar : color
                let pasada = marca.km <= aqui
                Path { p in
                    p.move(to: CGPoint(x: x(marca.km), y: y(PerfilDeTramo.altura(en: marca.km, m))))
                    p.addLine(to: CGPoint(x: x(marca.km), y: alto))
                }
                .stroke(tinta.opacity(pasada ? 0.35 : 0.7), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                Image(systemName: marca.tipo?.simbolo ?? "flag.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(tinta.opacity(pasada ? 0.4 : 1))
                    .position(x: x(marca.km), y: alto + 7)
            }
            Circle().fill(.white)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(color, lineWidth: 3))
                .shadow(color: color.opacity(0.8), radius: 4)
                .position(x: x(aqui), y: y(eleAqui))
        }
    }
}

/// La tarjeta con la vista global.
public struct TarjetaCarreraGlobal: View {
    /// De la del tramo se toma la cabecera: el nombre, el tramo y el reloj.
    public let tramo: DatosDeTramo
    public let global: DatosGlobales

    public init(tramo: DatosDeTramo, global: DatosGlobales) {
        self.tramo = tramo
        self.global = global
    }

    private let apagado = Color.white.opacity(0.6)

    public var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 6) {
                Text(tramo.carrera.uppercased())
                    .font(.system(size: 11, weight: .heavy)).tracking(0.8)
                    .lineLimit(1)
                Spacer(minLength: 4)
                SelectorDeVista(vista: .carrera, numero: tramo.numero, deTramos: tramo.deTramos)
                Spacer(minLength: 4)
                Image(systemName: "stopwatch").font(.system(size: 11)).foregroundStyle(apagado)
                Text(tramo.salida, style: .timer)
                    .font(.system(size: 13, weight: .semibold)).monospacedDigit()
                    .frame(width: 58, alignment: .trailing)
            }
            PerfilDeCarrera(datos: global)
                .frame(height: 56)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                // Con un decimal siempre: en carrera, «21» de 42 no dice si
                // se va por el 21,0 o por el 21,9.
                Text(Self.km(global.posicionKm))
                    .font(.system(size: 20, weight: .bold)).monospacedDigit()
                Text("de \(Self.km(global.totalKm)) km")
                    .font(.caption).foregroundStyle(apagado)
                Label("\(global.subidaAMetaM.formatted()) m", systemImage: "arrow.up.right")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.leading, 6)
                Spacer(minLength: 4)
                if let meta = global.llegadaAMeta {
                    (Text("meta ").font(.caption).foregroundColor(apagado)
                     + Text(meta, style: .time).font(.system(size: 13, weight: .bold)))
                }
            }
            if let nombre = global.proximoCorte, let c = global.corte, let m = global.margenMin {
                HStack(spacing: 4) {
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.system(size: 11))
                        .foregroundStyle(ColorDeMargen.de(m))
                    (Text("Corte en \(nombre) ") + Text(c, style: .time))
                        .font(.caption).foregroundStyle(apagado)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(ColorDeMargen.texto(m))
                        .font(.system(size: 13, weight: .bold)).monospacedDigit()
                        .foregroundStyle(ColorDeMargen.de(m))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .foregroundStyle(.white)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// Km de carrera: siempre con un decimal y coma.
    static func km(_ v: Double) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.numberStyle = .decimal
        f.groupingSeparator = "."
        f.decimalSeparator = ","
        f.minimumFractionDigits = 1
        f.maximumFractionDigits = 1
        return f.string(from: NSNumber(value: v)) ?? "\(v)"
    }
}
