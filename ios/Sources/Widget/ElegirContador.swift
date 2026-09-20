import AppIntents
import WidgetKit

/**
 Elegir QUÉ contador enseña cada widget.

 Con esto, manteniendo pulsado el widget se elige la carrera (o el contador
 propio) que enseña, y se pueden tener varios en la pantalla de inicio, cada
 uno con el suyo. Sin elegir nada, el widget enseña el más cercano: es lo que
 quiere ver quien acaba de ponerlo.
 */
struct ContadorEntity: AppEntity, Identifiable {
    var id: String
    var nombre: String
    var cuando: Date

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Cuenta atrás" }
    static var defaultQuery = ConsultaContadores()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(nombre)",
            subtitle: "\(cuando.formatted(.dateTime.day().month(.abbreviated).year()))"
        )
    }
}

struct ConsultaContadores: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ContadorEntity] {
        todos().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [ContadorEntity] { todos() }

    /// Sin elegir nada: el más cercano. Así el widget recién puesto ya enseña algo.
    func defaultResult() async -> ContadorEntity? { todos().first }

    private func todos() -> [ContadorEntity] {
        AlmacenContadores.vigentes().map {
            ContadorEntity(id: $0.id, nombre: $0.nombre, cuando: $0.fechaVigente())
        }
    }
}

struct ElegirContadorIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Cuenta atrás" }
    static var description: IntentDescription { "Qué cuenta atrás enseña este widget." }

    @Parameter(title: "Qué se enseña")
    var contador: ContadorEntity?

    init() {}
    init(contador: ContadorEntity?) { self.contador = contador }
}
