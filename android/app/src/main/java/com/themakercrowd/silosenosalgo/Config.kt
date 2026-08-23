package com.themakercrowd.silosenosalgo

/**
 * Espejo de `ios/Sources/Config.swift`. Los dos clientes hablan con el MISMO
 * backend y comparten formato de enlace: cualquier cambio aquí tiene que ir
 * también allí (y al revés).
 */
object Config {
    /** URL canónica: el dominio propio, y SOLO ese. Vale para la API y para los
     *  enlaces que se comparten.
     *
     *  Aquí antes había `https://silosenosalgo.pages.dev`, el subdominio que
     *  Cloudflare regala al proyecto de Pages, y eso dejó la app muerta el día
     *  que ese nombre dejó de responder: comprobado desde dos redes distintas,
     *  ni siquiera aceptaba la conexión TCP, mientras el dominio propio servía
     *  la misma API sin enterarse. Y el fallo no se ve: `cargaSesiones()` se
     *  traga el error a propósito para no borrar una lista buena cuando no hay
     *  cobertura, así que "Mis seguimientos" sale VACÍO como si no hubiera
     *  nada, que es lo peor que puede parecer.
     *
     *  El dominio propio es el único que controlamos nosotros: apunta donde
     *  queramos y sobrevive a cambiar de proveedor, de nombre de proyecto o de
     *  lo que Cloudflare decida hacer con sus subdominios de regalo. Una app
     *  instalada en el móvil de otra persona no se puede "arreglar" a distancia:
     *  lo que lleve escrito aquí es lo que usará durante meses. */
    const val BASE_URL = "https://silosenosalgo.themakercrowd.com"

    /** El mismo, con nombre propio porque es el que se comparte. Se mantienen
     *  las dos constantes para no tocar las llamadas y porque iOS es su espejo. */
    const val PUBLIC_URL = BASE_URL

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
