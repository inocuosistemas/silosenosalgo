package com.themakercrowd.silosenosalgo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Caché en disco de las teselas del mapa incrustado. Sirve a
 * `/_tile/z/x/y.png`: si está en disco se devuelve; si no y hay cobertura se
 * baja y se guarda (la caché se llena sola según se mira el mapa); y si no hay
 * cobertura se devuelve un cuadro neutro.
 *
 * Espejo de `ios/Sources/TileCache.swift` en su parte esencial. Falta todavía la
 * descarga por adelantado del corredor de una ruta, que es lo que se hace la
 * noche antes de salir.
 *
 * **Nunca falla**: siempre devuelve un PNG dibujable. Un hueco en el mapa se lee
 * como "esto no lo tengo descargado", que es información útil; un error se lee
 * como que la app está rota.
 *
 * La política de uso de teselas de OSM manda aquí: User-Agent descriptivo (está
 * en [Config]), como mucho **2 conexiones a la vez** y una pausa entre
 * peticiones. Si algún día hace falta descargar en masa, hay que cambiar de
 * proveedor en `Config`, no subir estos números.
 */
class TileCache(context: Context) {

    private val raiz = File(context.filesDir, "teselas")
    private val cliente: OkHttpClient = Api.defaultClient

    /** Como mucho dos descargas simultáneas: lo que pide la política de OSM. */
    private val permisos = Semaphore(2)

    private val marcador: ByteArray by lazy { creaMarcador() }

    private fun fichero(z: Int, x: Int, y: Int): File = File(raiz, "$z/$x/$y.png")

    fun estaEnDisco(z: Int, x: Int, y: Int): Boolean = fichero(z, x, y).exists()

    /**
     * Bytes de una tesela: disco → red → marcador. El orden importa: mirar el
     * disco primero es lo que hace que el mapa se mueva fluido sin cobertura y
     * lo que evita volver a pedir a OSM algo que ya tenemos.
     */
    suspend fun tesela(z: Int, x: Int, y: Int): ByteArray = withContext(Dispatchers.IO) {
        if (z < 0 || z > 19) return@withContext marcador
        val destino = fichero(z, x, y)
        runCatching { if (destino.exists()) return@withContext destino.readBytes() }

        val bajada = descarga(z, x, y)
        if (bajada != null) {
            runCatching {
                destino.parentFile?.mkdirs()
                destino.writeBytes(bajada)
            }
            bajada
        } else {
            marcador
        }
    }

    private suspend fun descarga(z: Int, x: Int, y: Int): ByteArray? = permisos.withPermit {
        // Pausa entre peticiones: la política de OSM no quiere ráfagas, y el
        // mapa pide muchas teselas de golpe al desplazarse.
        delay(60)
        val subdominio = Config.TILE_SUBDOMAINS[(x + y) % Config.TILE_SUBDOMAINS.size]
        val url = Config.TILE_URL_TEMPLATE
            .replace("{s}", subdominio)
            .replace("{z}", z.toString())
            .replace("{x}", x.toString())
            .replace("{y}", y.toString())

        runCatching {
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", Config.TILE_USER_AGENT)
                .build()
            cliente.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                resp.body?.bytes()?.takeIf { it.isNotEmpty() }
            }
        }.getOrNull()
    }

    /** Cuadro neutro de 256×256 para lo que no está descargado. Del color del
     *  fondo del visor, para que un hueco parezca un hueco y no un fallo. */
    private fun creaMarcador(): ByteArray {
        val bmp = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.rgb(0x1e, 0x29, 0x3b))
        return ByteArrayOutputStream().use { salida ->
            bmp.compress(Bitmap.CompressFormat.PNG, 100, salida)
            salida.toByteArray()
        }
    }

    /** Cuánto ocupa la caché en disco (bytes), para poder enseñarlo y limpiarlo. */
    fun bytesOcupados(): Long =
        runCatching { raiz.walkBottomUp().filter { it.isFile }.sumOf { it.length() } }
            .getOrDefault(0L)

    fun vacia() {
        runCatching { raiz.deleteRecursively() }
    }

    companion object {
        /** Traduce "/_tile/z/x/y.png" a coordenadas, o null si no es esa ruta. */
        fun parseaRuta(ruta: String): Triple<Int, Int, Int>? {
            if (!ruta.startsWith("/_tile/")) return null
            val partes = ruta.removePrefix("/_tile/").split("/")
            if (partes.size != 3) return null
            val z = partes[0].toIntOrNull() ?: return null
            val x = partes[1].toIntOrNull() ?: return null
            val y = partes[2].substringBefore('.').toIntOrNull() ?: return null
            return Triple(z, x, y)
        }
    }
}
