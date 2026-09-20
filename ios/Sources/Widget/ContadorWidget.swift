import WidgetKit
import SwiftUI
import AppIntents

/**
 El WIDGET de la cuenta atrás: la carrera que viene, en la pantalla de inicio.

 ── Por qué el contador no se refresca cada segundo ───────────────────────

 Un widget no corre: el sistema le pide de vez en cuando una tanda de estados
 ya pintados y los va enseñando. Pedir uno por segundo es imposible y además
 innecesario, porque WidgetKit sabe contar solo: `Text(fecha, style: .timer)`
 tiene su propio reloj y baja los segundos sin despertar a nadie.

 Lo que ese reloj NO sabe es hablar de días. Así que el widget cuenta en dos
 tiempos, y por eso hay dos formas de pintar lo mismo:

 - A más de un día, los días y las horas escritos, con una tanda nueva cada
   hora (que es todo lo que puede cambiar en una hora).
 - En el último día, el reloj del sistema, con sus segundos corriendo.

 El cambio de uno a otro lo marca la propia tanda: se pide una nueva justo
 cuando quedan 24 horas, y otra al pasar la fecha.
 */

struct EntradaContador: TimelineEntry {
    let date: Date
    let contador: Contador?
    /// Cuántos contadores hay: con uno solo no hace falta decir "el siguiente".
    let cuantos: Int
}

struct ProveedorContadores: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> EntradaContador {
        EntradaContador(date: Date(), contador: Contador.ejemplo, cuantos: 1)
    }

    func snapshot(for configuration: ElegirContadorIntent, in context: Context) async -> EntradaContador {
        EntradaContador(date: Date(), contador: elegido(configuration) ?? Contador.ejemplo, cuantos: 1)
    }

    func timeline(for configuration: ElegirContadorIntent, in context: Context) async -> Timeline<EntradaContador> {
        let ahora = Date()
        let contador = elegido(configuration)
        let vigentes = AlmacenContadores.vigentes(ahora)
        let entrada = EntradaContador(date: ahora, contador: contador, cuantos: vigentes.count)
        return Timeline(entries: [entrada], policy: .after(cuandoVolver(contador, ahora)))
    }

    /// El contador que toca: el elegido en el widget o, si no se eligió
    /// ninguno (o el elegido ya no existe), el más cercano de los que quedan.
    private func elegido(_ configuration: ElegirContadorIntent) -> Contador? {
        let vigentes = AlmacenContadores.vigentes()
        if let id = configuration.contador?.id, let c = vigentes.first(where: { $0.id == id }) { return c }
        return vigentes.first
    }

    /// Cuándo pedir la siguiente tanda: al pasar la fecha, al entrar en el
    /// último día, o dentro de una hora.
    private func cuandoVolver(_ contador: Contador?, _ ahora: Date) -> Date {
        guard let contador else { return ahora.addingTimeInterval(3600) }
        let fecha = contador.fechaVigente(desde: ahora)
        if fecha <= ahora { return ahora.addingTimeInterval(3600) }
        let faltan = fecha.timeIntervalSince(ahora)
        if faltan <= 24 * 3600 { return fecha.addingTimeInterval(1) }
        // Con los segundos corriendo, la tanda siguiente toca cuando el número
        // de días baja: ni antes (no cambiaría nada) ni después (se quedaría un
        // día de más en pantalla).
        if contador.estilo == .completo && contador.conHora {
            let corte = contador.diasYCorte(desde: ahora).corte
            // Hay que repintar cuando cambia lo que va delante del reloj del
            // sistema: al cruzar las diez horas ("10:.." → "09:..") y la una
            // ("1:.." → "00:.."), y al llegar al corte, que bajan los días.
            for limite in [corte.addingTimeInterval(-10 * 3600), corte.addingTimeInterval(-3600)] where limite > ahora {
                return limite
            }
            return corte.addingTimeInterval(1)
        }
        return min(fecha.addingTimeInterval(-24 * 3600), ahora.addingTimeInterval(3600))
    }
}

struct ContadorWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "com.themakercrowd.silosenosalgo.contador",
            intent: ElegirContadorIntent.self,
            provider: ProveedorContadores()
        ) { entrada in
            // El fondo lo pone la propia vista: depende del contador (su foto).
            VistaContador(entrada: entrada)
        }
        .configurationDisplayName("Cuenta atrás")
        .description("Lo que falta para tu carrera, o para lo que tú quieras.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct WidgetsSiLoSeNoSalgo: WidgetBundle {
    var body: some Widget { ContadorWidget() }
}

extension Contador {
    /// El de la vitrina: el que se ve al elegir el widget, antes de tener datos.
    static var ejemplo: Contador {
        Contador(
            id: "ejemplo",
            origen: .carrera,
            nombre: "Matxicots 26",
            fecha: Date().addingTimeInterval(12 * 24 * 3600 + 3 * 3600),
            color: "#8b5cf6",
            emoji: "🐻",
            alPasar: .contarArriba
        )
    }
}
