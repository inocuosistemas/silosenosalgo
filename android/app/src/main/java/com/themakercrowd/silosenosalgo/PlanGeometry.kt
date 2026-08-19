package com.themakercrowd.silosenosalgo

import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.util.zip.GZIPInputStream

/**
 * Saca el trazado de una ruta planificada de su blob guardado, que es lo que
 * permite bajarse el mapa de la travesía por adelantado.
 *
 * Espejo de `ios/Sources/PlanGeometry.swift`. Allí hay que descomprimir el gzip
 * a mano —quitando cabecera y cola— porque la API de compresión de Apple solo
 * entiende deflate crudo; aquí `GZIPInputStream` lo hace directamente, así que
 * esa complicación no se porta.
 *
 * Los blobs los genera el navegador con `CompressionStream('gzip')` al guardar
 * el plan, y viajan comprimidos de punta a punta: el backend no los toca.
 */
object PlanGeometry {

    /** Tope de descompresión. Un blob manipulado podría expandirse hasta
     *  quedarse con toda la memoria; un plan real no pasa de unos pocos MB. */
    const val MAX_DESCOMPRIMIDO = 32 * 1024 * 1024

    fun descomprime(gz: ByteArray): ByteArray? = runCatching {
        GZIPInputStream(ByteArrayInputStream(gz)).use { entrada ->
            val salida = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val leidos = entrada.read(buffer)
                if (leidos <= 0) break
                total += leidos
                if (total > MAX_DESCOMPRIMIDO) return null
                salida.write(buffer, 0, leidos)
            }
            salida.toByteArray()
        }
    }.getOrNull()

    /**
     * El trazado `[(lat, lon)]` que hay dentro de un SharePayload comprimido.
     * Null si el blob no se puede leer o no trae ruta: entonces no hay corredor
     * que descargar y hay que decirlo, no fabricar una ruta vacía.
     */
    fun trazado(gz: ByteArray): List<Pair<Double, Double>>? = runCatching {
        val json = descomprime(gz) ?: return null
        val raiz = Api.json.parseToJsonElement(json.toString(Charsets.UTF_8)).jsonObject
        val puntos = raiz["track"]?.jsonObject?.get("points")?.jsonArray ?: return null

        val ruta = puntos.mapNotNull { punto ->
            val o = punto.jsonObject
            val lat = o["lat"]?.jsonPrimitive?.doubleOrNull
            val lon = o["lon"]?.jsonPrimitive?.doubleOrNull
            if (lat != null && lon != null) lat to lon else null
        }
        ruta.ifEmpty { null }
    }.getOrNull()

    /** El nombre de la ruta, para poder decir qué se está descargando. */
    fun nombre(gz: ByteArray): String? = runCatching {
        val json = descomprime(gz) ?: return null
        val raiz = Api.json.parseToJsonElement(json.toString(Charsets.UTF_8)).jsonObject
        raiz["name"]?.jsonPrimitive?.contentOrNull
            ?: raiz["track"]?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    /**
     * Por dónde bajar el mapa: la ruta planificada si la hay y, si no, la traza
     * ya recorrida — para que una salida sin plan también pueda cachear el mapa
     * de por donde ha pasado.
     */
    fun rutaParaDescargar(
        planificada: List<Pair<Double, Double>>?,
        recorrida: List<TrailPoint>,
    ): List<Pair<Double, Double>>? = when {
        !planificada.isNullOrEmpty() -> planificada
        recorrida.isNotEmpty() -> recorrida.map { it.lat to it.lon }
        else -> null
    }
}
