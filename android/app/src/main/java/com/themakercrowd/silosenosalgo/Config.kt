package com.themakercrowd.silosenosalgo

/**
 * Espejo de `ios/Sources/Config.swift`. Los dos clientes hablan con el MISMO
 * backend y comparten formato de enlace: cualquier cambio aquí tiene que ir
 * también allí (y al revés).
 */
object Config {
    /** Backend (Cloudflare Pages). */
    const val BASE_URL = "https://silosenosalgo.pages.dev"

    /** URL PÚBLICA canónica — todo enlace que se comparte usa esta, nunca pages.dev. */
    const val PUBLIC_URL = "https://silosenosalgo.themakercrowd.com"

    /** Enlace público de seguimiento para el token de una sesión. */
    fun shareLink(token: String): String = "$PUBLIC_URL/?t=$token"

    // Teselas del mapa offline

    /** Plantilla de teselas OSM. En un solo sitio para poder cambiar de
     *  proveedor: la política de uso de OSM desaconseja las descargas masivas. */
    const val TILE_URL_TEMPLATE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    val TILE_SUBDOMAINS = listOf("a", "b", "c")

    /** User-Agent descriptivo que exige la política de teselas de OSM (los
     *  genéricos o ausentes acaban bloqueados). Propio de Android para poder
     *  distinguir el tráfico del de iOS. */
    const val TILE_USER_AGENT =
        "SiLoSeNoSalgo-Android/1.0 (+https://silosenosalgo.themakercrowd.com; tic@iemed.org)"
}
