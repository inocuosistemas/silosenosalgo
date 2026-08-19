package com.themakercrowd.silosenosalgo

/**
 * La taxonomía de las notas de campo. Espejo de `shared/poiTypes.ts` y de
 * `ios/Sources/PoiTypes.swift`: **los tres tienen que ir a la vez**, con los
 * mismos slugs, etiquetas y emojis. Una nota solo lleva su `slug`; la
 * correspondencia con el `<sym>` de GPX y las etiquetas de OSM vive en el lado
 * web, al exportar.
 */
data class PoiType(val slug: String, val label: String, val emoji: String)

object PoiTypes {
    val all: List<PoiType> = listOf(
        PoiType("water", "Agua / Fuente", "🥤"),
        PoiType("aid", "Avituallamiento", "🧃"),
        PoiType("food", "Comida", "🍽️"),
        PoiType("summit", "Cima / Puerto", "⛰️"),
        PoiType("viewpoint", "Mirador", "👁️"),
        PoiType("shelter", "Refugio", "🏠"),
        PoiType("camp", "Campamento", "⛺"),
        PoiType("danger", "Peligro", "⚠️"),
        PoiType("gate", "Cancela / Paso", "🚧"),
        PoiType("junction", "Cruce / Desvío", "🔀"),
        PoiType("info", "Información", "ℹ️"),
        PoiType("control", "Control", "✓"),
        PoiType("start", "Salida", "🚩"),
        PoiType("finish", "Meta", "🏁"),
        PoiType("generic", "Nota", "📍"),
    )

    const val DEFAULT_SLUG = "generic"

    fun label(slug: String): String = all.firstOrNull { it.slug == slug }?.label ?: "Nota"
    fun emoji(slug: String): String = all.firstOrNull { it.slug == slug }?.emoji ?: "📍"
}
