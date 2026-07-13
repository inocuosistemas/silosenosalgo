import SwiftUI
import AVFoundation
import UIKit

struct NotesListView: View {
    @ObservedObject private var store = TrackingStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var pendingDelete: Note?

    var body: some View {
        let notes = store.currentNotes
        let metrics = store.sessionToken.map { PlanGeometry.noteMetrics(forSession: $0, notes: notes) } ?? [:]
        NavigationStack {
            Group {
                if notes.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "note.text")
                            .font(.system(size: 34))
                            .foregroundStyle(.secondary)
                        Text("Todavía no hay notas")
                            .font(.headline)
                        Text("Las notas que añadas desde el mapa aparecerán aquí.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                } else {
                    List {
                        Section {
                            StorageMeterView()
                        }
                        Section {
                            ForEach(notes) { note in
                                NavigationLink {
                                    NoteDetailView(note: note, metrics: metrics[note.id], token: store.sessionToken)
                                } label: {
                                    NoteRow(note: note, metrics: metrics[note.id], token: store.sessionToken)
                                }
                            }
                            .onDelete { offsets in
                                guard let index = offsets.first, notes.indices.contains(index) else { return }
                                pendingDelete = notes[index]
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Notas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Text("\(store.noteCount)")
                        .foregroundStyle(.secondary)
                }
            }
            .alert("Eliminar nota", isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ), presenting: pendingDelete) { note in
                Button("Eliminar", role: .destructive) {
                    pendingDelete = nil
                    Task { await store.deleteNote(note) }
                }
                Button("Cancelar", role: .cancel) { pendingDelete = nil }
            } message: { _ in
                Text("Se eliminarán también la foto y la nota de voz vinculadas.")
            }
        }
    }
}

private struct NoteRow: View {
    let note: Note
    let metrics: PlanGeometry.NoteMetrics?
    let token: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(PoiTypes.emoji(note.poiType))
                Text(note.title ?? PoiTypes.label(note.poiType))
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                mediaIndicators
            }
            if let body = note.body, !body.isEmpty {
                Text(body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            HStack(spacing: 12) {
                Label(kmLabel, systemImage: "figure.walk")
                Label(gainLabel, systemImage: "mountain.2")
                Label(Self.timeFormatter.string(from: Date(timeIntervalSince1970: note.createdAt / 1000)), systemImage: "clock")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var mediaIndicators: some View {
        if hasPhoto {
            Image(systemName: "photo.fill")
                .foregroundStyle(Theme.sky500)
                .accessibilityLabel("Tiene foto")
        }
        if hasAudio {
            Image(systemName: "waveform")
                .foregroundStyle(.orange)
                .accessibilityLabel("Tiene nota de voz")
        }
    }

    private var kmLabel: String {
        guard let km = metrics?.routeKm ?? note.trackKm ?? note.distM.map({ $0 / 1000 }) else { return "km --" }
        return String(format: "km %.1f", km)
    }

    private var gainLabel: String {
        guard let gain = metrics?.elevationGainM else { return "D+ --" }
        return "D+ \(Int(gain.rounded())) m"
    }

    private var hasPhoto: Bool { note.photoKey != nil || mediaURL(kind: "photo") != nil }
    private var hasAudio: Bool { note.audioKey != nil || mediaURL(kind: "audio") != nil }

    private func mediaURL(kind: String) -> URL? {
        guard let token else { return nil }
        let ext = kind == "audio" ? "m4a" : "jpg"
        let url = LocalStore.mediaFileURL(token, "\(note.id)_\(kind).\(ext)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()
}

private struct NoteDetailView: View {
    let note: Note
    let metrics: PlanGeometry.NoteMetrics?
    let token: String?
    @ObservedObject private var store = TrackingStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var showPhotoViewer = false
    @State private var confirmDelete = false

    var body: some View {
        List {
            Section {
                LabeledContent("Hora", value: Self.dateFormatter.string(from: noteDate))
                LabeledContent("Kilómetro", value: kmLabel)
                LabeledContent("Desnivel acumulado", value: gainLabel)
                if let altitude = note.altitude {
                    LabeledContent("Altitud", value: "\(Int(altitude.rounded())) m")
                }
            }

            if let body = note.body, !body.isEmpty {
                Section("Nota") {
                    Text(body)
                        .textSelection(.enabled)
                }
            }

            if let image = photoImage {
                Section("Foto") {
                    Button { showPhotoViewer = true } label: {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .padding(8)
                                    .foregroundStyle(.white)
                                    .background(.black.opacity(0.65))
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Abrir foto a pantalla completa")
                }
            }

            if let audioURL = mediaURL(kind: "audio") {
                Section("Nota de voz") {
                    NoteAudioPlayerView(url: audioURL)
                }
            }
        }
        .navigationTitle("\(PoiTypes.emoji(note.poiType)) \(note.title ?? PoiTypes.label(note.poiType))")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) { confirmDelete = true } label: {
                    Image(systemName: "trash")
                }
                .accessibilityLabel("Eliminar nota")
            }
        }
        .alert("Eliminar nota", isPresented: $confirmDelete) {
            Button("Eliminar", role: .destructive) {
                Task {
                    await store.deleteNote(note)
                    dismiss()
                }
            }
            Button("Cancelar", role: .cancel) { }
        } message: {
            Text("Se eliminarán también la foto y la nota de voz vinculadas.")
        }
        .fullScreenCover(isPresented: $showPhotoViewer) {
            if let image = photoImage {
                NotePhotoViewer(image: image)
            }
        }
    }

    private var noteDate: Date { Date(timeIntervalSince1970: note.createdAt / 1000) }
    private var photoImage: UIImage? {
        guard let url = mediaURL(kind: "photo") else { return nil }
        return UIImage(contentsOfFile: url.path)
    }
    private var kmLabel: String {
        guard let km = metrics?.routeKm ?? note.trackKm ?? note.distM.map({ $0 / 1000 }) else { return "--" }
        return String(format: "%.1f km", km)
    }
    private var gainLabel: String {
        guard let gain = metrics?.elevationGainM else { return "--" }
        return "D+ \(Int(gain.rounded())) m"
    }

    private func mediaURL(kind: String) -> URL? {
        guard let token else { return nil }
        let ext = kind == "audio" ? "m4a" : "jpg"
        let url = LocalStore.mediaFileURL(token, "\(note.id)_\(kind).\(ext)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

private struct NotePhotoViewer: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            ZoomableNoteImage(image: image)
                .ignoresSafeArea()

            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 30))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.65))
            }
            .padding(.top, 12)
            .padding(.trailing, 16)
            .accessibilityLabel("Cerrar visor")
        }
        .statusBarHidden()
    }
}

