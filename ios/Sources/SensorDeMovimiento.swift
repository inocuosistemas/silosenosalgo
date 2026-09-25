import CoreMotion

/**
 Lo que dice el sensor de movimiento del sistema (el mismo que cuenta los
 pasos): a pie, corriendo, en bici, en vehículo o quieto. Va con cada posición
 de una salida en «Automático» sin ruta ni evento, y es lo que deja partir el
 recorrido en tramos por medio de transporte (ver src/lib/tramosDeTransporte.ts
 en la web). No gasta batería aparte: el sistema lo lleva siempre encendido.

 Códigos, los de `TrailPoint.m` (shared/wireTypes.ts): q quieto · w a pie ·
 r corriendo · b bici · v en vehículo.
 */
@MainActor
final class SensorDeMovimiento {
    static let shared = SensorDeMovimiento()
    private let gestor = CMMotionActivityManager()
    private var encendido = false
    /// Lo último que dijo con confianza; nil si no dice nada o está apagado.
    private(set) var actual: String?

    /// La primera vez pide el permiso de «Movimiento y forma física».
    func enciende() {
        guard !encendido, CMMotionActivityManager.isActivityAvailable() else { return }
        encendido = true
        gestor.startActivityUpdates(to: .main) { [weak self] a in
            guard let a, a.confidence != .low else { return }
            self?.actual = Self.codigo(a)
        }
    }

    func apaga() {
        guard encendido else { return }
        gestor.stopActivityUpdates()
        encendido = false
        actual = nil
    }

    /// En vehículo manda: parado en un semáforo, el sistema dice «en vehículo» y
    /// «quieto» a la vez, y lo que interesa es que va en coche.
    nonisolated static func codigo(_ a: CMMotionActivity) -> String? {
        if a.automotive { return "v" }
        if a.cycling { return "b" }
        if a.running { return "r" }
        if a.walking { return "w" }
        if a.stationary { return "q" }
        return nil
    }
}
