import AppIntents
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 Lo que hace el selector de la tarjeta de la carrera: cambiar de vista (tramo,
 carrera, corredores) sin abrir la app.

 Es una intención de Actividad en Directo: el sistema la ejecuta en el proceso
 de la app, despertándola un momento si hace falta, y aquí basta con cambiar la
 vista en la tarjeta viva. Los datos de las vistas ya van todos en cada
 actualización (ver `EstadoDeCarrera`), así que no hace falta red ni calcular
 nada.

 Marca la vista como ELEGIDA: a partir de ahí se respeta, y la tarjeta ya no
 cambia sola a la de tramo a la hora de salida (ver `ReglasDeCarrera.vista`).
 */
public struct CambiaVistaDeCarrera: LiveActivityIntent {
    public static let title: LocalizedStringResource = "Cambiar la vista de la carrera"
    public static let isDiscoverable = false

    @Parameter(title: "Vista")
    public var vista: String

    public init() {}

    public init(_ vista: VistaDeCarrera) {
        self.vista = vista.rawValue
    }

    public func perform() async throws -> some IntentResult {
        #if canImport(ActivityKit)
        guard let nueva = VistaDeCarrera(rawValue: vista) else { return .result() }
        for a in Activity<CarreraAtributos>.activities where a.activityState == .active || a.activityState == .stale {
            var estado = a.content.state
            estado.vista = nueva
            estado.vistaElegida = true
            await a.update(ActivityContent(state: estado, staleDate: a.content.staleDate))
        }
        #endif
        return .result()
    }
}
