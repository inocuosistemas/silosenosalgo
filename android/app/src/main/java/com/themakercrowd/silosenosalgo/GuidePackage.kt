package com.themakercrowd.silosenosalgo

import android.content.Context
import android.net.Uri
import kotlinx.serialization.encodeToString
import java.io.File
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Exportar e importar paquetes `.slsnsguide`: una ruta terminada entera —traza,
 * notas, fotos, audios y plan— en un solo archivo que se puede mandar por
 * mensajería y abrir sin conexión.
 *
 * Espejo de `ios/Sources/GuidePackage.swift`, y el formato está en
 * `../docs/slsnsguide-v1.md`. Lo que decide qué se acepta vive en [GuideRules],
 * probado en la JVM: aquí solo se mueven bytes.
 *
 * Las teselas del mapa quedan FUERA a propósito. Son caché de cada visor, pesan
 * mucho más que todo lo demás junto, y meterlas convertiría un archivo que se
 * manda por WhatsApp en uno que no se puede mandar.
 */
object GuidePackage {

    /**
     * Empaqueta una sesión con lo que haya guardado en el móvil. Devuelve el
     * fichero creado en la caché, listo para compartir.
     *
     * Null si la sesión no tiene traza local: sin ella no hay guía que hacer, y
     * exportar un archivo vacío sería peor que decir que no se puede.
     */
    fun exporta(
        context: Context,
        almacen: LocalStore,
        sesion: TrackSessionSummary,
        ahoraMs: Double,
    ): File? {
        val traza = almacen.leeTraza(sesion.id)
        if (traza.isEmpty()) return null

        val notas = almacen.leeNotas(sesion.id)
        val plan = almacen.leePlan(sesion.id)

        val medios = notas.flatMap { nota ->
            listOfNotNull(
                nota.photoKey?.let { GuideRules.Medio(nota.id, "photo", "media/${GuideRules.nombreMedio(nota.id, "photo")}", "image/jpeg") },
                nota.audioKey?.let { GuideRules.Medio(nota.id, "audio", "media/${GuideRules.nombreMedio(nota.id, "audio")}", "audio/mp4") },
            )
        }.filter { almacen.leeMedio(sesion.id, it.path.substringAfterLast('/')) != null }

        val manifiesto = GuideRules.Manifiesto(
            format = GuideRules.FORMATO,
            version = GuideRules.VERSION,
            id = sesion.id,
            title = sesion.title,
            startedAt = sesion.startedAt,
            endedAt = sesion.endedAt,
            exportedAt = ahoraMs,
            trailPath = "trail.json",
            notesPath = "notes.json",
            planPath = if (plan != null) "plan.gz" else null,
            media = medios,
        )

        val destino = File(context.cacheDir, GuideRules.nombreDeFichero(sesion.title))
        return runCatching {
            ZipOutputStream(destino.outputStream().buffered()).use { zip ->
                zip.escribe("manifest.json", Api.json.encodeToString(manifiesto).toByteArray())
                zip.escribe("trail.json", Api.json.encodeToString(traza).toByteArray())
                zip.escribe("notes.json", Api.json.encodeToString(notas).toByteArray())
                plan?.let { zip.escribe("plan.gz", it) }
                for (medio in medios) {
                    val nombre = medio.path.substringAfterLast('/')
                    almacen.leeMedio(sesion.id, nombre)?.let { zip.escribe(medio.path, it) }
                }
            }
            destino
        }.getOrNull()
    }

    private fun ZipOutputStream.escribe(ruta: String, datos: ByteArray) {
        putNextEntry(ZipEntry(ruta))
        write(datos)
        closeEntry()
    }

    /** El resultado de importar: la guía, o el motivo por el que no. */
    sealed class Resultado {
        data class Bien(val guia: GuideRules.GuiaLocal) : Resultado()
        data class Mal(val rechazo: GuideRules.Rechazo) : Resultado()
    }

