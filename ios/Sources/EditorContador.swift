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
                    TarjetaContador(contador: contador)
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
                    // arriba, no leyendo un nombre.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(ColoresContador.paleta, id: \.self) { hex in
                                Button { contador.color = hex } label: {
                                    Circle()
                                        .fill(Color(hexContador: hex))
                                        .frame(width: 28, height: 28)
                                        // El elegido, con un aro POR FUERA y un
                                        // hueco en medio: pegado al borde no se
                                        // veía en el blanco, que es blanco.
                                        .padding(4)
                                        .overlay(
                                            Circle().stroke(.white, lineWidth: contador.color == hex ? 2 : 0)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
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
                    Picker("Número", selection: $contador.estilo) {
                        Text("Días, horas, minutos y segundos").tag(EstiloContador.completo)
                        Text("Días y horas").tag(EstiloContador.compacto)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
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
                        }
                    } else {
                        PhotosPicker(selection: $foto, matching: .images) {
                            Label(contador.foto == nil ? "Poner una foto de fondo" : "Cambiar la foto", systemImage: "photo")
                        }
                        if contador.foto != nil {
                            Button(role: .destructive) { quitaFoto() } label: { Text("Quitar la foto") }
                        }
                    }
                } header: {
                    Text("CÓMO SE VE").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("Con los segundos, el widget los cuenta solo. La foto sale de fondo en el widget mediano.")
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
                    Button("Guardar") { alTerminar(contador); dismiss() }
                        .disabled(!esDeCarrera && contador.nombre.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onChange(of: foto) { _, nueva in
                guard let nueva else { return }
                Task { await guardaFoto(nueva) }
            }
        }
    }

    /// La foto, reducida y guardada en el cajón compartido: el widget tiene muy
    /// poca memoria y una foto de móvil entera lo tumba.
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
        contador.foto = nil
    }
}
