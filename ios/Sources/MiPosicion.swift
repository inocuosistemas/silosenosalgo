import CoreLocation
import Foundation

/// Dónde está quien mira el visor, y hacia dónde mira: lo que el visor pide a
/// `/api/yo` para pintar su punto azul con el cono de la brújula (ver
/// `src/lib/miPosicion.ts`).
///
/// Va aparte del GPS de la baliza (`LocationManager`) a propósito: aquel se
/// enciende y se apaga con la salida; este, solo mientras el visor pregunta.
/// Cada respuesta alarga la vida del GPS unos segundos; si el visor se cierra o
/// deja de preguntar, se apaga solo. La app ya tiene permiso de ubicación —es
/// una baliza—, así que no sale ningún aviso nuevo; si no lo tuviera, solo se
/// pide cuando el visor lo dice (`pedir`: viene de un toque en el botón).
///
/// Todo en el hilo principal: es donde WebKit llama al manejador del esquema y
/// donde CoreLocation quiere a su delegado.
final class MiPosicion: NSObject, CLLocationManagerDelegate {
    static let shared = MiPosicion()

    private let manager = CLLocationManager()
    private var ultima: CLLocation?
    private var rumbo: Double?
    private var encendido = false
    private var apagado: Timer?
    /// Sin preguntas en este tiempo, el GPS se apaga.
    private let vida: TimeInterval = 6

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 2
        manager.headingFilter = 2
    }

    /// La respuesta para el visor, en JSON.
    func responde(pedir: Bool) -> Data {
        let estado = manager.authorizationStatus
        if estado == .notDetermined {
            if pedir { manager.requestWhenInUseAuthorization() }
            return json(["estado": "esperando"])
        }
        guard estado == .authorizedWhenInUse || estado == .authorizedAlways else {
            return json(["estado": "sin-permiso"])
        }
        enciende()
        guard let l = ultima else { return json(["estado": "esperando"]) }
        var r: [String: Any] = [
            "estado": "ok",
            "lat": l.coordinate.latitude,
            "lon": l.coordinate.longitude,
            "precision": l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : NSNull(),
            "t": l.timestamp.timeIntervalSince1970 * 1000,
        ]
        r["rumbo"] = rumbo ?? NSNull()
        return json(r)
    }

    private func enciende() {
        if !encendido {
            encendido = true
            manager.startUpdatingLocation()
            if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
        }
        apagado?.invalidate()
        apagado = Timer.scheduledTimer(withTimeInterval: vida, repeats: false) { [weak self] _ in self?.apaga() }
    }

    private func apaga() {
        encendido = false
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        rumbo = nil
    }

    private func json(_ d: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8)
    }

    // MARK: CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last { ultima = l }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { rumbo = nil; return }
        // El norte de verdad si lo hay (necesita posición); si no, el magnético.
        rumbo = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