    /**
     * Abre un paquete y lo deja guardado en el móvil bajo su propio id.
     *
     * Se extrae primero a un directorio temporal y solo después se copia a su
     * sitio: si algo del paquete no cuadra, no queda media guía instalada.
     */
    fun importa(
        context: Context,
        almacen: LocalStore,
        origen: Uri,
        ahoraMs: Double,
    ): Resultado {
        val temporal = File(context.cacheDir, "import-${System.nanoTime()}").apply { mkdirs() }
        try {
            val entradas = runCatching {
                context.contentResolver.openInputStream(origen)?.use { extrae(it, temporal) }
            }.getOrNull() ?: return Resultado.Mal(GuideRules.Rechazo.NoEsGuia)
            if (!entradas) return Resultado.Mal(GuideRules.Rechazo.Enorme)

            val manifiesto = runCatching {
                Api.json.decodeFromString<GuideRules.Manifiesto>(
                    File(temporal, "manifest.json").readText(),
                )
            }.getOrNull() ?: return Resultado.Mal(GuideRules.Rechazo.NoEsGuia)

            GuideRules.valida(manifiesto)?.let { return Resultado.Mal(it) }

            val traza = runCatching {
                Api.json.decodeFromString<List<TrailPoint>>(
                    File(temporal, manifiesto.trailPath).readText(),
                )
            }.getOrNull() ?: return Resultado.Mal(GuideRules.Rechazo.Incompleto)

            var notas = runCatching {
                Api.json.decodeFromString<List<Note>>(
                    File(temporal, manifiesto.notesPath).readText(),
                )
            }.getOrNull() ?: return Resultado.Mal(GuideRules.Rechazo.Incompleto)

            val id = GuideRules.idLocal(manifiesto.id)
            almacen.limpiaSesion(id)   // una reimportación sustituye, no mezcla
            almacen.guardaTraza(id, traza)

            var copiados = 0
            for (medio in manifiesto.media) {
                val fuente = File(temporal, medio.path)
                if (!fuente.exists()) continue
                val nombre = GuideRules.nombreMedio(medio.noteId, medio.kind)
                runCatching { almacen.ficheroMedio(id, nombre).writeBytes(fuente.readBytes()) }
                    .onSuccess {
                        copiados++
                        // Las claves se reescriben con el nombre local: las del
                        // paquete son del móvil de quien lo exportó.
                        notas = notas.map { nota ->
                            if (nota.id != medio.noteId) nota
                            else if (medio.kind == "photo") nota.copy(photoKey = nombre)
                            else nota.copy(audioKey = nombre)
                        }
                    }
            }
            almacen.guardaNotas(id, notas)

            manifiesto.planPath?.let { ruta ->
                val fuente = File(temporal, ruta)
                if (fuente.exists()) runCatching { almacen.guardaPlan(id, fuente.readBytes()) }
            }

            return Resultado.Bien(
                GuideRules.GuiaLocal(
                    id = id,
                    sesionOrigen = manifiesto.id,
                    titulo = manifiesto.title ?: "Guía",
                    startedAt = manifiesto.startedAt,
                    endedAt = manifiesto.endedAt,
                    importadaMs = ahoraMs,
                    notas = notas.size,
                    medios = copiados,
                ),
            )
        } finally {
            runCatching { temporal.deleteRecursively() }
        }
    }

    /**
     * Extrae el ZIP comprobando CADA entrada antes de escribirla. Devuelve false
     * si el paquete se pasa de los topes.
     *
     * Los topes no son paranoia de manual: un ZIP puede comprimir gigas a unos
     * pocos kilobytes, y el móvil de alguien que va al monte no puede quedarse
     * sin espacio por abrir un archivo que le mandaron.
     */
    private fun extrae(entrada: InputStream, destino: File): Boolean {
        var total = 0L
        var cuantas = 0
        ZipInputStream(entrada.buffered()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (++cuantas > GuideRules.MAX_ENTRADAS) return false
                if (e.isDirectory) { zip.closeEntry(); continue }
                if (!GuideRules.esRutaSegura(e.name)) { zip.closeEntry(); continue }

                val fichero = File(destino, e.name)
                // Cinturón y tirantes: aunque la ruta parezca buena, el fichero
                // resultante tiene que caer DENTRO del temporal.
                if (!fichero.canonicalPath.startsWith(destino.canonicalPath + File.separator)) {
                    zip.closeEntry()
                    continue
                }
                fichero.parentFile?.mkdirs()

                fichero.outputStream().buffered().use { salida ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        val leidos = zip.read(buffer)
                        if (leidos <= 0) break
                        total += leidos
                        if (total > GuideRules.MAX_DESCOMPRIMIDO_BYTES) return false
                        salida.write(buffer, 0, leidos)
                    }
                }
                zip.closeEntry()
            }
        }
        return true
    }
}
