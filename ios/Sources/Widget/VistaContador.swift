import SwiftUI
import WidgetKit

/// Cómo se pinta un contador en el widget, en sus tres tamaños: el pequeño y
/// el mediano son la misma tarjeta (el mediano, con la foto de fondo), y el
/// grande es otro montaje —el cartel arriba, fundiéndose, y la cuenta atrás
/// debajo—, como la tarjeta de «Mis carreras» de la app.
struct VistaContador: View {
    let entrada: EntradaContador
    @Environment(\.widgetFamily) private var tamano

    var body: some View {
        if let c = entrada.contador, c.estilo == .compacto, tamano != .systemLarge {
            // La baldosa de color: el color del contador es el FONDO, no la
            // tinta (ver `TarjetaCompacta`), así que no lleva el fondo de
            // siempre ni el velo de la foto.
            let cuenta = TarjetaCompacta.cuenta(hasta: c.fechaVigente(desde: entrada.date), desde: entrada.date)
            TarjetaCompacta(
                nombre: c.nombre, dias: cuenta.dias, horas: cuenta.horas, pasada: cuenta.pasada,
                fecha: c.fechaVigente(desde: entrada.date), conHora: c.conHora,
                color: c.color, color2: c.color2, emoji: c.emoji, conAro: c.origen == .carrera,
                foto: tamano == .systemMedium ? c.foto.flatMap(imagen) : nil,
                compacta: tamano == .systemSmall
            )
            .containerBackground(for: .widget) { Color.black }
        } else if let c = entrada.contador, tamano == .systemLarge {
            vistaGrande(c)
                .containerBackground(for: .widget) { Color(red: 0.06, green: 0.09, blue: 0.16) }
        } else if let c = entrada.contador {
            contenido(c)
                // La foto va de FONDO DEL WIDGET, no como una capa más: una
                // imagen a "rellenar" metida entre el contenido crece a su
                // tamaño y lo tapa o lo empuja todo. Como fondo, el contenido
                // se coloca igual que sin foto y la imagen se recorta sola.
                .containerBackground(for: .widget) { fondo(c) }
        } else {
            VStack(spacing: 4) {
                Text("Sin carreras")
                    .font(.system(size: 15, weight: .bold))
                Text("Apúntate a una o crea tu cuenta atrás")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(16)
            .containerBackground(for: .widget) { Color.black }
        }
    }

    @ViewBuilder
    private func fondo(_ c: Contador) -> some View {
        if tamano == .systemMedium, let foto = c.foto, let img = imagen(foto) {
            FondoDeFoto(imagen: img)
        } else {
            Color.black
        }
    }

    private func contenido(_ c: Contador) -> some View {
        let color = Color(hexContador: c.color)
        let fecha = c.fechaVigente(desde: entrada.date)
        let pasada = fecha <= entrada.date
        return ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(c.nombre)
                            .font(.system(size: tamano == .systemMedium ? 16 : 14, weight: .bold))
                            .lineLimit(2)
                        Text(fecha, format: fechaCorta(c))
                            .font(.system(size: 11))
                            .foregroundStyle(conFoto(c) ? Color.white.opacity(0.85) : .secondary)
                    }
                    // Arriba la foto va casi sin velo (ver `FondoDeFoto`): el
                    // nombre se sostiene con su propia sombra.
                    .shadow(color: .black.opacity(conFoto(c) ? 0.85 : 0), radius: 3, x: 0, y: 1)
                    Spacer(minLength: 4)
                    if let emoji = c.emoji {
                        // En una carrera, su marca: el emoji con el aro de su color.
                        if c.origen == .carrera {
                            MarcaContador(emoji: emoji, color: color, tam: tamano == .systemMedium ? 34 : 28)
                        } else {
                            Text(emoji).font(.system(size: tamano == .systemMedium ? 24 : 20))
                        }
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
            // Con los márgenes del sistema quitados (ver `ContadorWidget`),
            // este es TODO el margen: el de la tarjeta de referencia.
            .padding(.horizontal, tamano == .systemMedium ? 16 : 13)
            .padding(.vertical, tamano == .systemMedium ? 14 : 12)
        }
    }

