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

    var body: some View {
        NavigationStack {
            Form {
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

                Section("Voz y foto") {
                    audioRow
                    if audio.denied {
                        Text("Permiso de micrófono denegado. Actívalo en Ajustes.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Button { showPhotoSource = true } label: {
                        Label(photoData == nil ? "Añadir foto" : "Foto añadida",
                              systemImage: photoData == nil ? "camera" : "checkmark.circle.fill")
                    }
                    if photoData != nil {
                        Button(role: .destructive) { photoData = nil; photoItem = nil } label: {
                            Label("Quitar foto", systemImage: "trash")
                        }
                    }
                    if rollSaveDenied {
                        Text("La foto se añadió a la nota, pero no se pudo guardar en el carrete (permiso denegado). Actívalo en Ajustes.")
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
                    Button("Guardar") {
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
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        let jpeg = downscaledJPEG(data)
                        await MainActor.run { self.photoData = jpeg }
                    }
                }
            }
            .confirmationDialog("Foto de la nota", isPresented: $showPhotoSource, titleVisibility: .visible) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Hacer foto") { showCamera = true }
                }
                Button("Elegir de la galería") { showLibrary = true }
                Button("Cancelar", role: .cancel) {}
            }
            .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    showCamera = false
                    if let image { handleCameraCapture(image) }
                }
                .ignoresSafeArea()
            }
        }
    }

    /// Keep a compact copy for the app and save the full-res original to the
    /// camera roll (the user asked to preserve original quality there). Saving to
    /// the roll needs "add" permission; if refused we still keep the app copy and
    /// surface a hint.
    private func handleCameraCapture(_ image: UIImage) {
        photoData = downscaledJPEG(image)
        PhotoLibrarySaver.saveToCameraRoll(image) { granted in
            rollSaveDenied = !granted
        }
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
    private func downscaledJPEG(_ image: UIImage) -> Data {
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

    /// Library images arrive as Data; decode then reuse the shared downscaler.
    private func downscaledJPEG(_ data: Data) -> Data {
        guard let img = UIImage(data: data) else { return data }
        return downscaledJPEG(img)
    }
}
