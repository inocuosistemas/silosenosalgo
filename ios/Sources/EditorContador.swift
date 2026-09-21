import SwiftUI
import PhotosUI

/**
 Crear o cambiar una cuenta atrás.

 Arriba la tarjeta, viva: cada color, cada emoji y cada foto se ven ahí mismo
 antes de guardar. Debajo, lo que se puede cambiar — y en una carrera, solo el
 aspecto: su nombre y su salida son de la organización.
 */
struct EditorContador: View {
    @State var contador: Contador
    /// Devuelve el contador guardado, o nil si se cancela.
    let alTerminar: (Contador?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var foto: PhotosPickerItem?

    private var esDeCarrera: Bool { contador.origen == .carrera }

    /// La paleta: las de la casa y las que uno se ha guardado.
    @State private var muestras: [MuestraColor] = ColoresContador.muestras()
    /// El permiso de notificaciones, denegado: hay que decirlo o el interruptor
    /// se apaga solo sin explicación.
    @State private var sinPermiso = false
    /// La foto recién elegida (o la guardada), esperando encuadre.
    @State private var aEncuadrar: UIImage?

    private func relleno(_ m: MuestraColor) -> LinearGradient {
        LinearGradient(
            colors: [Color(hexContador: m.a), Color(hexContador: m.b ?? m.a)],
            startPoint: .leading, endPoint: .trailing
        )
    }

    private func elegida(_ m: MuestraColor) -> Bool {
        contador.color.lowercased() == m.a.lowercased() && contador.color2?.lowercased() == m.b?.lowercased()
    }

    private var colorA: Binding<Color> {
        Binding(
            get: { Color(hexContador: contador.color) },
            set: { contador.color = ColoresContador.hex(de: $0) }
        )
    }

    private var colorB: Binding<Color> {
        Binding(
            get: { Color(hexContador: contador.color2 ?? contador.color) },
            set: { nuevo in
                let hex = ColoresContador.hex(de: nuevo)
                // El mismo en las dos puntas no es un degradado.
                contador.color2 = hex.lowercased() == contador.color.lowercased() ? nil : hex
            }
        )
    }

    /// De dónde sale el fondo de un contador de carrera.
    private enum Fondo: Hashable { case cartel, propia, ninguno }
    /// Si se ha pedido "una foto mía" y aún no se ha elegido: sin esto, elegirla
    /// en el desplegable volvía sola a "sin foto" porque todavía no hay fichero.
    @State private var quierePropia = false

    /// La carrera de este contador, para su cartel.
    private var evento: EventSummary? {
        guard let id = contador.eventoId else { return nil }
        return TrackingStore.shared.events.first { $0.id == id }
    }
    private var tieneCartel: Bool { evento?.hasPhoto == true }

    private var fondo: Binding<Fondo> {
        Binding(
            get: {
                if contador.usaCartel { return .cartel }
                return (contador.foto != nil || quierePropia) ? .propia : .ninguno
            },
            set: { nuevo in
                switch nuevo {
                case .cartel:
                    quierePropia = false
                    quitaFotoPropia()
                    contador.usaCartel = true
                    if let ev = evento {
                        let nombre = CartelesDeContadores.nombre(de: ev)
                        if CartelesDeContadores.existe(nombre) { contador.foto = nombre }
                        else { Task { if let n = await CartelesDeContadores.copia(ev) { await MainActor.run { contador.foto = n } } } }
                    }
                case .propia:
                    contador.usaCartel = false
                    if contador.foto?.hasPrefix("cartel-") == true { contador.foto = nil }
                    quierePropia = true
                case .ninguno:
                    quierePropia = false
                    contador.usaCartel = false
                    quitaFotoPropia()
                    contador.foto = nil
                }
            }
        )
    }

    /// Borra la foto propia del disco (el cartel no: es de la carrera y se reutiliza).
    private func quitaFotoPropia() {
        guard let foto = contador.foto, !foto.hasPrefix("cartel-") else { return }
        try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(foto))
        contador.foto = nil
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    // Los tres formatos, pasando el dedo (ver `CarruselDeFormatos`).
                    CarruselDeFormatos(contador: contador)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                        .listRowBackground(Color.clear)
                }

