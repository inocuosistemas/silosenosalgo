import Foundation
import UserNotifications

/**
 El AVISO de una cuenta atrás: el móvil avisa cuando llega.

 Es una notificación LOCAL, programada en el propio teléfono, y no un push del
 servidor. No hace falta más: la fecha se sabe de antemano —es la salida de la
 carrera o la que uno puso—, así que el sistema puede guardarla y lanzarla a su
 hora aunque la app lleve semanas sin abrirse, y sin cobertura.

 Se reprograman TODAS cada vez que cambia algo (`reprograma`): es más simple y
 más seguro que llevar la cuenta de cuál cambió, y son cuatro avisos.
 */
enum AvisosDeContadores {
    private static let prefijo = "contador-"

    /// Pide permiso si hace falta. Devuelve si lo hay.
    static func pidePermiso() async -> Bool {
        let centro = UNUserNotificationCenter.current()
        let ajustes = await centro.notificationSettings()
        switch ajustes.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        default:
            return (try? await centro.requestAuthorization(options: [.alert, .sound])) ?? false
        }
    }

    /// Deja programados los avisos de los contadores que lo pidan.
    static func reprograma() {
        let centro = UNUserNotificationCenter.current()
        centro.getPendingNotificationRequests { pendientes in
            let mios = pendientes.map(\.identifier).filter { $0.hasPrefix(prefijo) }
            centro.removePendingNotificationRequests(withIdentifiers: mios)

            let ahora = Date()
            for c in AlmacenContadores.lee().contadores where c.aviso {
                let cuando = c.fechaVigente(desde: ahora)
                guard cuando > ahora.addingTimeInterval(5) else { continue }
                let aviso = UNMutableNotificationContent()
                aviso.title = c.nombre.isEmpty ? "Tu cuenta atrás" : c.nombre
                aviso.body = c.origen == .carrera ? "¡Es la hora! Que vaya muy bien." : "Ha llegado el día."
                aviso.sound = .default
                // Al segundo, como la cuenta atrás: un aviso de carrera que
                // llega tarde no sirve de nada.
                let partes = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute, .second], from: cuando)
                let disparo = UNCalendarNotificationTrigger(dateMatching: partes, repeats: false)
                centro.add(UNNotificationRequest(identifier: prefijo + c.id, content: aviso, trigger: disparo))
            }
        }
    }
}
