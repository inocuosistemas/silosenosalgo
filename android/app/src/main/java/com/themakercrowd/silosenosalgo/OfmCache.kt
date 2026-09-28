package com.themakercrowd.silosenosalgo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.net.URLEncoder

/**
 * El mapa de OpenFreeMap, guardado en el móvil: lo que el visor pide por
 * `/_ofm/<ruta>` se sirve del disco y, si no está, se baja de
 * `https://tiles.openfreemap.org/<ruta>` y se guarda. Estilo, iconos, letras y
 * mosaicos vectoriales, todo por el mismo camino (ver `lib/mapaBase.ts` en la web).
 *
 * Sustituye a los mosaicos de OpenStreetMap ([TileCache]), cuyas normas prohíben
 * el uso intenso desde una app repartida al público y descargarlos para usarlos
 * sin conexión. OpenFreeMap es gratis, sin límites ni clave.
 *
 * Lo que puede cambiar (el estilo y el índice `planet`, que apunta a la versión
 * vigente de los mosaicos) se pide primero a la red y, sin ella, se sirve lo
 * guardado; lo demás (mosaicos de una versión, letras, iconos) no cambia nunca,
 * así que se sirve del disco sin preguntar.
 */
class OfmCache(context: Context) {

    private val raiz = File(context.filesDir, "ofm")
    private val cliente = Api.defaultClient

    /** Tres descargas a la vez: la descarga de un corredor, sin ahogar la red. */
    private val permisos = Semaphore(3)

    /** Lo que no tiene extensión (el estilo, el índice `planet`) se guarda como
     *  `.json`: si no, el fichero `planet` impediría la carpeta `planet/` de los
     *  mosaicos. */
    private fun fichero(ruta: String): File {
        val limpia = ruta.trimStart('/')
        return File(raiz, if (limpia.substringAfterLast('/').contains('.')) limpia else "$limpia.json")
    }

    private fun esCambiante(ruta: String) = ruta.startsWith("styles/") || ruta == "planet"

    /** Los bytes y el tipo de `ruta` (la parte tras `/_ofm/`), o null si no hay forma de tenerlos. */
    suspend fun lee(ruta: String): Pair<ByteArray, String>? = withContext(Dispatchers.IO) {
        if (ruta.contains("..")) return@withContext null
        val f = fichero(ruta)
        if (!esCambiante(ruta)) runCatching { if (f.exists()) return@withContext f.readBytes() to tipo(ruta) }
        val bajada = baja(ruta)
        if (bajada != null) {
            runCatching { f.parentFile?.mkdirs(); f.writeBytes(bajada) }
            return@withContext bajada to tipo(ruta)
        }
        runCatching { if (f.exists()) f.readBytes() to tipo(ruta) else null }.getOrNull()
    }

    private suspend fun baja(ruta: String): ByteArray? = permisos.withPermit {
        runCatching {
            val url = "https://tiles.openfreemap.org/" + ruta.split('/').joinToString("/") {
                URLEncoder.encode(it, "UTF-8").replace("+", "%20")
            }
            val req = Request.Builder().url(url).header("User-Agent", Config.TILE_USER_AGENT).build()
            cliente.newCall(req).execute().use { r ->
                if (!r.isSuccessful) null else r.body?.bytes()?.takeIf { it.isNotEmpty() }
            }
        }.getOrNull()
    }

    private fun tipo(ruta: String) = when {
        ruta.endsWith(".png") -> "image/png"
        ruta.endsWith(".pbf") -> "application/x-protobuf"
        else -> "application/json"
    }

    // ── Descargar el mapa de una ruta ────────────────────────────────────────

