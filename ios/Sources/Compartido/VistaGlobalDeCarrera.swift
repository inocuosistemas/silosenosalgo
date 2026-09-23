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
    case tramo, carrera, corredores
}

/// Otro corredor, en su km, para pintarlo en el perfil con su emoji.
public struct CorredorEnPerfil: Codable, Hashable, Sendable {
    public var km: Double
    public var emoji: String
    public var nombre: String
    public var lider: Bool

    public init(km: Double, emoji: String, nombre: String, lider: Bool = false) {
        self.km = km
        self.emoji = emoji
        self.nombre = nombre
        self.lider = lider
    }
}

/// Los demás: los que se tienen cerca y el primero, con la posición propia.
/// Llegan del servidor cuando hay cobertura; `actualizado` dice de cuándo son.
public struct DatosCorredores: Codable, Hashable, Sendable {
    public var posicion: Int?
    public var de: Int
    public var actualizado: Date
    public var corredores: [CorredorEnPerfil]

    public init(posicion: Int?, de: Int, actualizado: Date, corredores: [CorredorEnPerfil]) {
        self.posicion = posicion
        self.de = de
        self.actualizado = actualizado
        self.corredores = corredores
    }
}

public struct DatosGlobales: Codable, Hashable, Sendable {
    /// Desde dónde se pinta el perfil: 0 en la vista de la carrera entera; en
    /// la de corredores, unos km antes de donde se va (ver `ventana`).
    public var inicioKm: Double = 0
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
            // La tercera, solo un icono: con tres palabras no cabe en la
            // cabecera junto al nombre de la carrera y el reloj.
            Image(systemName: "person.2.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(vista == .corredores ? Color(hexContador: "#0f1729") : Color.white.opacity(0.65))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Capsule().fill(vista == .corredores ? Color(hexContador: "#38bdf8") : .clear))
        }
        .padding(2)
        .background(Capsule().fill(Color.white.opacity(0.1)))
        .fixedSize()
    }

    private func pastilla(_ t: String, encendida: Bool) -> some View {
        Text(t)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(encendida ? Color(hexContador: "#0f1729") : Color.white.opacity(0.65))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(encendida ? Color(hexContador: "#38bdf8") : .clear))
    }
}

/// El perfil de la carrera entera, con las marcas de los puntos debajo: azul
/// los avituallamientos, ámbar los que tienen corte.
public struct PerfilDeCarrera: View {
    public let datos: DatosGlobales
    public var color: Color = Color(hexContador: "#38bdf8")
    /// Los demás corredores, con su emoji encima del perfil.
    public var corredores: [CorredorEnPerfil] = []

    public init(datos: DatosGlobales, color: Color = Color(hexContador: "#38bdf8"),
                corredores: [CorredorEnPerfil] = []) {
        self.datos = datos
        self.color = color
        self.corredores = corredores
    }

    /// A qué altura va cada emoji: si dos caen casi en el mismo sitio, el
    /// segundo sube un piso para que no se tapen (hasta dos pisos: con tres, el
    /// de arriba del todo se metía en la cabecera).
    static func pisos(_ xs: [CGFloat], separacion: CGFloat = 15) -> [Int] {
        var ultimoEnPiso: [CGFloat] = []
        return xs.map { x in
            for (p, ultimo) in ultimoEnPiso.enumerated() where x - ultimo >= separacion {
                ultimoEnPiso[p] = x
                return p
            }
            if ultimoEnPiso.count < 2 { ultimoEnPiso.append(x); return ultimoEnPiso.count - 1 }
            return 1
        }
    }

    public var body: some View {
        GeometryReader { g in grafico(g.size) }
    }

