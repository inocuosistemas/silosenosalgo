import SwiftUI

/**
 La FORMA de la ruta por carretera, dibujada en la tarjeta en vez de la barra
 recta: lo recorrido en color, lo que falta punteado y el vehículo donde va.

 Los mapas no caben en una Actividad en Directo (no puede cargar teselas), pero
 una línea sí: la forma viaja en unos 110 caracteres (ver `Carreteras.forma`).
 */
public struct FormaDeRuta: View {
    /// Los puntos de la forma, repartidos por km, en una caja de 0 a 1.
    public let puntos: [CGPoint]
    public let progreso: Double
    public let transporte: TransporteDeViaje
    public let pintura: PinturaDeViaje
    public var chapa: CGFloat = 22

    public init(forma: String, progreso: Double, transporte: TransporteDeViaje,
                pintura: PinturaDeViaje, chapa: CGFloat = 22) {
        self.puntos = Self.decodifica(forma)
        self.progreso = progreso
        self.transporte = transporte
        self.pintura = pintura
        self.chapa = chapa
    }

    public static func decodifica(_ forma: String) -> [CGPoint] {
        guard let d = Data(base64Encoded: forma) else { return [] }
        let b = [UInt8](d)
        return stride(from: 0, to: b.count - 1, by: 2).map { CGPoint(x: CGFloat(b[$0]) / 255, y: CGFloat(b[$0 + 1]) / 255) }
    }

    public var body: some View {
        GeometryReader { g in dibujo(g.size) }
    }

    private func dibujo(_ tam: CGSize) -> some View {
        let r = chapa / 2
        let xs = puntos.map(\.x), ys = puntos.map(\.y)
        let x0 = xs.min() ?? 0, y0 = ys.min() ?? 0
        let ancho = max(0.01, (xs.max() ?? 1) - x0), alto = max(0.01, (ys.max() ?? 1) - y0)
        let hueco = CGSize(width: max(1, tam.width - chapa), height: max(1, tam.height - chapa))
        // Con su proporción, pero dejándola estirar hasta el triple: una ruta
        // de norte a sur en un hueco ancho y bajo si no se quedaba en un palito.
        let s = min(hueco.width / ancho, hueco.height / alto)
        let sx = min(hueco.width / ancho, s * 3), sy = min(hueco.height / alto, s * 3)
        let dx = r + (hueco.width - ancho * sx) / 2, dy = r + (hueco.height - alto * sy) / 2
        let pts = puntos.map { CGPoint(x: dx + ($0.x - x0) * sx, y: dy + ($0.y - y0) * sy) }
        let p = min(1, max(0, progreso))
        let pos = Self.punto(en: p, pts)
        let hecho = Path { c in
            guard let primero = pts.first else { return }
            c.move(to: primero)
            let hasta = Double(pts.count - 1) * p
            for i in 1..<max(1, Int(hasta) + 1) where i < pts.count { c.addLine(to: pts[i]) }
            c.addLine(to: pos)
        }
        let entera = Path { c in
            guard let primero = pts.first else { return }
            c.move(to: primero)
            for q in pts.dropFirst() { c.addLine(to: q) }
        }
        return ZStack(alignment: .topLeading) {
            entera.stroke(pintura.texto.opacity(0.3),
                          style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [0.5, 5]))
            hecho.stroke(LinearGradient(colors: [pintura.trayecto, pintura.trayectoFin],
                                        startPoint: .leading, endPoint: .trailing),
                         style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            if let a = pts.first {
                Circle().fill(pintura.trayecto).frame(width: 8, height: 8).position(a)
            }
            if let b = pts.last {
                Circle().strokeBorder(pintura.texto.opacity(0.7), lineWidth: 1.5)
                    .frame(width: 10, height: 10).position(b)
            }
            Image(systemName: transporte.simbolo)
                .font(.system(size: chapa * 0.5, weight: .bold))
                .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
                .foregroundStyle(pintura.sobreChapa(en: p))
                .frame(width: chapa, height: chapa)
                .background(Circle().fill(pintura.trayecto(en: p)))
                .shadow(color: pintura.trayecto(en: p).opacity(0.5), radius: 4)
                .position(pos)
        }
    }

    /// El punto de la forma a una fracción del camino (los puntos van
    /// repartidos por km, así que la fracción es la del recorrido).
    static func punto(en p: Double, _ pts: [CGPoint]) -> CGPoint {
        guard pts.count > 1 else { return pts.first ?? .zero }
        let f = Double(pts.count - 1) * p
        let i = min(pts.count - 2, Int(f))
        let t = CGFloat(f - Double(i))
        return CGPoint(x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t)
    }
}

/// La tarjeta de un viaje por carretera con la forma de su ruta: los códigos a
/// los lados, la ruta en medio, los nombres debajo y lo que queda al pie.
public struct TarjetaViajeRuta: View {
    public let datos: DatosDeViaje
    public let forma: String

    public init(datos: DatosDeViaje, forma: String) {
        self.datos = datos
        self.forma = forma
    }

    private var pintura: PinturaDeViaje { datos.pintura }

    public var body: some View {
        VStack(spacing: 6) {
            if let t = datos.tituloVisible {
                Text(t)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(pintura.texto.opacity(0.85))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 8) {
                Text(datos.origen.abreviatura).font(.system(size: 24, weight: .heavy)).tracking(1).fixedSize()
                FormaDeRuta(forma: forma, progreso: datos.llegado ? 1 : datos.progreso,
                            transporte: datos.transporte, pintura: pintura)
                    .frame(height: 52)
                Text(datos.destino.abreviatura).font(.system(size: 24, weight: .heavy)).tracking(1).fixedSize()
            }
            HStack {
                Text(datos.origen.nombre).frame(maxWidth: .infinity, alignment: .leading)
                Text(datos.destino.nombre).frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.caption).foregroundStyle(pintura.apagado).lineLimit(1).minimumScaleFactor(0.8)
            PieDeViaje(datos: datos)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .foregroundStyle(pintura.texto)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }
}
