import CoreLocation
import Foundation

/**
 Pedir la ubicación «Siempre» al entrar por primera vez, y no a mitad de una
 carrera o de un viaje.

 iOS no deja pedir «Siempre» de golpe: la primera pregunta solo ofrece «Al
 usar la app», y la de pasar a «Siempre» sale después, UNA sola vez en la vida
 de la app. Así que se hace en dos pasos seguidos: primero «Al usar la app» y,
 en cuanto se concede, el paso a «Siempre». Si ya se había preguntado, no se
 insiste: queda el aviso de la baliza, con el botón que lleva a Ajustes.
 */
@MainActor
final class PermisoDeUbicacion: NSObject, CLLocationManagerDelegate {
    static let shared = PermisoDeUbicacion()

    private let gps = CLLocationManager()
    private var enCurso = false
    private static let clave = "ubicacion.siemprePedida"

    override init() {
        super.init()
        gps.delegate = self
    }

    /// Al entrar (y al abrir la app ya dentro, para quien entró antes de que
    /// existiera esto): si toca, se pregunta.
    func pideSiempreSiToca() {
        guard !UserDefaults.standard.bool(forKey: Self.clave) else { return }
        switch gps.authorizationStatus {
        case .notDetermined:
            enCurso = true
            gps.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            pasaASiempre()
        default:
            // Ya es «Siempre», o está denegada: nada que preguntar.
            UserDefaults.standard.set(true, forKey: Self.clave)
        }
    }

    private func pasaASiempre() {
        enCurso = false
        UserDefaults.standard.set(true, forKey: Self.clave)
        gps.requestAlwaysAuthorization()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let estado = manager.authorizationStatus
        Task { @MainActor in
            guard self.enCurso else { return }
            switch estado {
            case .authorizedWhenInUse: self.pasaASiempre()
            case .notDetermined: break
            default:
                self.enCurso = false
                UserDefaults.standard.set(true, forKey: Self.clave)
            }
        }
    }
}