    /// El número grande: el reloj del sistema en el último día, y los días y
    /// las horas escritos antes (ver `ContadorWidget`).
    @ViewBuilder
    private func cuentaAtras(_ c: Contador, hasta fecha: Date, color: Color) -> some View {
        let faltan = fecha.timeIntervalSince(entrada.date)
        let conHora = c.conHora
        VStack(alignment: .leading, spacing: 1) {
            if c.estilo == .completo && conHora {
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
                    // El tope; la vista lo baja hasta que el número llene el ancho.
                    cuerpo: tamano == .systemSmall ? 38 : 68,
                    etiqueta: tamano == .systemSmall ? 9 : (tamano == .systemLarge ? 11 : 10),
                    colorEtiqueta: .secondary,
                    sobreFoto: conFoto(c),
                    degradado: c.color2.map { (c.color, $0) }
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

    /// Si el número va encima de una foto (solo en el mediano: en el grande la
    /// foto va arriba y el número sobre liso).
    private func conFoto(_ c: Contador) -> Bool {
        tamano == .systemMedium && c.foto.flatMap(imagen) != nil
    }

    /// El widget GRANDE: el cartel arriba, a sangre y fundiéndose con el fondo;
    /// encima de esa fundida, su marca, el nombre y la fecha; y debajo, sobre
    /// liso, "SALIDA EN" y la cuenta atrás a todo el ancho.
    private func vistaGrande(_ c: Contador) -> some View {
        let color = Color(hexContador: c.color)
        let fondo = Color(red: 0.06, green: 0.09, blue: 0.16)
        let fecha = c.fechaVigente(desde: entrada.date)
        let pasada = fecha <= entrada.date
        return GeometryReader { g in
            let altoCartel = g.size.height * 0.56
            VStack(spacing: 0) {
                ZStack(alignment: .bottomLeading) {
                    if let foto = c.foto, let img = imagen(foto) {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFill()
                            .frame(width: g.size.width, height: altoCartel)
                            .clipped()
                    } else {
                        // Sin cartel, su color y su marca: que no se quede en un hueco.
                        LinearGradient(colors: [color.opacity(0.55), color.opacity(0.12)], startPoint: .top, endPoint: .bottom)
                        if let emoji = c.emoji {
                            Group {
                                if c.origen == .carrera {
                                    MarcaContador(emoji: emoji, color: color, tam: 92)
                                } else {
                                    Text(emoji).font(.system(size: 64))
                                }
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .padding(.bottom, 26)
                        }
                    }
                    // La fundida: el cartel se apaga hacia abajo hasta ser el fondo.
                    LinearGradient(
                        stops: [
                            .init(color: fondo.opacity(0), location: 0.3),
                            .init(color: fondo.opacity(0.75), location: 0.72),
                            .init(color: fondo, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                    HStack(alignment: .center, spacing: 8) {
                        if let emoji = c.emoji, c.foto.flatMap(imagen) != nil {
                            if c.origen == .carrera {
                                MarcaContador(emoji: emoji, color: color, tam: 38)
                            } else {
                                Text(emoji).font(.system(size: 26))
                            }
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
                }
                .frame(width: g.size.width, height: altoCartel)

                VStack(spacing: 6) {
                    Text(pasada ? "DESDE LA SALIDA" : (c.origen == .carrera ? "SALIDA EN" : "FALTAN"))
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(2)
                        .foregroundStyle(.white.opacity(0.55))
                    if pasada {
                        Text(fecha, style: .timer)
                            .font(.system(size: 52, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(color)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            .multilineTextAlignment(.center)
                    } else {
                        cuentaAtras(c, hasta: fecha, color: color)
                    }
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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
