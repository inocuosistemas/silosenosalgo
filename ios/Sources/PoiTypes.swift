import Foundation

/// Field-note POI taxonomy — the Swift mirror of `shared/poiTypes.ts`. Keep both
/// lists in sync (same slugs/labels/emoji). The canonical GPX `<sym>` / OSM tag
/// mapping lives on the web/export side; a note only carries its `slug`.
struct PoiType: Identifiable, Hashable {
    let slug: String
    let label: String
    let emoji: String
    var id: String { slug }
}

enum PoiTypes {
    static let all: [PoiType] = [
        PoiType(slug: "water",     label: "Agua / Fuente",   emoji: "🥤"),
        PoiType(slug: "aid",       label: "Avituallamiento", emoji: "🧃"),
        PoiType(slug: "food",      label: "Comida",          emoji: "🍽️"),
        PoiType(slug: "summit",    label: "Cima / Puerto",   emoji: "⛰️"),
        PoiType(slug: "viewpoint", label: "Mirador",         emoji: "👁️"),
        PoiType(slug: "shelter",   label: "Refugio",         emoji: "🏠"),
        PoiType(slug: "camp",      label: "Campamento",      emoji: "⛺"),
        PoiType(slug: "danger",    label: "Peligro",         emoji: "⚠️"),
        PoiType(slug: "gate",      label: "Cancela / Paso",  emoji: "🚧"),
        PoiType(slug: "junction",  label: "Cruce / Desvío",  emoji: "🔀"),
        PoiType(slug: "info",      label: "Información",      emoji: "ℹ️"),
        PoiType(slug: "control",   label: "Control",         emoji: "✓"),
        PoiType(slug: "start",     label: "Salida",          emoji: "🚩"),
        PoiType(slug: "finish",    label: "Meta",            emoji: "🏁"),
        PoiType(slug: "generic",   label: "Nota",            emoji: "📍"),
    ]

    static let defaultSlug = "generic"

    static func label(_ slug: String) -> String { all.first { $0.slug == slug }?.label ?? "Nota" }
    static func emoji(_ slug: String) -> String { all.first { $0.slug == slug }?.emoji ?? "📍" }
}
