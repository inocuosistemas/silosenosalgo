package com.themakercrowd.silosenosalgo

import kotlinx.serialization.Serializable
import java.security.MessageDigest

/**
 * Las REGLAS del actualizador OTA del visor, sin nada de Android ni de red.
 *
 * Espejo de `ios/Sources/WebOTAUpdater.swift`. La regla que gobierna el diseño
 * es **todo o nada**: esta es una app de montaña y el visor incrustado tiene
 * que funcionar sin cobertura, así que un build a medias no puede llegar a
 * activarse nunca.
 *
 * Vive aparte del código que descarga y escribe en disco para poder probar aquí
 * —en la JVM, sin emulador— justo lo que no se puede probar a mano: que un
 * build corrupto, incompleto o mezclado se rechaza.
 */
object OtaRules {

    /** Tope de tamaño: el visor ronda los 4 MB; por encima de esto algo va mal
     *  (respuesta rara, manifiesto corrupto) y no merece gastar datos móviles. */
    const val MAX_TOTAL_BYTES = 24 * 1024 * 1024

    @Serializable
    data class Entry(val path: String, val sha256: String, val bytes: Int)

    @Serializable
    data class Manifest(val buildId: String, val files: List<Entry>, val totalBytes: Int)

    /** Por qué se ha rechazado un build. Cada motivo es un fallo real visto en
     *  producción, no una posibilidad teórica. */
    sealed class Rechazo(val motivo: String) {
        data object Vacio : Rechazo("el manifiesto no trae ficheros")
        data object Enorme : Rechazo("el build pasa del tope de tamaño")
        data class RutaPeligrosa(val path: String) : Rechazo("ruta fuera del directorio: $path")
        data object SinIndex : Rechazo("no hay index.html: sin cáscara no hay visor")
        data class HashDistinto(val path: String) : Rechazo("el hash no cuadra: $path")
        data object FaltanFicheros : Rechazo("falta algún fichero del manifiesto")
        data object CascaraDesparejada :
            Rechazo("index.html no apunta a ningún módulo de este build")
    }

    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    /**
     * ¿Se puede intentar descargar este manifiesto? Comprobaciones baratas,
     * antes de gastar datos.
     */
    fun validaManifiesto(m: Manifest): Rechazo? {
        if (m.files.isEmpty()) return Rechazo.Vacio
        // La seguridad de las rutas se mira ANTES que nada: un manifiesto que
        // intenta escribir fuera del directorio es hostil, y decir de él que
        // "le falta el index" sería contar la anécdota en vez de la noticia.
        m.files.firstOrNull { esRutaPeligrosa(it.path) }
            ?.let { return Rechazo.RutaPeligrosa(it.path) }
        if (m.totalBytes > MAX_TOTAL_BYTES) return Rechazo.Enorme
        if (m.files.none { it.path == "index.html" }) return Rechazo.SinIndex
        return null
    }

    /** Un `..` o una ruta absoluta escribiría fuera del directorio de staging. */
    fun esRutaPeligrosa(path: String): Boolean =
        path.startsWith("/") || path.split('/').any { it == ".." } || path.isBlank()

    /**
     * ¿El fichero descargado es el que dice el manifiesto?
     *
     * El HTML **no se puede verificar por hash**: `functions/_middleware.ts` lo
     * reescribe al servirlo (og:* a URLs absolutas, y en los enlaces `?s=`
     * también el título), así que los bytes servidos nunca coinciden con los
     * del build. Se valida por estructura en [validaDescarga]. Los assets, que
     * son los que llevan el código, sí van con hash estricto: pasan por el
     * middleware sin tocarse.
     */
    fun verificaFichero(entry: Entry, bytes: ByteArray): Boolean =
        if (entry.path.endsWith(".html")) true
        else sha256(bytes) == entry.sha256

    /**
     * La comprobación final antes de activar: están todos los ficheros y la
     * cáscara pertenece a ESTE build.
     *
     * Lo segundo no es paranoia: sin ello se podría guardar el index.html de un
     * build y los assets de otro, que es exactamente el escenario que deja el
     * visor en blanco.
     */
    fun validaDescarga(m: Manifest, descargados: Map<String, ByteArray>): Rechazo? {
        for (e in m.files) {
            val bytes = descargados[e.path] ?: return Rechazo.FaltanFicheros
            if (!verificaFichero(e, bytes)) return Rechazo.HashDistinto(e.path)
        }
        val shell = descargados["index.html"]?.toString(Charsets.UTF_8)
        if (shell.isNullOrEmpty()) return Rechazo.SinIndex

        val modulos = m.files.filter { it.path.startsWith("assets/") && it.path.endsWith(".js") }
        if (modulos.none { shell.contains(it.path) }) return Rechazo.CascaraDesparejada
        return null
    }

    /** ¿Hay build nuevo? Basta comparar el id: resume el conjunto entero. */
    fun hayQueActualizar(manifiesto: Manifest, instalado: String?): Boolean =
        manifiesto.buildId != instalado
}
