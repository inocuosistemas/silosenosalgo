import Foundation
import AVFoundation

/// Minimal foreground voice-memo recorder for field notes. Records a capped-length
/// AAC/m4a into a temp file; the caller hands the file to TrackingStore, which
/// stores it locally and uploads it (offline-safe) alongside the note.
@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var elapsed: TimeInterval = 0
    /// The finished recording's file URL (nil until a recording is stopped).
    @Published var recordedURL: URL?
    /// Set when the mic permission was denied, so the UI can explain.
    @Published var denied = false

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private let maxDuration: TimeInterval = 90

    func toggle() { isRecording ? stop() : start() }

    func start() {
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else { self.denied = true; return }
                self.begin()
            }
        }
    }

    private func begin() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default)
            try session.setActive(true)
        } catch { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("note-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 22050,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.record()
            recorder = r
            recordedURL = nil
            isRecording = true
            elapsed = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let rec = self.recorder else { return }
                    self.elapsed = rec.currentTime
                    if self.elapsed >= self.maxDuration { self.stop() }
                }
            }
        } catch {
            isRecording = false
        }
    }

    func stop() {
        recorder?.stop()
        recordedURL = recorder?.url
        recorder = nil
        timer?.invalidate(); timer = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    /// Drop the current/last recording (on cancel or re-record).
    func discard() {
        stop()
        if let u = recordedURL { try? FileManager.default.removeItem(at: u) }
        recordedURL = nil
        elapsed = 0
    }
}
