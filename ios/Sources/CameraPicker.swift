import SwiftUI
import UIKit

/// Full-screen system camera to capture a photo for a field note. Hands the
/// caller the captured image (nil on cancel); the caller saves the full-res
/// original to the camera roll and keeps a downscaled copy for the app. The
/// caller dismisses by flipping the presentation binding in `onComplete`.
struct CameraPicker: UIViewControllerRepresentable {
    var onComplete: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onComplete: onComplete) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onComplete: (UIImage?) -> Void
        init(onComplete: @escaping (UIImage?) -> Void) { self.onComplete = onComplete }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onComplete(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onComplete(nil)
        }
    }
}

/// Saves a full-res image to the camera roll, reporting success on the main
/// thread. Wraps the selector-based UIKit write in a closure and retains itself
/// until the callback fires (needs the "add to library" permission — denied →
/// `granted == false`, the write silently no-ops).
final class PhotoLibrarySaver: NSObject {
    private var completion: ((Bool) -> Void)?
    private var retain: PhotoLibrarySaver?

    static func saveToCameraRoll(_ image: UIImage, completion: @escaping (Bool) -> Void) {
        let saver = PhotoLibrarySaver()
        saver.completion = completion
        saver.retain = saver // keep alive across the async write
        UIImageWriteToSavedPhotosAlbum(image, saver, #selector(didFinish(_:error:contextInfo:)), nil)
    }

    @objc private func didFinish(_ image: UIImage, error: Error?, contextInfo: UnsafeRawPointer?) {
        let granted = error == nil
        DispatchQueue.main.async { [completion] in completion?(granted) }
        completion = nil
        retain = nil
    }
}