private struct ZoomableNoteImage: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.bouncesZoom = true
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.backgroundColor = .black

        let imageView = context.coordinator.imageView
        imageView.image = image
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            imageView.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            imageView.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
        ])

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        context.coordinator.scrollView = scroll
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView.image = image
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let imageView = UIImageView()
        weak var scrollView: UIScrollView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scroll = scrollView else { return }
            if scroll.zoomScale > scroll.minimumZoomScale {
                scroll.setZoomScale(scroll.minimumZoomScale, animated: true)
                return
            }
            let scale: CGFloat = 2.5
            let point = gesture.location(in: imageView)
            let size = CGSize(width: scroll.bounds.width / scale, height: scroll.bounds.height / scale)
            let origin = CGPoint(x: point.x - size.width / 2, y: point.y - size.height / 2)
            scroll.zoom(to: CGRect(origin: origin, size: size), animated: true)
        }
    }
}

private struct NoteAudioPlayerView: View {
    @StateObject private var playback: NoteAudioPlayback

    init(url: URL) {
        _playback = StateObject(wrappedValue: NoteAudioPlayback(url: url))
    }

    var body: some View {
        VStack(spacing: 10) {
            AudioWaveform(
                samples: playback.samples,
                progress: playback.progress,
                liveLevel: playback.liveLevel,
                isPlaying: playback.isPlaying,
                onSeek: playback.seek
            )
            .frame(height: 58)

            HStack {
                Text(Self.timeLabel(playback.currentTime))
                Spacer()
                Text(Self.timeLabel(playback.duration))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)

            Button { playback.toggle() } label: {
                Label(playback.isPlaying ? "Pausar" : "Reproducir", systemImage: playback.isPlaying ? "pause.fill" : "play.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private static func timeLabel(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds.rounded(.down))
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }
}

private struct AudioWaveform: View {
    let samples: [CGFloat]
    let progress: Double
    let liveLevel: CGFloat
    let isPlaying: Bool
    let onSeek: (Double) -> Void

    private var visibleSamples: [CGFloat] {
        samples.isEmpty ? Array(repeating: 0.12, count: 48) : samples
    }

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let values = visibleSamples
                let spacing: CGFloat = 2
                let barWidth = max(1.5, (size.width - spacing * CGFloat(values.count - 1)) / CGFloat(values.count))
                let playedIndex = Int((progress * Double(values.count)).rounded(.down))

                for (index, sample) in values.enumerated() {
                    let distance = abs(index - playedIndex)
                    let liveBoost: CGFloat
                    if isPlaying && distance <= 3 {
                        liveBoost = liveLevel * (1 - CGFloat(distance) * 0.2)
                    } else {
                        liveBoost = 0
                    }
                    let height = max(3, max(sample, liveBoost) * size.height)
                    let rect = CGRect(
                        x: CGFloat(index) * (barWidth + spacing),
                        y: (size.height - height) / 2,
                        width: barWidth,
                        height: height
                    )
                    let path = Path(roundedRect: rect, cornerRadius: barWidth / 2)
                    context.fill(path, with: .color(index <= playedIndex ? Theme.sky500 : Color.secondary.opacity(0.35)))
                }

                if isPlaying {
                    let x = min(size.width - 1, max(1, CGFloat(progress) * size.width))
                    let playhead = Path(CGRect(x: x - 1, y: 0, width: 2, height: size.height))
                    context.fill(playhead, with: .color(.white.opacity(0.9)))
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard geometry.size.width > 0 else { return }
                        onSeek(min(1, max(0, value.location.x / geometry.size.width)))
                    }
            )
        }
        .accessibilityElement()
        .accessibilityLabel("Onda de la nota de voz")
        .accessibilityValue("\(Int(progress * 100)) por ciento")
        .accessibilityAdjustableAction { direction in
            let delta = direction == .increment ? 0.05 : -0.05
            onSeek(min(1, max(0, progress + delta)))
        }
    }
}

