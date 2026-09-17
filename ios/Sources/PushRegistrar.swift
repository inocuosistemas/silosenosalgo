import Foundation
import UIKit
import UserNotifications

/**
 Da de alta este aparato para recibir ánimos con la app cerrada.

 Hasta ahora el aviso lo ponía el propio móvil al descubrir un ánimo nuevo
 mientras sondeaba el servidor, y ese sondeo cuelga del reloj de la baliza: sin
 baliza abierta —o con la app cerrada del todo— quien te animaba no llegaba a
 ninguna parte. Un push sí llega, porque lo entrega el sistema.

 El registro se intenta en CADA arranque, no una vez: el token de APNs puede
 cambiar al reinstalar o al restaurar una copia de seguridad, y quien lo tiene
 fresco es iOS. El servidor lo guarda con `ON CONFLICT`, así que repetir no
 duplica nada.
 */
@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()
    private init() {}

    /// El servidor confirmó que este aparato está dado de alta. Mientras sea
    /// `false` el aviso local sigue siendo la única vía, y por eso no se apaga.
    private(set) var registrado = false

    /// El último token que dio iOS, para poder darlo de baja al salir de la
    /// cuenta: si no, el móvil seguiría recibiendo los ánimos de quien ya no lo
    /// usa.
    private(set) var tokenAparato: String?

    /**
     Pide permiso y, si lo hay, se registra en APNs.

     El permiso se pide al abrir la pantalla de la baliza —no a mitad de ruta,
     cuando ya sería tarde para contestar a un diálogo—, igual que hacía el aviso
     local. Si está denegado no se registra: un token sin permiso solo sirve para
     que el servidor gaste envíos que nadie verá.
     */
    func arranca() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { concedido, _ in
            guard concedido else { return }
            Task { @MainActor in UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// Llega desde el `AppDelegate` con el token que da iOS.
    func recibeToken(_ datos: Data) {
        let hex = datos.map { String(format: "%02x", $0) }.joined()
        tokenAparato = hex
        guard let sesion = Keychain.load() else { return }
        Task { @MainActor in
            registrado = await API.registerPush(token: sesion, deviceToken: hex)
        }
    }

    /// Al salir de la cuenta. Se da de baja ANTES de borrar la sesión, que es
    /// cuando todavía hay con qué autenticar la llamada.
    func daDeBaja() async {
        guard let hex = tokenAparato, let sesion = Keychain.load() else { return }
        await API.unregisterPush(token: sesion, deviceToken: hex)
        registrado = false
    }
}
