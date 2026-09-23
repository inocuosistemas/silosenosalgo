import ActivityKit
import SwiftUI
import WidgetKit

/**
 La carrera en directo como Actividad en Directo: la tarjeta del TRAMO en la
 pantalla de bloqueo (la forma A, con el perfil grande) y la Isla Dinámica.

 Solo monta las piezas: cómo se ve cada una vive en `Compartido`
 (`TramoDeCarrera`), que es lo que pinta la lámina de la propuesta. La arranca
 y la alimenta la app (ver `CarreraEnDirecto`).
 */
struct CarreraActividad: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CarreraAtributos.self) { contexto in
            TarjetaTramo(datos: datos(contexto), forma: .perfilGrande)
                .activityBackgroundTint(Color(hexContador: "#0f1729"))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { contexto in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    TarjetaTramo(datos: datos(contexto), forma: .perfilGrande)
                        .padding(.horizontal, -8)
                }
            } compactLeading: {
                IslaTramoInicio(datos: contexto.state)
            } compactTrailing: {
                IslaTramoFin(datos: contexto.state)
            } minimal: {
                Image(systemName: contexto.state.hasta.tipo?.simbolo ?? "figure.run")
                    .foregroundStyle(Color(hexContador: "#38bdf8"))
            }
            .keylineTint(Color(hexContador: "#38bdf8"))
        }
    }

    /// «Sin señal» lo decide el SISTEMA (`isStale`): cada actualización lleva
    /// fecha de caducidad, y si no llega otra antes, es que no hay posiciones.
    private func datos(_ c: ActivityViewContext<CarreraAtributos>) -> DatosDeTramo {
        var d = c.state
        d.sinSenal = c.isStale && !d.enMeta
        return d
    }
}