    /** La plantilla de los mosaicos de la versión vigente (del índice `planet`
     *  guardado), relativa: "planet/<versión>/{z}/{x}/{y}.pbf". */
    private fun plantilla(): String? = runCatching {
        val json = fichero("planet").takeIf { it.exists() }?.readText() ?: return null
        val tiles = Api.json.parseToJsonElement(json) as? kotlinx.serialization.json.JsonObject ?: return null
        val t = (tiles["tiles"] as? kotlinx.serialization.json.JsonArray)?.firstOrNull()
            ?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: return null
        t.removePrefix("https://tiles.openfreemap.org/")
    }.getOrNull()

    private fun rutaDe(t: TileMath.Tesela, p: String) =
        p.replace("{z}", t.z.toString()).replace("{x}", t.x.toString()).replace("{y}", t.y.toString())

    fun estaEnDisco(z: Int, x: Int, y: Int): Boolean {
        val p = plantilla() ?: return false
        return fichero(rutaDe(TileMath.Tesela(z, x, y), p)).exists()
    }

    /** Cuántas de esas teselas ya están bajadas (de la versión vigente). */
    fun cuantasHay(teselas: Collection<TileMath.Tesela>): Int {
        val p = plantilla() ?: return 0
        return teselas.count { fichero(rutaDe(it, p)).exists() }
    }

    /**
     * Baja lo que hace falta para ver sin cobertura el mapa de un corredor: el
     * estilo, sus iconos y letras, el índice de mosaicos y los mosaicos. Los
     * mosaicos vectoriales llegan hasta el zoom 14 y se amplían desde ahí, así
     * que lo que pase de 14 no se pide.
     */
    suspend fun descargaCorredor(
        teselas: Collection<TileMath.Tesela>,
        alProgresar: (hechas: Int, total: Int) -> Unit = { _, _ -> },
        cancelado: () -> Boolean = { false },
    ): Int = withContext(Dispatchers.IO) {
        preparaBase()
        val p = plantilla() ?: return@withContext 0
        val pendientes = teselas.filter { it.z <= ZOOM_MAX }.filterNot { fichero(rutaDe(it, p)).exists() }
        val total = pendientes.size
        alProgresar(0, total)
        var hechas = 0
        for (tanda in pendientes.chunked(12)) {
            if (cancelado()) break
            coroutineScope { tanda.map { t -> async { lee(rutaDe(t, p)) } }.awaitAll() }
            hechas += tanda.size
            alProgresar(hechas, total)
        }
        hechas
    }

    /** Lo que necesita cualquier mapa: estilo, índice, iconos y letras. */
    private suspend fun preparaBase() {
        val estilo = lee("styles/liberty")?.first?.toString(Charsets.UTF_8) ?: return
        lee("planet")
        val obj = runCatching { Api.json.parseToJsonElement(estilo) as? kotlinx.serialization.json.JsonObject }.getOrNull() ?: return
        (obj["sprite"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            ?.removePrefix("https://tiles.openfreemap.org/")
            ?.let { s -> for (suf in listOf(".json", ".png", "@2x.json", "@2x.png")) lee(s + suf) }
        // Las letras: las familias que usa el estilo, en los tramos del
        // alfabeto latino (con tildes, eñes, cedillas… y los del turco o el
        // catalán, que caen en el segundo).
        val familias = Regex("\"text-font\"\\s*:\\s*\\[([^\\]]*)]").findAll(estilo)
            .flatMap { m -> Regex("\"([^\"]+)\"").findAll(m.groupValues[1]).map { it.groupValues[1] } }
            .toSet()
        for (f in familias) for (tramo in listOf("0-255", "256-511", "8192-8447")) lee("fonts/$f/$tramo.pbf")
    }

    /** Cuánto ocupa el mapa guardado (bytes). */
    fun bytesOcupados(): Long =
        runCatching { raiz.walkBottomUp().filter { it.isFile }.sumOf { it.length() } }.getOrDefault(0L)

    fun vacia() { runCatching { raiz.deleteRecursively() } }

    companion object {
        /** Hasta aquí llegan los mosaicos vectoriales de OpenFreeMap. */
        const val ZOOM_MAX = 14
    }
}
