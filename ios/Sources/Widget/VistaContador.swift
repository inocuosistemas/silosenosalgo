import SwiftUI
import WidgetKit

/// Cómo se pinta un contador en el widget. La misma vista para los dos
/// tamaños: el mediano solo añade el cartel de fondo y la fecha larga.
struct VistaContador: View {
    let entrada: EntradaContador
    @Environment(\.widgetFamily) private var tamano

    var body: some View {
        if let c = entrada.contador {
            contenido(c)
        } else {
            VStack(spacing: 4) {
                Text("Sin carreras")
                    .font(.system(size: 15, weight: .bold))
                Text("Apúntate a una o crea tu cuenta atrás")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(8)
        }
    }

    private func contenido(_ c: Contador) -> some View {
        let color = Color(hexContador: c.color)
        let fecha = c.fechaVigente(desde: entrada.date)
        let pasada = fecha <= entrada.date
        return ZStack(alignment: .topLeading) {
            if tamano == .systemMedium, let foto = c.foto, let img = imagen(foto) {
                // El cartel, oscurecido: es fondo, no protagonista. Lo que se
                // tiene que leer de un vistazo es el número.
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .overlay(Color.black.opacity(0.55))
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(c.nombre)
                            .font(.system(size: tamano == .systemMedium ? 16 : 14, weight: .bold))
                            .lineLimit(2)
                        Text(fecha, format: fechaCorta(c))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    if let emoji = c.emoji {
                        Text(emoji).font(.system(size: tamano == .systemMedium ? 24 : 20))
                    }
                }
                Spacer(minLength: 2)
                if pasada {
                    // Ya ha salido: el número sigue, ahora hacia arriba. Es la
                    // diferencia entre un widget que se apaga el día de la
                    // carrera y uno que ese día es el que más se mira.
                    Text("desde la salida")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text(fecha, style: .timer)
                        .font(.system(size: tamano == .systemMedium ? 40 : 30, weight: .heavy, design: .rounded))
                        .foregroundStyle(color)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                } else {
                    cuentaAtras(c, hasta: fecha, color: color)
                }
            }
            .padding(tamano == .systemMedium ? 14 : 11)
        }
    }

    /// El número grande: el reloj del sistema en el último día, y los días y
    /// las horas escritos antes (ver `ContadorWidget`).
    @ViewBuilder
    private func cuentaAtras(_ c: Contador, hasta fecha: Date, color: Color) -> some View {
        let faltan = fecha.timeIntervalSince(entrada.date)
        let conHora = c.conHora
        VStack(alignment: .leading, spacing: 1) {
            if c.estilo == .completo && conHora && faltan > 24 * 3600 {
                // DÍAS : HH:MM:SS, con los segundos corriendo. El truco está en
                // el corte (ver `diasYCorte`): el reloj del sistema cuenta
                // hasta la MISMA hora de la carrera del día que falta, así que
                // lo que enseña es justo las horas, minutos y segundos del día
                // a medias. Los días son texto, y bajan solos porque la tanda
                // siguiente se pide en ese corte.
                let (dias, corte) = c.diasYCorte(desde: entrada.date)
                NumeroCuentaAtras(
                    dias: dias, corte: corte, prefijoHoras: c.prefijoHoras(desde: entrada.date),
                    color: color,
                    cuerpo: tamano == .systemMedium ? 56 : 34,
                    etiqueta: tamano == .systemMedium ? 10 : 9,
                    colorEtiqueta: .secondary
                )
            } else if faltan <= 24 * 3600 && conHora {
                Text(fecha, style: .timer)
                    .font(.system(size: tamano == .systemMedium ? 44 : 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(color)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text("para la salida")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            } else {
                let dias = Int(faltan / 86_400)
                let horas = Int((faltan - Double(dias) * 86_400) / 3600)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(dias)")
                        .font(.system(size: tamano == .systemMedium ? 46 : 36, weight: .heavy, design: .rounded))
                        .foregroundStyle(color)
                    Text(dias == 1 ? "día" : "días")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                    if conHora && dias < 30 {
                        Text("\(horas) h")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.secondary)
                    }
                }
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            }
        }
    }

    private func fechaCorta(_ c: Contador) -> Date.FormatStyle {
        c.conHora
            ? .dateTime.day().month(.abbreviated).hour().minute()
            : .dateTime.day().month(.abbreviated).year()
    }

    private func imagen(_ nombre: String) -> UIImage? {
        UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent(nombre).path)
    }
}