    private func grafico(_ tam: CGSize) -> some View {
        let m = datos.perfil
        let alto = tam.height - 12   // lo de abajo, para las marcas
        let inicio = datos.inicioKm
        let total = max(inicio + 0.001, datos.totalKm)
        let eles = m.map(\.ele)
        let bajo = eles.min() ?? 0, techo = eles.max() ?? 1
        let holgura = max(20, (techo - bajo) * 0.1)
        let yMin = bajo - holgura, yMax = techo + holgura
        let x = { (km: Double) -> CGFloat in CGFloat((km - inicio) / (total - inicio)) * tam.width }
        let y = { (e: Double) -> CGFloat in alto * CGFloat(1 - (e - yMin) / max(1, yMax - yMin)) }
        let linea = Path { p in
            for (i, s) in m.enumerated() {
                let pt = CGPoint(x: x(s.km), y: y(s.ele))
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
        }
        let area = Path { p in
            p.addPath(linea)
            p.addLine(to: CGPoint(x: x(m.last?.km ?? total), y: alto))
            p.addLine(to: CGPoint(x: x(m.first?.km ?? inicio), y: alto))
            p.closeSubpath()
        }
        let aqui = min(max(datos.posicionKm, inicio), total)
        let eleAqui = PerfilDeTramo.altura(en: aqui, m)
        let ambar = Color(hexContador: "#fbbf24")
        let marcas = datos.marcas.filter { $0.km >= inicio && $0.km <= total }
        let dentro = corredores.filter { $0.km >= inicio && $0.km <= total }
        let porDelante = corredores.filter { $0.km > total }.max { $0.km < $1.km }
        let porDetras = corredores.filter { $0.km < inicio }.min { $0.km < $1.km }
        return ZStack(alignment: .topLeading) {
            area.fill(Color.white.opacity(0.08))
            linea.stroke(Color.white.opacity(0.28), lineWidth: 1.5)
            area.fill(LinearGradient(colors: [color.opacity(0.5), color.opacity(0.06)],
                                     startPoint: .top, endPoint: .bottom))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            linea.stroke(color, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                .mask(alignment: .leading) { Rectangle().frame(width: x(aqui)) }
            // Las marcas: una raya fina hasta el perfil y el icono debajo.
            ForEach(Array(marcas.enumerated()), id: \.offset) { _, marca in
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
            // Los demás, con su emoji encima de su punto del perfil.
            let orden = dentro.sorted { $0.km < $1.km }
            let pisos = Self.pisos(orden.map { x($0.km) })
            ForEach(Array(orden.enumerated()), id: \.offset) { i, c in
                let cx = x(c.km)
                let cy = y(PerfilDeTramo.altura(en: c.km, m))
                Circle().fill(Color.white.opacity(0.8)).frame(width: 4, height: 4)
                    .position(x: cx, y: cy)
                VStack(spacing: -2) {
                    if c.lider {
                        Image(systemName: "crown.fill").font(.system(size: 7))
                            .foregroundStyle(Color(hexContador: "#fbbf24"))
                    }
                    Text(c.emoji).font(.system(size: 12))
                }
                // Nunca por encima del perfil: ahí empieza la cabecera.
                .position(x: cx, y: max(7, cy - 11 - CGFloat(pisos[i]) * 14))
            }
            // Los que quedan fuera de lo que se pinta, en el borde, con lo
            // que se llevan: el primero suele estar muy lejos.
            if let c = porDelante {
                // Abajo, sobre el relleno: arriba tapaba a los del borde.
                bordeFuera(c, km: c.km - datos.posicionKm, derecha: true)
                    .position(x: tam.width - 36, y: alto - 9)
            }
            if let c = porDetras {
                bordeFuera(c, km: datos.posicionKm - c.km, derecha: false)
                    .position(x: 36, y: alto - 9)
            }
            Circle().fill(.white)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(color, lineWidth: 3))
                .shadow(color: color.opacity(0.8), radius: 4)
                .position(x: x(aqui), y: y(eleAqui))
        }
    }

    private func bordeFuera(_ c: CorredorEnPerfil, km: Double, derecha: Bool) -> some View {
        HStack(spacing: 2) {
            if !derecha { Image(systemName: "arrow.left").font(.system(size: 8, weight: .bold)) }
            if c.lider {
                Image(systemName: "crown.fill").font(.system(size: 7))
                    .foregroundStyle(Color(hexContador: "#fbbf24"))
            }
            Text(c.emoji).font(.system(size: 11))
            Text("\(derecha ? "+" : "−")\(TarjetaCarreraGlobal.km(km)) km")
                .font(.system(size: 9, weight: .semibold)).monospacedDigit()
            if derecha { Image(systemName: "arrow.right").font(.system(size: 8, weight: .bold)) }
        }
        .foregroundStyle(.white.opacity(0.85))
        .padding(.horizontal, 5).padding(.vertical, 1)
        .background(Capsule().fill(Color.black.opacity(0.35)))
        .fixedSize()
    }
}

/// La tarjeta con la vista global.
public struct TarjetaCarreraGlobal: View {
    /// De la del tramo se toma la cabecera: el nombre, el tramo y el reloj.
    public let tramo: DatosDeTramo
    public let global: DatosGlobales
    /// Con los demás corredores: la tercera vista.
    public var corredores: DatosCorredores?
    /// Lo que se pinta en la vista de corredores: solo la zona de alrededor,
    /// unos km por delante y por detrás. A escala de la carrera entera, cuatro
    /// corredores en kilómetro y medio caían en trece puntos de pantalla, uno
    /// encima de otro.
    public var ventana: DatosGlobales?
    /// La hora de ahora, para saber si todavía no se ha salido.
    public var ahora: Date

    public init(tramo: DatosDeTramo, global: DatosGlobales, corredores: DatosCorredores? = nil,
                ventana: DatosGlobales? = nil, ahora: Date = Date()) {
        self.tramo = tramo
        self.global = global
        self.corredores = corredores
        self.ventana = ventana
        self.ahora = ahora
    }

    private var antesDeSalir: Bool { tramo.salida > ahora }

    private let apagado = Color.white.opacity(0.6)

    public var body: some View {
        VStack(spacing: 4) {
            // Sin el icono del cronómetro y con las letras más juntas: con el
            // selector de tres partes, el nombre de la carrera se cortaba.
            HStack(spacing: 6) {
                Text(tramo.carrera.uppercased())
                    .font(.system(size: 11, weight: .heavy)).tracking(0.3)
                    .lineLimit(1)
                Spacer(minLength: 4)
                SelectorDeVista(vista: corredores == nil ? .carrera : .corredores,
                                numero: tramo.numero, deTramos: tramo.deTramos)
                // Antes de la salida el reloj no va aquí: la cuenta atrás va
                // en grande abajo, que es lo que se mira en ese momento.
                if !antesDeSalir {
                    Text(tramo.salida, style: .timer)
                        .font(.system(size: 13, weight: .semibold)).monospacedDigit()
                        .frame(width: 56, alignment: .trailing)
                }
            }
            PerfilDeCarrera(datos: corredores != nil ? (ventana ?? global) : global,
                            corredores: corredores?.corredores ?? [])
                .frame(height: corredores == nil ? 56 : 62)
            if let corredores {
                filasDeCorredores(corredores)
            } else {
                filasDeCarrera
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .foregroundStyle(.white)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// La posición, y quién va justo delante y justo detrás.
    @ViewBuilder
    private func filasDeCorredores(_ c: DatosCorredores) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if let p = c.posicion {
                Text("\(p).º").font(.system(size: 20, weight: .bold)).monospacedDigit()
                Text("de \(c.de)").font(.caption).foregroundStyle(apagado)
            }
            Spacer(minLength: 4)
            (Text("actualizado ") + Text(c.actualizado, style: .time))
                .font(.caption2).foregroundStyle(apagado)
        }
        let delante = c.corredores.filter { $0.km > global.posicionKm }.min { $0.km < $1.km }
        let detras = c.corredores.filter { $0.km <= global.posicionKm }.max { $0.km < $1.km }
        HStack(spacing: 10) {
            if let d = delante {
                Text("\(d.emoji) \(d.nombre) ") + Text("\(Self.km(d.km - global.posicionKm)) km").bold()
                    + Text(" delante").foregroundColor(apagado)
            }
            Spacer(minLength: 4)
            if let t = detras {
                Text("\(t.emoji) \(t.nombre) ") + Text("\(Self.km(global.posicionKm - t.km)) km").bold()
                    + Text(" detrás").foregroundColor(apagado)
            }
        }
        .font(.caption)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    @ViewBuilder
    private var filasDeCarrera: some View {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if antesDeSalir {
                    Text("Salida en").font(.caption).foregroundStyle(apagado)
                    Text(tramo.salida, style: .timer)
                        .font(.system(size: 20, weight: .bold)).monospacedDigit()
                        .fixedSize()
                } else {
                    // Con un decimal siempre: en carrera, «21» de 42 no dice
                    // si se va por el 21,0 o por el 21,9.
                    Text(Self.km(global.posicionKm))
                        .font(.system(size: 20, weight: .bold)).monospacedDigit()
                    Text("de \(Self.km(global.totalKm)) km")
                        .font(.caption).foregroundStyle(apagado)
                }
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
