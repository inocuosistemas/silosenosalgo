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
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(photoData == nil ? "Añadir foto" : "Foto añadida", systemImage: "photo")
                    }
                    if photoData != nil {
                        Button(role: .destructive) { photoData = nil; photoItem = nil } label: {
                            Label("Quitar foto", systemImage: "trash")
                        }
                    }
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

    /// Downscale + JPEG-compress a picked image so it fits the server's media cap.
    private func downscaledJPEG(_ data: Data) -> Data {
        guard let img = UIImage(data: data) else { return data }
        let maxDim: CGFloat = 1600
        let longest = max(img.size.width, img.size.height)
        let scale = longest > maxDim ? maxDim / longest : 1
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in
            img.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: 0.6) ?? data
    }
}
