import Foundation
import UserNotifications

/**
 Los avisos de la salida: "falta poco" y "¡ya!".

 Una baliza armada arranca sola a su hora, pero eso depende de que el móvil deje
 vivo al proceso mientras espera, y no siempre lo deja: en la CanFranc una
 baliza armada para las 22:00 no dio su primera posición hasta las 23:14, y
 quien la llevaba se enteró kilómetros después. El arranque automático sigue
 siendo lo primero; esto es la red debajo, y la red es una persona: si el aviso
 salta y la baliza no ha arrancado, basta con abrir la app.

 Son notificaciones LOCALES, programadas al armar. Eso importa: no hacen falta
 ni servidor ni cobertura —en una salida de montaña puede no haberla— y se
 disparan aunque el sistema haya dormido la aplicación. Lo que NO hacen es
 despertarla ellas solas: iOS no permite eso. Despiertan a su dueño, que es
 justo lo que hacía falta.

 Aquí caben los avisos que vengan después —un corte que se acerca, el relevo que
 viene, la meta— con el mismo patrón: se programan cuando se sabe la hora y se
 borran en bloque al terminar.
 */
enum AvisosDeCarrera {

    /// Cuánto antes se avisa de que esto empieza. Cinco minutos: lo justo para
    /// sacar el móvil del bolsillo y comprobar que está emitiendo, sin ser tan
    /// pronto como para que se olvide.
    static let antelacionMin = 5.0

    private static let idAntes = "salida-antes"
    private static let idYa = "salida-ya"

    /// Permiso, pedido cuando se abre la pantalla de la baliza y no en mitad de
    /// la salida, que es tarde para contestar a un diálogo.
    static func pideDerechoAAvisar() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /**
     Programa los dos avisos de una salida.

     Idempotente: programar otra vez reemplaza lo anterior, así que cambiar la
     hora de salida —o elegir otra carrera— no deja avisos viejos sueltos. Los
     que ya han pasado no se programan: un aviso de una salida de esta mañana
     saltaría al instante.
     */
    static func programaSalida(_ salida: Date, carrera: String?) {
        borra()
        let nombre = (carrera?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 }
        let antes = salida.addingTimeInterval(-antelacionMin * 60)

        pon(id: idAntes, cuando: antes,
            titulo: "⏳ \(Int(antelacionMin)) minutos para la salida",
            cuerpo: nombre.map { "\($0): la baliza arranca sola. Ábrela si quieres verla emitir." }
                ?? "La baliza arranca sola. Ábrela si quieres verla emitir.")

        pon(id: idYa, cuando: salida,
            titulo: "🏁 ¡Salida!",
            cuerpo: nombre.map { "\($0) en marcha. Ya te están siguiendo." }
                ?? "En marcha. Ya te están siguiendo.")
    }

    /// Quita los avisos pendientes: la baliza se desarmó, se empezó a mano o la
    /// carrera terminó. Un aviso de una salida que ya no existe es peor que no
    /// avisar.
    static func borra() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [idAntes, idYa])
    }

    private static func pon(id: String, cuando: Date, titulo: String, cuerpo: String) {
        let faltan = cuando.timeIntervalSinceNow
        guard faltan > 1 else { return }
        let content = UNMutableNotificationContent()
        content.title = titulo
        content.body = cuerpo
        content.sound = .default
        // Por intervalo y no por calendario: lo que se sabe es "dentro de tanto",
        // y así un cambio de huso o de hora del sistema no mueve el aviso.
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: faltan, repeats: false)
        UNUserNotificationCenter.current()
            .add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
}
