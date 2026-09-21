import SwiftUI
import PhotosUI

/**
 La pantalla de las CUENTAS ATRÁS: lo que enseña el widget.

 Arriba, la tarjeta tal como va a quedar —se ve cambiar mientras se toca el
 color o el emoji, que es lo que hace que elegir tenga sentido—; debajo, la
 lista: primero las carreras en las que estás (su nombre y su salida los pone
 el servidor, y de ellas solo se cambia el aspecto) y después las tuyas, que se
 crean aquí con su fecha.
 */
struct ContadoresView: View {
    @State private var contadores: [Contador] = []
    @State private var editando: Contador?
    @State private var nuevo = false

    var body: some View {
        List {
            Section {
                // El que enseña el widget: el más cercano de los que siguen
                // vivos. Con `contadores.first` salía el primero de la lista, y
                // uno ya pasado y puesto a esconderse iba delante —la vista
                // previa enseñaba justo lo que el widget no enseña—.
                if let primero = contadores.first(where: { $0.vigente() }) ?? contadores.first {
                    // El alto lo pone quien la coloca: dentro del carrusel la
                    // tarjeta se estira al hueco del formato que toque.
                    TarjetaContador(contador: primero)
                        .frame(height: 140)
                        .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                        .listRowBackground(Color.clear)
                }
            } header: {
                Text("EN LA PANTALLA DE INICIO").font(.caption).foregroundStyle(Theme.slate400)
            } footer: {
                // De pie de sección y no de fila con su propia caja: como fila
                // llevaba el fondo y las esquinas de la lista, que no casaban
                // con la tarjeta de arriba —que va suelta, sin fondo—, y se veía
                // un recuadro pegado por debajo.
                Text("Mantén pulsado el widget en la pantalla de inicio para elegir cuál de estas cuentas atrás enseña. Puedes poner varios, cada uno con la suya.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }

            if !deCarrera.isEmpty {
                Section {
                    ForEach(deCarrera) { c in
                        Button { editando = c } label: { FilaContador(contador: c) }
                    }
                } header: {
                    Text("TUS CARRERAS").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("La fecha y el nombre los pone la carrera: si la organización mueve la salida, la cuenta atrás se mueve con ella. Aquí eliges cómo se ve.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)
            }

            Section {
                ForEach(propios) { c in
                    Button { editando = c } label: { FilaContador(contador: c) }
                }
                .onDelete { indices in
                    var lista = propios
                    lista.remove(atOffsets: indices)
                    ContadoresDeCarreras.guardaPropios(lista)
                    recarga()
                }
                Button { nuevo = true } label: {
                    Label("Añadir una cuenta atrás", systemImage: "plus.circle.fill")
                }
            } header: {
                Text("LAS TUYAS").font(.caption).foregroundStyle(Theme.slate400)
            }
            .listRowBackground(Theme.slate900)
        }
        .navigationTitle("Cuenta atrás")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        .onAppear(perform: recarga)
        .sheet(item: $editando) { c in
            EditorContador(contador: c) { guardado in
                if let guardado {
                    if guardado.origen == .carrera { ContadoresDeCarreras.guardaAspecto(guardado) }
                    else { ContadoresDeCarreras.guardaPropios(propios.map { $0.id == guardado.id ? guardado : $0 }) }
                }
                recarga()
            }
        }
        .sheet(isPresented: $nuevo) {
            EditorContador(contador: Contador(nombre: "", fecha: Date().addingTimeInterval(7 * 86_400))) { guardado in
                if let guardado, !guardado.nombre.trimmingCharacters(in: .whitespaces).isEmpty {
                    ContadoresDeCarreras.guardaPropios(propios + [guardado])
                }
                recarga()
            }
        }
    }

    private var deCarrera: [Contador] { contadores.filter { $0.origen == .carrera } }
    private var propios: [Contador] { contadores.filter { $0.origen == .propio } }

    private func recarga() {
        let ahora = Date()
        // Los que siguen vivos primero, el más cercano arriba; los ya pasados
        // al final, el último en pasar primero.
        contadores = AlmacenContadores.lee().contadores.sorted { a, b in
            let va = a.vigente(ahora), vb = b.vigente(ahora)
            if va != vb { return va }
            return va
                ? a.fechaVigente(desde: ahora) < b.fechaVigente(desde: ahora)
                : a.fechaVigente(desde: ahora) > b.fechaVigente(desde: ahora)
        }
    }
}

/// Una fila de la lista: la marca, el nombre y lo que falta.
private struct FilaContador: View {
    let contador: Contador

    var body: some View {
        HStack(spacing: 10) {
            if contador.origen == .carrera, let emoji = contador.emoji {
                MarcaContador(emoji: emoji, color: Color(hexContador: contador.color), tam: 34)
            } else {
                ZStack {
                    Circle().fill(Color(hexContador: contador.color).opacity(0.25))
                    Text(contador.emoji ?? "⏱").font(.system(size: 17))
                }
                .frame(width: 34, height: 34)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(contador.nombre.isEmpty ? "Sin nombre" : contador.nombre)
                    .foregroundStyle(Theme.slate100)
                Text(cuando)
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.slate400)
        }
    }

    private var cuando: String {
        let fecha = contador.fechaVigente()
        let faltan = fecha.timeIntervalSinceNow
        let dias = Int(faltan / 86_400)
        if faltan <= 0 { return "ya ha salido" }
        if dias >= 1 { return "faltan \(dias) \(dias == 1 ? "día" : "días")" }
        return "hoy, a las " + fecha.formatted(.dateTime.hour().minute())
    }
}

/// Los TRES formatos del widget, uno cada vez y pasando el dedo: el pequeño,
/// el mediano y el grande, tal como van a quedar en la pantalla de inicio.
///
/// Uno debajo de otro no cabía —o salían de juguete— y lado a lado obligaba a
/// encogerlos hasta no distinguir el número. Pasando el dedo, cada uno se
/// enseña a un tamaño que se parece al de verdad, y los puntitos dicen que hay
/// más. El primero que se enseña es el mediano, que es el que casi todo el
/// mundo pone.
struct CarruselDeFormatos: View {
    let contador: Contador
    @State private var pagina = 1

    var body: some View {
        VStack(spacing: 6) {
            TabView(selection: $pagina) {
                ForEach(Array([VistaPreviaWidget.Formato.pequeno, .mediano, .grande].enumerated()), id: \.offset) { i, f in
                    VistaPreviaWidget(contador: contador, formato: f)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: 186)
            // Los puntitos, puestos a mano: los del TabView se pintan blancos
            // sobre blanco en unos sitios y no se ven.
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(i == pagina ? Theme.slate100 : Theme.slate400.opacity(0.4))
                        .frame(width: 6, height: 6)
                }
            }
            Text(["Widget pequeño", "Widget mediano", "Widget grande"][pagina])
                .font(.caption2)
                .foregroundStyle(Theme.slate400)
        }
    }

}

/// Un contador pintado como lo pinta el widget en cada formato.
///
/// Se dibuja al TAMAÑO DE VERDAD del widget y luego se encoge entero, en vez
/// de dibujarlo pequeño: así las proporciones son las que van a salir en la
/// pantalla de inicio —el número ocupa lo que va a ocupar— y no una versión
/// con las letras gigantes. (La vista del widget vive en su objetivo y aquí no
/// se puede usar, así que arma las mismas piezas.)
struct VistaPreviaWidget: View {
    enum Formato {
        case pequeno, mediano, grande

        /// Lo que mide de verdad en un iPhone corriente.
        var tamano: CGSize {
            switch self {
            case .pequeno: return CGSize(width: 158, height: 158)
            case .mediano: return CGSize(width: 338, height: 158)
            case .grande: return CGSize(width: 338, height: 354)
            }
        }
    }

    let contador: Contador
    let formato: Formato
    /// El hueco donde tiene que caber.
    var hueco = CGSize(width: 320, height: 176)

    var body: some View {
        let tam = formato.tamano
        let escala = min(hueco.width / tam.width, hueco.height / tam.height)
        pieza
            .frame(width: tam.width, height: tam.height)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .scaleEffect(escala)
            .frame(width: tam.width * escala, height: tam.height * escala)
    }

    @ViewBuilder
    private var pieza: some View {
        switch formato {
        case .grande:
            TarjetaGrande(contador: contador, foto: foto, tamano: formato.tamano)
                .background(Color(red: 0.06, green: 0.09, blue: 0.16))
        case .pequeno, .mediano:
            if contador.estilo == .compacto {
                let f = contador.fechaVigente()
                let cuenta = TarjetaCompacta.cuenta(hasta: f, desde: Date())
                TarjetaCompacta(
                    nombre: contador.nombre, dias: cuenta.dias, horas: cuenta.horas, pasada: cuenta.pasada,
                    fecha: f, conHora: contador.conHora,
                    color: contador.color, color2: contador.color2, emoji: contador.emoji,
                    conAro: contador.origen == .carrera,
                    foto: formato == .mediano ? foto : nil,
                    compacta: formato == .pequeno
                )
            } else {
                TarjetaContador(contador: contador, compacta: formato == .pequeno)
                    .background(Color.black)
            }
        }
    }

    private var foto: UIImage? {
        contador.foto.flatMap { UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent($0).path) }
    }
}

/// La tarjeta, igual que en el widget: es lo que se está eligiendo.
struct TarjetaContador: View {
    let contador: Contador
    /// A tamaño de widget pequeño: sin foto y con el número más apretado.
    var compacta: Bool = false

    var body: some View {
        // Se vuelve a calcular cada poco: los segundos los lleva el reloj del
        // sistema, pero los días, el cero de las horas y el paso a "desde la
        // salida" son cuentas nuestras, y con la pantalla abierta se quedaban
        // en lo que valían al entrar.
        TimelineView(.periodic(from: .now, by: 15)) { reloj in
            tarjeta(ahora: reloj.date)
        }
    }

    private func tarjeta(ahora: Date) -> some View {
        Group {
            if contador.estilo == .compacto {
                let f = contador.fechaVigente(desde: ahora)
                let cuenta = TarjetaCompacta.cuenta(hasta: f, desde: ahora)
                TarjetaCompacta(
                    nombre: contador.nombre, dias: cuenta.dias, horas: cuenta.horas, pasada: cuenta.pasada,
                    fecha: f, conHora: contador.conHora,
                    color: contador.color, color2: contador.color2, emoji: contador.emoji,
                    conAro: contador.origen == .carrera,
                    foto: compacta ? nil : contador.foto.flatMap { UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent($0).path) },
                    compacta: compacta,
                    tamano: compacta ? TamanoWidget.pequeno : TamanoWidget.mediano
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                completa(ahora: ahora)
            }
        }
    }

    private func completa(ahora: Date) -> some View {
        let color = Color(hexContador: contador.color)
        let fecha = contador.fechaVigente(desde: ahora)
        let pasada = fecha <= ahora
        let faltan = max(0, fecha.timeIntervalSince(ahora))
        let dias = Int(faltan / 86_400)
        let horas = Int((faltan - Double(dias) * 86_400) / 3600)
        let conFoto = contador.foto != nil
        return ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        // Con TOPE de líneas y encogiendo: sin él, un nombre
                        // largo en la tarjeta pequeña se iba a tres líneas, se
                        // comía la fecha y acababa debajo del número. Y del
                        // tamaño que le toca a cada formato, que es el que usa
                        // el widget: aquí se ponía siempre el del mediano.
                        Text(contador.nombre.isEmpty ? "Sin nombre" : contador.nombre)
                            .font(.system(size: compacta ? 14 : 16, weight: .bold)).foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                        Text(fecha, format: contador.conHora
                            ? .dateTime.day().month(.abbreviated).hour().minute()
                            : .dateTime.day().month(.abbreviated).year())
                            .font(.system(size: compacta ? 10 : 11)).foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    .shadow(color: .black.opacity(conFoto ? 0.85 : 0), radius: 3, x: 0, y: 1)
                    Spacer()
                    if let emoji = contador.emoji {
                        if contador.origen == .carrera {
                            MarcaContador(emoji: emoji, color: color, tam: compacta ? 28 : 34)
                        } else {
                            Text(emoji).font(.system(size: compacta ? 20 : 24))
                        }
                    }
                }
                // El nombre y la fecha se quedan con su sitio; lo que cede es
                // el número, que ya sabe encogerse.
                .layoutPriority(1)
                Spacer(minLength: 6)
                // La misma cuenta que el widget, para que elegir sea ver.
                if pasada {
                    // Ya ha llegado: o cuenta hacia arriba, o se va del widget.
                    if contador.alPasar == .contarArriba {
                        Text("desde la salida")
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                        Text(fecha, style: .timer)
                            .font(.system(size: 40, weight: .bold)).monospacedDigit()
                            .foregroundStyle(color)
                            .lineLimit(1).minimumScaleFactor(0.5)
                            .shadow(color: .black.opacity(conFoto ? 0.8 : 0), radius: 5)
                    } else {
                        Text("Ya ha pasado: el widget deja de enseñarla")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                            .shadow(color: .black.opacity(conFoto ? 0.8 : 0), radius: 3)
                    }
                } else if contador.estilo == .completo && contador.conHora {
                    // También en el último día: 00:hh:mm:ss, no "0 días 0 h".
                    let corte = contador.diasYCorte(desde: ahora).corte
                    NumeroCuentaAtras(
                        dias: dias, corte: corte, prefijoHoras: contador.prefijoHoras(desde: ahora),
                        color: color, cuerpo: compacta ? 38 : 56,
                        etiqueta: compacta ? 9 : 11, colorEtiqueta: .white.opacity(0.6),
                        ancho: (compacta ? TamanoWidget.pequeno.width : TamanoWidget.mediano.width) - (compacta ? 26 : 32),
                        sobreFoto: contador.foto != nil,
                        degradado: contador.color2.map { (contador.color, $0) }
                    )
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(dias)").font(.system(size: 42, weight: .heavy, design: .rounded)).foregroundStyle(color)
                        Text(dias == 1 ? "día" : "días").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                        if contador.conHora { Text("\(horas) h").font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.7)) }
                    }
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .shadow(color: .black.opacity(conFoto ? 0.8 : 0), radius: 5)
                }
            }
            .padding(.horizontal, compacta ? 13 : 16)
            .padding(.vertical, compacta ? 12 : 14)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // La foto, DETRÁS y recortada a la tarjeta: puesta como una capa más,
        // crecía a su tamaño y tapaba el nombre y el número.
        .background {
            if let foto = contador.foto,
               let img = UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent(foto).path) {
                FondoDeFoto(imagen: img)
            } else {
                Theme.slate900
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
