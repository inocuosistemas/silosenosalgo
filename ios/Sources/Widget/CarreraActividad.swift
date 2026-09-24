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
            // El selector de arriba son botones: cambian de vista sin abrir la
            // app. Tocar el resto de la tarjeta la abre, como siempre.
            TarjetaDeCarrera(estado: estado(contexto), interactivo: true)
                // Tocar fuera del selector abre su pantalla en la app.
                .widgetURL(EnlaceDeCarrera.url)
                .activityBackgroundTint(Color(hexContador: "#0f1729"))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { contexto in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    TarjetaDeCarrera(estado: estado(contexto), interactivo: true)
                        .padding(.horizontal, -8)
                }
            } compactLeading: {
                IslaTramoInicio(datos: contexto.state.tramo)
            } compactTrailing: {
                IslaTramoFin(datos: contexto.state.tramo)
            } minimal: {
                Image(systemName: contexto.state.tramo.hasta.tipo?.simbolo ?? "figure.run")
                    .foregroundStyle(Color(hexContador: "#38bdf8"))
            }
            .keylineTint(Color(hexContador: "#38bdf8"))
            .widgetURL(EnlaceDeCarrera.url)
        }
    }

    /// «Sin señal» lo decide el SISTEMA (`isStale`): cada actualización lleva
    /// fecha de caducidad, y si no llega otra antes, es que no hay posiciones.
    private func estado(_ c: ActivityViewContext<CarreraAtributos>) -> EstadoDeCarrera {
        var e = c.state
        e.tramo.sinSenal = c.isStale && !e.tramo.enMeta
        return e
    }
}
