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

    /// «La siguiente que venza»: no una en concreto, sino la que toque en
    /// cada momento (ver `AlmacenContadores.siguiente`).
    static let idAutomatico = "automatico"
    static var automatico: ContadorEntity {
        ContadorEntity(id: idAutomatico, nombre: "⏭️ La siguiente que venza", cuando: .distantFuture)
    }
    var esAutomatico: Bool { id == Self.idAutomatico }

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Cuenta atrás" }
    static var defaultQuery = ConsultaContadores()

    var displayRepresentation: DisplayRepresentation {
        if esAutomatico {
            return DisplayRepresentation(title: "\(nombre)", subtitle: "Cuando vence, pasa sola a la siguiente")
        }
        return DisplayRepresentation(
            title: "\(nombre)",
            subtitle: "\(cuando.formatted(.dateTime.day().month(.abbreviated).year()))"
        )
    }
}

struct ConsultaContadores: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ContadorEntity] {
        ([ContadorEntity.automatico] + todos()).filter { identifiers.contains($0.id) }
    }

    /// La automática, la primera; después, una en concreto.
    func suggestedEntities() async throws -> [ContadorEntity] { [ContadorEntity.automatico] + todos() }

    /// Sin elegir nada: la automática. Antes era la más cercana, pero fijada:
    /// al vencer, el widget se quedaba en ella en vez de pasar a la siguiente.
    func defaultResult() async -> ContadorEntity? { ContadorEntity.automatico }

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