@MainActor
private final class NoteAudioPlayback: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var isPlaying = false
    @Published var samples: [CGFloat] = []
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var liveLevel: CGFloat = 0
    private var player: AVAudioPlayer?
    private var progressTimer: Timer?

    var progress: Double {
        duration > 0 ? min(1, max(0, currentTime / duration)) : 0
    }

    init(url: URL) {
        player = try? AVAudioPlayer(contentsOf: url)
        super.init()
        player?.delegate = self
        player?.volume = 1
        player?.isMeteringEnabled = true
        player?.prepareToPlay()
        duration = player?.duration ?? 0
        Task.detached(priority: .utility) {
            let waveform = Self.makeWaveform(url: url, barCount: 56)
            await MainActor.run { [weak self] in self?.samples = waveform }
        }
    }

    func toggle() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
            stopProgressTimer()
            currentTime = player.currentTime
            liveLevel = 0
            deactivateAudioSession()
        } else {
            if player.currentTime >= player.duration { player.currentTime = 0 }
            guard activateAudioSession(), player.play() else { return }
            isPlaying = true
            currentTime = player.currentTime
            startProgressTimer()
        }
    }

    func seek(to fraction: Double) {
        guard let player, player.duration > 0 else { return }
        player.currentTime = min(1, max(0, fraction)) * player.duration
        currentTime = player.currentTime
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        isPlaying = false
        stopProgressTimer()
        currentTime = player.duration
        liveLevel = 0
        deactivateAudioSession()
    }

    private func startProgressTimer() {
        stopProgressTimer()
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let player = self.player else { return }
                self.currentTime = player.currentTime
                player.updateMeters()
                let power = player.averagePower(forChannel: 0)
                let normalized = min(1, max(0, (CGFloat(power) + 55) / 55))
                self.liveLevel = max(0.08, normalized)
            }
        }
        progressTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    private func activateAudioSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            // `.playAndRecord` defaults to the quiet receiver. Notes are media,
            // so route them through the normal loudspeaker/headphone output.
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            return true
        } catch {
            return false
        }
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func makeWaveform(url: URL, barCount: Int) -> [CGFloat] {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length)
              ),
              (try? file.read(into: buffer)) != nil,
              let channels = buffer.floatChannelData else { return [] }

        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frameCount > 0, channelCount > 0 else { return [] }

        var values = Array(repeating: CGFloat.zero, count: barCount)
        for bar in 0..<barCount {
            let start = bar * frameCount / barCount
            let end = max(start + 1, (bar + 1) * frameCount / barCount)
            var sum: Double = 0
            var count = 0
            let stride = max(1, (end - start) / 300)
            for frame in Swift.stride(from: start, to: min(end, frameCount), by: stride) {
                for channel in 0..<channelCount {
                    let sample = Double(channels[channel][frame])
                    sum += sample * sample
                    count += 1
                }
            }
            values[bar] = count > 0 ? CGFloat(sqrt(sum / Double(count))) : 0
        }

        guard let peak = values.max(), peak > 0 else { return values }
        return values.map { max(0.08, sqrt($0 / peak)) }
    }
}
