import SwiftUI
import UIKit
import Photos
import ImageIO
import UniformTypeIdentifiers
import CoreLocation

/// Full-screen system camera to capture a photo for a field note. Hands the
/// caller the captured image and the camera's metadata (EXIF, orientation…;
/// nil on cancel): the caller saves it full-size to the camera roll, with the
/// beacon's location, and keeps a downscaled copy for the app.
struct CameraPicker: UIViewControllerRepresentable {
    var onComplete: (UIImage?, [String: Any]?) -> Void

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
        private let onComplete: (UIImage?, [String: Any]?) -> Void
        init(onComplete: @escaping (UIImage?, [String: Any]?) -> Void) { self.onComplete = onComplete }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onComplete(info[.originalImage] as? UIImage, info[.mediaMetadata] as? [String: Any])
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onComplete(nil, nil)
        }
    }
}

/**
 Guarda en el carrete la foto hecha con la cámara de la app, a tamaño completo.

 La cámara del sistema, abierta desde una app, no entrega el fichero original:
 entrega la imagen y, aparte, sus datos (EXIF, orientación). Antes se guardaba
 la imagen sola y en Fotos salía sin ubicación, con la hora del guardado y
 recomprimida en JPEG. Ahora se escribe en HEIC a alta calidad con los datos de
 la cámara, la ubicación de la baliza en ese momento (en el EXIF y en la ficha
 de Fotos) y la hora del disparo. Sin HEIC (algún simulador), en JPEG.

 Solo pide permiso para AÑADIR al carrete, no para verlo.
 */
enum PhotoLibrarySaver {
    static func saveToCameraRoll(_ image: UIImage, metadata: [String: Any]?, location: CLLocation?,
                                 completion: @escaping (Bool) -> Void) {
        let fecha = Date()
        Task.detached(priority: .utility) {
            guard let cg = image.cgImage,
                  let (datos, _) = fotoParaElCarrete(cg, metadatos: metadata ?? [:], ubicacion: location, fecha: fecha) else {
                await MainActor.run { completion(false) }
                return
            }
            let estado = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard estado == .authorized || estado == .limited else {
                await MainActor.run { completion(false) }
                return
            }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    let req = PHAssetCreationRequest.forAsset()
                    req.addResource(with: .photo, data: datos, options: nil)
                    req.creationDate = fecha
                    req.location = location
                }
                await MainActor.run { completion(true) }
            } catch {
                await MainActor.run { completion(false) }
            }
        }
    }

    /// El fichero para el carrete: la imagen con los datos de la cámara (la
    /// orientación va en ellos: la imagen viene tal cual la leyó el sensor),
    /// la hora del disparo y, si la hay, la ubicación en el GPS del EXIF.
    nonisolated static func fotoParaElCarrete(_ cg: CGImage, metadatos: [String: Any], ubicacion: CLLocation?,
                                              fecha: Date) -> (Data, UTType)? {
        var props = metadatos
        var exif = props[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        if exif[kCGImagePropertyExifDateTimeOriginal as String] == nil {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy:MM:dd HH:mm:ss"
            exif[kCGImagePropertyExifDateTimeOriginal as String] = f.string(from: fecha)
            let seg = TimeZone.current.secondsFromGMT(for: fecha)
            exif[kCGImagePropertyExifOffsetTimeOriginal as String] =
                String(format: "%@%02d:%02d", seg >= 0 ? "+" : "-", abs(seg) / 3600, abs(seg) % 3600 / 60)
        }
        props[kCGImagePropertyExifDictionary as String] = exif
        if let u = ubicacion {
            let c = u.coordinate
            var gps: [String: Any] = [
                kCGImagePropertyGPSLatitude as String: abs(c.latitude),
                kCGImagePropertyGPSLatitudeRef as String: c.latitude >= 0 ? "N" : "S",
                kCGImagePropertyGPSLongitude as String: abs(c.longitude),
                kCGImagePropertyGPSLongitudeRef as String: c.longitude >= 0 ? "E" : "W",
            ]
            if u.verticalAccuracy >= 0 {
                gps[kCGImagePropertyGPSAltitude as String] = abs(u.altitude)
                gps[kCGImagePropertyGPSAltitudeRef as String] = u.altitude >= 0 ? 0 : 1
            }
            if u.horizontalAccuracy >= 0 { gps[kCGImagePropertyGPSHPositioningError as String] = u.horizontalAccuracy }
            props[kCGImagePropertyGPSDictionary as String] = gps
        }
        props[kCGImageDestinationLossyCompressionQuality as String] = 0.92
        for tipo in [UTType.heic, UTType.jpeg] {
            let salida = NSMutableData()
            guard let dest = CGImageDestinationCreateWithData(salida, tipo.identifier as CFString, 1, nil) else { continue }
            CGImageDestinationAddImage(dest, cg, props as CFDictionary)
            if CGImageDestinationFinalize(dest) { return (salida as Data, tipo) }
        }
        return nil
    }
}
