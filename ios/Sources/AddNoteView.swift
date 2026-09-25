import SwiftUI
import CoreLocation
import PhotosUI
import UIKit

/// Sheet to capture a field note at the current position: a POI type, an optional
/// text body, an optional voice memo, and an optional photo. TrackingStore stamps
/// it with the live fix and stores/uploads the media (offline-safe).
struct AddNoteView: View {
    @ObservedObject private var store = TrackingStore.shared
    @StateObject private var audio = AudioRecorder()
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var type = PoiTypes.defaultSlug
    @State private var photoItem: PhotosPickerItem?
    @State private var photoData: Data?
    /// Photo capture flow: pick the source (camera / library), then present it.
    @State private var showPhotoSource = false
    @State private var showCamera = false
    @State private var showLibrary = false
    /// Set when saving the original to the camera roll is refused, so we can hint
    /// the user (the app copy is kept regardless).
    @State private var rollSaveDenied = false
    /// La foto se está preparando (bajándola de iCloud y reduciéndola). Con su
    /// progreso de verdad cuando la galería lo da: una foto que está en iCloud
    /// puede tardar, y sin nada en pantalla parecía que se había colgado.
    // (`-NotaPreparando`: para ver en pruebas cómo se ve mientras se trae.)
    @State private var preparandoFoto = ProcessInfo.processInfo.arguments.contains("-NotaPreparando")
    @State private var progresoFoto: Double? = ProcessInfo.processInfo.arguments.contains("-NotaPreparando") ? 0.42 : nil
    @State private var fotoFallida = false

