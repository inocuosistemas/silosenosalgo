import Foundation
import Network

/**
 Si el móvil tiene salida a la red, en un `@Published` que la interfaz pueda
 leer.

 Hace falta porque la baliza es una app de montaña: buena parte de lo que
 enseña —las previsiones, los eventos, los seguimientos anteriores— vive en el
 servidor, así que sin cobertura esas listas salen VACÍAS. Y una lista vacía
 miente: dice "no tienes seguimientos" cuando lo que pasa es que no se pueden
 consultar. Sabiendo que no hay red, la pantalla puede decir la verdad.

 Se usa `NWPathMonitor` y no un "he fallado al pedir algo": el monitor sabe del
 estado del enlace en el momento, sin esperar a que una petición caduque, y
 vuelve solo cuando la cobertura regresa —que es justo cuando hace falta
 refrescar—.
 */
@MainActor
final class Reachability: ObservableObject {
    static let shared = Reachability()

    /// Hay salida a la red. Empieza en `true`: hasta que el monitor diga otra
    /// cosa, lo normal es tenerla, y arrancar avisando de un problema que
    /// todavía no se sabe si existe seria peor que callar.
    @Published private(set) var online = true

    private let monitor = NWPathMonitor()
    private let cola = DispatchQueue(label: "reachability")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let hay = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.online != hay else { return }
                self.online = hay
            }
        }
        monitor.start(queue: cola)
    }
}
