import ActivityKit
import SwiftUI
import WidgetKit

/**
 El viaje en directo como Actividad en Directo: la tarjeta de la pantalla de
 bloqueo y las tres formas de la Isla Dinámica.

 Solo monta las piezas: cómo se ve cada una vive en `Compartido`
 (`VistasViaje`), que es lo que la app enseña de vista previa y lo que pinta la
 prueba de la lámina. Así lo aprobado es lo que sale.

 Vive en la extensión de widgets porque es el sistema quien la pinta, no la app;
 pero no sale en la galería de widgets: la arranca la app (ver `ViajeEnDirecto`).
 */
struct ViajeActividad: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ViajeAtributos.self) { contexto in
            TarjetaViaje(datos: datos(contexto))
                .activityBackgroundTint(Color(hexContador: contexto.attributes.colores.fondo))
                // El color de los botones del sistema que salen encima (el de
                // cerrarla), a juego con el texto.
                .activitySystemActionForegroundColor(datos(contexto).pintura.texto)
        } dynamicIsland: { contexto in
            let d = datos(contexto)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    IslaViajeAbierta(datos: d)
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                IslaViajeInicio(datos: d)
            } compactTrailing: {
                IslaViajeFin(datos: d)
            } minimal: {
                IslaViajeMinima(datos: d)
            }
            .keylineTint(d.pintura.trayectoFin)
        }
    }

    /// De la Actividad a lo que piden las vistas. «Sin señal» lo decide el
    /// SISTEMA (`isStale`): la app pone una fecha de caducidad a cada
    /// actualización, y si no llega otra antes, es que no hay GPS.
    private func datos(_ c: ActivityViewContext<ViajeAtributos>) -> DatosDeViaje {
        let a = c.attributes, e = c.state
        return DatosDeViaje(
            titulo: a.titulo, origen: a.origen, destino: a.destino,
            transporte: a.transporte, colores: a.colores,
            restanteKm: e.restanteKm, progreso: e.progreso, llegada: e.llegada,
            llegado: e.llegado, sinSenal: c.isStale && !e.llegado,
            actualizado: e.actualizado)
    }
}
