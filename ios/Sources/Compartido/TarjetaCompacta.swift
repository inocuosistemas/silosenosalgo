import SwiftUI
import UIKit

/**
 El contador COMPACTO: la baldosa de color con los días en grande.

 Es la otra manera de mirar lo mismo. La completa (`NumeroCuentaAtras`) es un
 marcador: cuatro columnas y los segundos corriendo, para el día de antes. Esta
 es un calendario de pared: un número enorme que se lee de reojo desde la otra
 punta de la habitación, y debajo, en pequeño, el día que es. A tres meses de
 la carrera, los segundos no le importan a nadie.

 El color del contador aquí no es la tinta, es el FONDO: con el degradado
 puesto, la baldosa se funde de un color al otro, y el número va en blanco, que
 sobre cualquiera de los doce colores se lee.
 */
public struct TarjetaCompacta: View {
    public let nombre: String
    public let dias: Int
    public let horas: Int
    /// Ya ha pasado: en vez de los días que faltan, los que lleva.
    public let pasada: Bool
    public let fecha: Date
    public let conHora: Bool
    public let color: String
    public let color2: String?
    public let emoji: String?
    /// Con marca (las carreras), el emoji va en su aro; sin ella, suelto.
    public let conAro: Bool
    /// El cartel, si lo tiene: va de fondo, con el color por encima.
    public let foto: UIImage?
    /// El alto de la baldosa, para dar tamaño al número.
    public let compacta: Bool

    public init(
        nombre: String, dias: Int, horas: Int, pasada: Bool, fecha: Date, conHora: Bool,
        color: String, color2: String?, emoji: String?, conAro: Bool,
        foto: UIImage? = nil, compacta: Bool = true
    ) {
        self.nombre = nombre
        self.dias = dias
        self.horas = horas
        self.pasada = pasada
        self.fecha = fecha
        self.conHora = conHora
        self.color = color
        self.color2 = color2
        self.emoji = emoji
        self.conAro = conAro
        self.foto = foto
        self.compacta = compacta
    }

    public var body: some View {
        GeometryReader { g in
            let alto = g.size.height
            let cuerpo = min(alto * 0.46, g.size.width * 0.5)
            ZStack(alignment: .topLeading) {
                fondo
                VStack(alignment: .leading, spacing: 0) {
                    Text(nombre.isEmpty ? "Sin nombre" : nombre)
                        .font(.system(size: compacta ? 14 : 16, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text("\(dias)")
                        .font(.system(size: cuerpo, weight: .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.4)
                    Spacer(minLength: 2)
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(etiquetaDias)
                                .font(.system(size: compacta ? 13 : 14, weight: .bold))
                                .foregroundStyle(.white)
                            Text(fecha, format: conHora
                                ? .dateTime.day().month(.abbreviated).hour().minute()
                                : .dateTime.day().month(.defaultDigits).year(.twoDigits))
                                .font(.system(size: compacta ? 11 : 12))
                                .foregroundStyle(.white.opacity(0.75))
                        }
                        Spacer(minLength: 4)
                        if let emoji {
                            if conAro {
                                MarcaContador(emoji: emoji, color: .white, tam: compacta ? 26 : 30)
                            } else {
                                Text(emoji).font(.system(size: compacta ? 22 : 26))
                            }
                        }
                    }
                }
                .shadow(color: .black.opacity(foto == nil ? 0 : 0.7), radius: 3, x: 0, y: 1)
                .padding(compacta ? 13 : 16)
            }
        }
    }

    /// "días" / "día", y con menos de dos días, las horas: a esa distancia un
    /// "0 días" no dice nada y "0 días 7 h" sí.
    private var etiquetaDias: String {
        if pasada { return dias == 1 ? "día desde la salida" : "días desde la salida" }
        if dias == 0 { return horas == 1 ? "hora" : "horas" }
        return dias == 1 ? "día" : "días"
    }

    @ViewBuilder
    private var fondo: some View {
        let a = Color(hexContador: color)
        let b = Color(hexContador: color2 ?? color)
        ZStack {
            if let foto {
                Image(uiImage: foto).resizable().scaledToFill()
                LinearGradient(colors: [a.opacity(0.85), b.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing)
            } else {
                LinearGradient(colors: [a, b], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
    }
}

public extension TarjetaCompacta {
    /// Los días y las horas que faltan (o que han pasado) para una fecha.
    static func cuenta(hasta fecha: Date, desde ahora: Date) -> (dias: Int, horas: Int, pasada: Bool) {
        let d = fecha.timeIntervalSince(ahora)
        let abs = Swift.abs(d)
        let dias = Int(abs / 86_400)
        return (dias, Int((abs - Double(dias) * 86_400) / 3600), d <= 0)
    }
}
