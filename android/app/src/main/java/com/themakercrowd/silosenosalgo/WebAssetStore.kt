package com.themakercrowd.silosenosalgo

import android.content.Context
import java.io.File

/**
 * Resuelve los ficheros estáticos del visor incrustado (index.html, los de
 * `assets/`, iconos…) desde DOS orígenes, en este orden:
 *
 *  1. La copia OTA activa en `files/webota/active`, si la hay — el visor que se
 *     descargó de producción después de instalar la app.
 *  2. `assets/web/` empaquetado en el APK — el visor con el que se compiló.
 *
 * Espejo de `ios/Sources/WebAssetStore.swift`. Existe porque la app lleva una
 * copia congelada de `dist/`: sin esto, cada cambio del visor web exigiría
 * recompilar y publicar en Play. Con esto el visor se actualiza solo y el APK
 * queda de red de seguridad: si la copia OTA falta, está incompleta o no se
 * puede leer, se sirve la empaquetada y la app sigue funcionando igual que antes.
 *
 * Quien escribe la copia OTA es [WebOtaUpdater], y solo la activa cuando está
 * entera ([OtaRules] manda). Aquí nunca se mezclan orígenes a propósito: si hay
 * OTA activa se sirve de ella, y solo se cae al APK fichero a fichero cuando la
 * OTA no lo tiene (caso que el updater ya evita, pero más vale servir algo).
 */
class WebAssetStore(private val context: Context) {

    /** `files/webota` — almacenamiento interno, no visible desde fuera: es caché
     *  reconstruible, no datos del usuario. */
    val contenedorOta: File get() = File(context.filesDir, "webota")
    val dirActivo: File get() = File(contenedorOta, "active")
    val dirStaging: File get() = File(contenedorOta, "staging")

    /** La copia activa solo cuenta si existe Y tiene index.html; cualquier otra
     *  cosa es un resto a medias y se ignora (se servirá el APK). */
    fun hayOtaActiva(): Boolean = File(dirActivo, "index.html").exists()

    /** buildId instalado, para que el updater sepa si hay que descargar algo. */
    fun buildIdInstalado(): String? = runCatching {
        val f = File(dirActivo, "ota-buildid")
        if (f.exists()) f.readText().trim().ifEmpty { null } else null
    }.getOrNull()

    /**
     * Traduce una ruta de petición a bytes + MIME. Null solo si el fichero no
     * está en ninguno de los dos orígenes.
     */
    fun carga(ruta: String): Pair<ByteArray, String>? {
        var rel = if (ruta == "/" || ruta.isEmpty()) "index.html" else ruta.removePrefix("/")
        // Enlaces profundos y rutas sin extensión caen a la cáscara de la SPA.
        if (!rel.contains(".")) rel = "index.html"
        if (esRutaPeligrosa(rel)) return null

        if (hayOtaActiva()) {
            runCatching {
                val f = File(dirActivo, rel)
                if (f.exists()) return f.readBytes() to mime(rel)
            }
        }
        return runCatching {
            context.assets.open("web/$rel").use { it.readBytes() } to mime(rel)
        }.getOrNull()
    }

    /** Un `..` o una ruta absoluta se saldrían del directorio servido. Misma
     *  regla que [OtaRules.esRutaPeligrosa], aplicada también al leer. */
    private fun esRutaPeligrosa(rel: String): Boolean =
        rel.startsWith("/") || rel.split('/').any { it == ".." }

    companion object {
        fun mime(ruta: String): String = when (ruta.substringAfterLast('.', "").lowercase()) {
            // Los módulos ES EXIGEN un MIME de JavaScript: servirlos como
            // octet-stream hace que el navegador los rechace y el visor se quede
            // en blanco, sin más pista que un error en la consola.
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "html" -> "text/html"
            "json", "map" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "ico" -> "image/x-icon"
            "gpx", "xml" -> "application/xml"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
