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
                                        .frame(width: 30, height: 30)
                                        .overlay(
                                            Circle().stroke(.white, lineWidth: contador.color == hex ? 2.5 : 0)
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
                    PhotosPicker(selection: $foto, matching: .images) {
                        Label(contador.foto == nil ? "Poner una foto de fondo" : "Cambiar la foto", systemImage: "photo")
                    }
                    if contador.foto != nil {
                        Button(role: .destructive) { quitaFoto() } label: { Text("Quitar la foto") }
                    }
                } header: {
                    Text("CÓMO SE VE").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("La foto sale de fondo en el widget mediano.")
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
        let render = UIGraphicsImageRenderer(size: tamano)
        let pequena = render.image { _ in img.draw(in: CGRect(origin: .zero, size: tamano)) }
        guard let jpeg = pequena.jpegData(compressionQuality: 0.8) else { return }
        let nombre = "\(contador.id).jpg"
        try? jpeg.write(to: AlmacenContadores.fotos.appendingPathComponent(nombre), options: .atomic)
        await MainActor.run { contador.foto = nombre }
    }

    private func quitaFoto() {
        if let foto = contador.foto {
            try? FileManager.default.removeItem(at: AlmacenContadores.fotos.appendingPathComponent(foto))
        }
        contador.foto = nil
    }
}