    var body: some View {
        NavigationStack {
            Form {
                // La foto, lo primero y en grande: es lo que casi siempre se hace.
                Section {
                    bloqueFoto
                        .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                    if rollSaveDenied {
                        Text("La foto se añadió a la nota, pero no se pudo guardar en el carrete (permiso denegado). Actívalo en Ajustes.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Foto")
                }

                Section("Tipo de punto") {
                    Picker("Tipo", selection: $type) {
                        ForEach(PoiTypes.all) { t in
                            Text("\(t.emoji)  \(t.label)").tag(t.slug)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                Section("Nota") {
                    TextField("Escribe una nota (opcional)…", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section("Nota de voz") {
                    audioRow
                    if audio.denied {
                        Text("Permiso de micrófono denegado. Actívalo en Ajustes.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section {
                    StorageMeterView()
                }

                Section {
                    contextRow
                } footer: {
                    Text("Se ancla a tu posición actual y se sube al recuperar cobertura. En el GPX de la guía será un POI.")
                }
            }
            .navigationTitle("Añadir nota")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { audio.discard(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(preparandoFoto ? "Preparando…" : "Guardar") {
                        if audio.isRecording { audio.stop() }
                        store.addNote(
                            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                            type: type,
                            audioURL: audio.recordedURL,
                            photoData: photoData
                        )
                        dismiss()
                    }
                    .disabled(!canSave)
                }
            }
            .onChange(of: photoItem) { newItem in
                guard let newItem else { return }
                cargaDeLaGaleria(newItem)
            }
            // «Cambiar» con la foto ya puesta: de dónde sale la nueva.
            .confirmationDialog("Foto de la nota", isPresented: $showPhotoSource, titleVisibility: .visible) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Hacer foto") { showCamera = true }
                }
                Button("Elegir de la galería") { showLibrary = true }
                Button("Cancelar", role: .cancel) {}
            }
            .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image, metadatos in
                    showCamera = false
                    if let image { handleCameraCapture(image, metadatos: metadatos) }
                }
                .ignoresSafeArea()
            }
        }
    }

    /// Keep a compact copy for the app and save the full-res original to the
    /// camera roll (the user asked to preserve original quality there). Saving to
    /// the roll needs "add" permission; if refused we still keep the app copy and
    /// surface a hint.
    private func handleCameraCapture(_ image: UIImage, metadatos: [String: Any]?) {
        // Reducirla, fuera del hilo de la pantalla: una foto de 48 MP tardaba
        // lo bastante en el principal como para que todo pareciera colgado.
        preparandoFoto = true
        progresoFoto = nil
        fotoFallida = false
        Task.detached(priority: .userInitiated) {
            let jpeg = Self.reducida(image)
            await MainActor.run {
                photoData = jpeg
                preparandoFoto = false
            }
        }
        // Al carrete, a tamaño completo y con la ubicación de la baliza: en
        // Fotos sale en su sitio del mapa (ver `PhotoLibrarySaver`).
        PhotoLibrarySaver.saveToCameraRoll(image, metadata: metadatos, location: store.lastLocation) { granted in
            rollSaveDenied = !granted
        }
    }

    /// La de la galería: con el progreso que da el sistema mientras la trae
    /// (de iCloud, si no está en el móvil), y reducida fuera del hilo principal.
    private func cargaDeLaGaleria(_ item: PhotosPickerItem) {
        preparandoFoto = true
        progresoFoto = 0
        fotoFallida = false
        photoData = nil
        var progreso: Progress?
        progreso = item.loadTransferable(type: Data.self) { resultado in
            let datos = try? resultado.get()
            let jpeg = datos.flatMap { d in UIImage(data: d).map { Self.reducida($0) } }
            DispatchQueue.main.async {
                photoData = jpeg ?? nil
                fotoFallida = jpeg == nil
                preparandoFoto = false
                progresoFoto = nil
            }
        }
        // El progreso, a la pantalla mientras dure.
        Task { @MainActor in
            while preparandoFoto, let p = progreso {
                progresoFoto = p.fractionCompleted
                try? await Task.sleep(nanoseconds: 150_000_000)
            }
        }
    }

    /// El bloque de la foto: dos botones grandes (cámara y galería) sin pasar
    /// por un menú; mientras se prepara, la barra de progreso; y ya lista, la
    /// foto misma con la opción de cambiarla o quitarla.
    @ViewBuilder private var bloqueFoto: some View {
        if preparandoFoto {
            VStack(spacing: 10) {
                ProgressView(value: progresoFoto ?? 0) {
                    Label(progresoFoto.map { $0 > 0 && $0 < 1 } == true
                          ? "Trayendo la foto… \(Int((progresoFoto ?? 0) * 100)) %"
                          : "Preparando la foto…", systemImage: "photo")
                        .font(.subheadline.weight(.semibold))
                }
                .progressViewStyle(.linear)
                .tint(Theme.sky500)
                if progresoFoto == nil { ProgressView().controlSize(.small) }
                Text("Si está en iCloud, puede tardar un poco en bajar.")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 8)
        } else if let data = photoData, let img = UIImage(data: data) {
            VStack(spacing: 10) {
                Image(uiImage: img)
                    .resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(alignment: .topTrailing) {
                        Label("Lista", systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(8)
                    }
                HStack {
                    Button { abreFuente() } label: { Label("Cambiar", systemImage: "arrow.triangle.2.circlepath") }
                    Spacer()
                    Button(role: .destructive) { photoData = nil; photoItem = nil } label: {
                        Label("Quitar", systemImage: "trash")
                    }
                }
                .buttonStyle(.borderless)
                .font(.subheadline)
            }
        } else {
            VStack(spacing: 8) {
                HStack(spacing: 10) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        botonGrande("Hacer foto", "camera.fill", principal: true) { showCamera = true }
                    }
                    botonGrande("Galería", "photo.on.rectangle", principal: !UIImagePickerController.isSourceTypeAvailable(.camera)) {
                        showLibrary = true
                    }
                }
                if fotoFallida {
                    Text("No se ha podido traer esa foto. Prueba otra vez, o con otra.")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private func abreFuente() {
        if UIImagePickerController.isSourceTypeAvailable(.camera) { showPhotoSource = true } else { showLibrary = true }
    }

    private func botonGrande(_ texto: String, _ icono: String, principal: Bool, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            VStack(spacing: 8) {
                Image(systemName: icono).font(.system(size: 30, weight: .semibold))
                Text(texto).font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity).frame(height: 96)
            .foregroundStyle(principal ? Color.white : Theme.sky500)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(principal ? Theme.sky600 : Theme.sky500.opacity(0.14)))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var audioRow: some View {
        if audio.isRecording {
            Button(role: .destructive) { audio.stop() } label: {
                Label("Detener grabación (\(Int(audio.elapsed)) s)", systemImage: "stop.circle.fill")
            }
        } else if audio.recordedURL != nil {
            HStack {
                Label("Nota de voz grabada", systemImage: "waveform")
                Spacer()
                Button(role: .destructive) { audio.discard() } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
            }
        } else {
            Button { audio.start() } label: {
                Label("Grabar nota de voz", systemImage: "mic.fill")
            }
        }
    }

    /// Save needs a position, and something to save (a specific type, text, or media).
    private var canSave: Bool {
        guard store.lastLocation != nil else { return false }
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        // Con la foto a medio preparar, todavía no: se guardaría sin ella.
        if preparandoFoto { return false }
        let hasMedia = audio.recordedURL != nil || audio.isRecording || photoData != nil
        return type != PoiTypes.defaultSlug || hasText || hasMedia
    }

    @ViewBuilder private var contextRow: some View {
        if let loc = store.lastLocation {
            HStack {
                Label(timeString, systemImage: "clock")
                Spacer()
                if loc.horizontalAccuracy >= 0 {
                    Text("± \(Int(loc.horizontalAccuracy)) m").foregroundStyle(.secondary)
                }
            }
            .font(.footnote)
            if loc.verticalAccuracy >= 0 {
                Label("\(Int(loc.altitude)) m", systemImage: "mountain.2")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            Label("Esperando posición GPS…", systemImage: "location.slash")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var timeString: String {
        let f = DateFormatter()
        f.timeStyle = .short
        return f.string(from: Date())
    }

    /// Downscale + JPEG-compress an image to a compact "mobile-sized" copy for the
    /// app (the camera roll keeps the full-res original). Longest side ≤ 1600 px,
    /// forcing renderer scale = 1 so the output is genuinely that size in PIXELS
    /// (the default screen scale would render it 2–3× larger), keeping files small.
    nonisolated static func reducida(_ image: UIImage) -> Data {
        let maxDim: CGFloat = 1600
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxDim ? maxDim / longest : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: 0.6)
            ?? image.jpegData(compressionQuality: 0.6) ?? Data()
    }

}
