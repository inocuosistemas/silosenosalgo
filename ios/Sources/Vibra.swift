import UIKit

/// El golpecito que se siente al tocar: elegir carrera, empezar a compartir y
/// parar.
///
/// No es adorno. La baliza se maneja con prisa, con guantes y sin mirar —en la
/// línea de salida, o al llegar—, y el aviso por el tacto confirma que el toque
/// ha entrado sin tener que leer la pantalla. Espejo de `Vibracion.kt` en
/// Android, donde lo pone el sistema con el mismo criterio: un toque seco al
/// elegir, uno afirmativo al empezar y otro distinto al parar.
enum Vibra {
    /// Algo cambia de estado: una carrera elegida o soltada.
    static func eleccion() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    /// Algo ARRANCA y sale bien: la baliza empieza a emitir.
    static func exito() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// Algo se PARA: la baliza deja de emitir. Distinto del de empezar, para
    /// que no se confundan al tacto.
    static func fin() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}