                if !esDeCarrera {
                    Section {
                        TextField("Nombre", text: $contador.nombre)
                        DatePicker(
                            "Fecha",
                            selection: $contador.fecha,
                            displayedComponents: contador.conHora ? [.date, .hourAndMinute] : [.date]
                        )
                        Toggle("Con hora", isOn: $contador.conHora)
                        Toggle("Cada año", isOn: $contador.anual)
                    } footer: {
                        Text("Sin hora se cuentan días enteros. «Cada año» la vuelve a poner en el mismo día del año que viene en cuanto pasa.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                Section {
                    // El color, en una fila: se elige mirando la tarjeta de
                    // arriba, no leyendo un nombre. Detrás de los de la casa,
                    // las combinaciones que uno se ha ido guardando.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(muestras, id: \.self) { m in
                                Button {
                                    contador.color = m.a
                                    contador.color2 = m.b
                                } label: {
                                    Circle()
                                        .fill(relleno(m))
                                        .frame(width: 28, height: 28)
                                        // El elegido, con un aro POR FUERA y un
                                        // hueco en medio: pegado al borde no se
                                        // veía en el blanco, que es blanco.
                                        .padding(4)
                                        .overlay(Circle().stroke(.white, lineWidth: elegida(m) ? 2 : 0))
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if ColoresContador.guardadas().contains(m) {
                                        Button(role: .destructive) {
                                            ColoresContador.olvida(m)
                                            muestras = ColoresContador.muestras()
                                        } label: { Label("Quitar esta muestra", systemImage: "trash") }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    // El degradado: un color en cada punta. Iguales, un solo
                    // color; distintos, el número se funde de uno a otro.
                    HStack(spacing: 10) {
                        ColorPicker("Color de inicio", selection: colorA, supportsOpacity: false)
                            .labelsHidden()
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(LinearGradient(
                                colors: [Color(hexContador: contador.color), Color(hexContador: contador.color2 ?? contador.color)],
                                startPoint: .leading, endPoint: .trailing
                            ))
                            .frame(height: 30)
                        ColorPicker("Color de fin", selection: colorB, supportsOpacity: false)
                            .labelsHidden()
                    }
                    if contador.color2 != nil {
                        Button("Un solo color") { contador.color2 = nil }
                            .font(.footnote)
                    }
                    Picker("Número", selection: $contador.estilo) {
                        Text("Días").tag(EstiloContador.compacto)
                        Text("Con segundos").tag(EstiloContador.completo)
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        Text("Icono")
                        Spacer()
                        TextField("🏁", text: Binding(
                            get: { contador.emoji ?? "" },
                            set: { contador.emoji = $0.isEmpty ? nil : String($0.suffix(1)) }
                        ))
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                        .font(.system(size: 22))
                    }
                    if esDeCarrera && tieneCartel {
                        // En una carrera el fondo se ELIGE entre tres: su
                        // cartel (que ya está bajado), una foto de uno, o nada.
                        Picker("Fondo", selection: fondo) {
                            Text("El cartel de la carrera").tag(Fondo.cartel)
                            Text("Una foto mía").tag(Fondo.propia)
                            Text("Sin foto").tag(Fondo.ninguno)
                        }
                        if !contador.usaCartel && fondo.wrappedValue == .propia {
                            PhotosPicker(selection: $foto, matching: .images) {
                                Label(contador.foto == nil ? "Elegir la foto" : "Cambiar la foto", systemImage: "photo")
                            }
                            botonEncuadre
                        }
                    } else {
                        PhotosPicker(selection: $foto, matching: .images) {
                            Label(contador.foto == nil ? "Poner una foto de fondo" : "Cambiar la foto", systemImage: "photo")
                        }
                        botonEncuadre
                        if contador.foto != nil {
                            Button(role: .destructive) { quitaFoto() } label: { Text("Quitar la foto") }
                        }
                    }
                } header: {
                    Text("CÓMO SE VE").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("Toca un extremo de la barra para elegir su color: con dos distintos, el número va en degradado, y al guardar la combinación se queda en la paleta. La foto sale de fondo en el widget mediano.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                Section {
                    Toggle("Avisarme cuando llegue", isOn: Binding(
                        get: { contador.aviso },
                        set: { quiere in
                            contador.aviso = quiere
                            // El permiso se pide AQUÍ, al encenderlo, y no al
                            // abrir la app: así se entiende para qué es.
                            if quiere {
                                Task {
                                    let vale = await AvisosDeContadores.pidePermiso()
                                    await MainActor.run { contador.aviso = vale; sinPermiso = !vale }
                                }
                            }
                        }
                    ))
                    if sinPermiso {
                        Text("Las notificaciones están desactivadas para la app. Se activan en Ajustes ▸ SiLoSeNoSalgo ▸ Notificaciones.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                } header: {
                    Text("AVISO").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("Una notificación en este iPhone a la hora exacta. No hace falta tener la app abierta ni cobertura.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                Section {
                    Picker("Cuando llegue el día", selection: $contador.alPasar) {
                        Text("Contar el tiempo desde la salida").tag(AlPasar.contarArriba)
                        Text("Dejar de enseñarla").tag(AlPasar.ocultar)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("CUANDO LLEGUE EL DÍA").font(.caption).foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .navigationTitle(esDeCarrera ? contador.nombre : "Cuenta atrás")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { alTerminar(nil); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        // Lo que se ha montado a mano se queda en la paleta,
                        // para la próxima cuenta atrás.
                        ColoresContador.recuerda(MuestraColor(a: contador.color, b: contador.color2))
                        alTerminar(contador); dismiss()
                    }
                        .disabled(!esDeCarrera && contador.nombre.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onChange(of: foto) { _, nueva in
                guard let nueva else { return }
                Task { await preparaFoto(nueva) }
            }
            // Encuadrar: el widget rellena un hueco muy apaisado, así que hay
            // que poder decir QUÉ trozo de la foto sale (ver `RecortadorDeFoto`).
            .sheet(item: Binding(
                get: { aEncuadrar.map { FotoParaEncuadrar(imagen: $0) } },
                set: { if $0 == nil { aEncuadrar = nil } }
            )) { envoltorio in
                RecortadorDeFoto(imagen: envoltorio.imagen) { recortada in
                    guarda(recortada)
                }
            }
        }
    }

    @ViewBuilder
    private var botonEncuadre: some View {
        if original != nil {
            Button { aEncuadrar = original } label: {
                Label("Ajustar el encuadre", systemImage: "crop")
            }
        }
    }

    /// La foto tal como se eligió, guardada aparte para poder volver a
    /// encuadrarla sin tener que buscarla otra vez en el carrete.
    private var original: UIImage? {
        UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal).path)
    }

    private var nombreOriginal: String { "\(contador.id)-original.jpg" }

    /// Recién elegida del carrete: se guarda el original y se abre el encuadre.
    private func preparaFoto(_ item: PhotosPickerItem) async {
        guard let datos = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: datos) else { return }
        let grande = reducida(img, lado: 1600)
        if let jpeg = grande.jpegData(compressionQuality: 0.85) {
            try? jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal), options: .atomic)
        }
        await MainActor.run { aEncuadrar = grande }
    }

    /// Ya encuadrada: al cajón compartido, reducida.
    private func guarda(_ img: UIImage) {
        let pequena = reducida(img, lado: 900)
        guard let jpeg = pequena.jpegData(compressionQuality: 0.8) else { return }
        let nombre = "\(contador.id).jpg"
        try? jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombre), options: .atomic)
        contador.usaCartel = false
        contador.foto = nombre
        // El nombre no cambia, así que hay que decirle a la vista que la relea.
        contador.fotoVersion = Date().timeIntervalSince1970
    }

    private func reducida(_ img: UIImage, lado: CGFloat) -> UIImage {
        let escala = min(1, lado / max(img.size.width, img.size.height))
        guard escala < 1 else { return img }
        let tamano = CGSize(width: img.size.width * escala, height: img.size.height * escala)
        // A escala 1: el formato por defecto multiplica por la densidad de la
        // pantalla, y los puntos salían el triple de píxeles — justo lo que se
        // quería evitarle al widget.
        let formato = UIGraphicsImageRendererFormat.default()
        formato.scale = 1
        return UIGraphicsImageRenderer(size: tamano, format: formato).image { _ in
            img.draw(in: CGRect(origin: .zero, size: tamano))
        }
    }

    /// (Sin uso desde que hay encuadre; se queda el camino viejo por si acaso.)
    private func guardaFoto(_ item: PhotosPickerItem) async {
        guard let datos = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: datos) else { return }
        let lado: CGFloat = 800
        let escala = min(1, lado / max(img.size.width, img.size.height))
        let tamano = CGSize(width: img.size.width * escala, height: img.size.height * escala)
        // A escala 1: el formato por defecto multiplica por la densidad de la
        // pantalla, y los 800 puntos salían 2400 píxeles — justo lo que se
        // quería evitarle al widget.
        let formato = UIGraphicsImageRendererFormat.default()
        formato.scale = 1
        let render = UIGraphicsImageRenderer(size: tamano, format: formato)
        let pequena = render.image { _ in img.draw(in: CGRect(origin: .zero, size: tamano)) }
        guard let jpeg = pequena.jpegData(compressionQuality: 0.8) else { return }
        let nombre = "\(contador.id).jpg"
        try? jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombre), options: .atomic)
        await MainActor.run { contador.usaCartel = false; contador.foto = nombre }
    }

    private func quitaFoto() {
        if let foto = contador.foto {
            try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(foto))
        }
        try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(nombreOriginal))
        contador.foto = nil
    }
}

/// Para poder abrir la hoja de encuadre con `sheet(item:)`.
private struct FotoParaEncuadrar: Identifiable {
    let id = UUID()
    let imagen: UIImage
}
