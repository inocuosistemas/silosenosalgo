import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Decirle al sistema que los contadores han cambiado y que vuelva a pintar el
/// widget. Sin esto, el nombre o el color nuevos no se ven hasta el siguiente
/// refresco que le toque al sistema, que puede ser dentro de un buen rato.
///
/// Es al mejor esfuerzo por definición: quien decide cuándo se pinta un widget
/// es iOS, no nosotros.
public enum RefrescoDeWidgets {
    public static func pide() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
