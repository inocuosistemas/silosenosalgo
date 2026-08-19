package com.themakercrowd.silosenosalgo

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File

/**
 * Lo que sobrevive a que el sistema mate la app: el atasco de posiciones sin
 * subir, la traza retenida de la sesión y el estado activo para poder reanudar.
 *
 * Espejo de `LocalStore` + los `UserDefaults` de `ios/Sources/TrackingStore.swift`.
 *
 * Aquí pesa más que en iOS. En Android —y en un Samsung con One UI, más— el
 * sistema mata el proceso sin avisar: todo lo que no esté en disco cuando eso
 * pasa se ha perdido. Por eso se escribe en cada posición registrada y no cada
 * N: el coste es un fichero pequeño cada pocos segundos, y lo que compra es que
 * una muerte del proceso a mitad de travesía no borre el tramo sin cobertura.
 */
class LocalStore(context: Context) {

    private val raiz = File(context.filesDir, "seguimiento")
    private val prefs = context.getSharedPreferences("slsns_seguimiento", Context.MODE_PRIVATE)

    /** El estado de la sesión viva, para reanudarla tras un reinicio o una
     *  muerte del proceso. */
    @Serializable
    data class EstadoActivo(
        val sessionId: String,
        val enEspera: Boolean = false,
        val modo: String = TrackingRules.Modo.DISTANCIA.name,
        val intervaloSegundos: Double = 15.0,
        val distanciaMetros: Double = 100.0,
        val perfil: String = TrackingRules.Perfil.EQUILIBRADO.name,
        val salidaMs: Double = 0.0,
        val retenerHoras: Double = 48.0,
        val actividad: String? = null,
        val titulo: String? = null,
        val guardadoMs: Double = 0.0,
    )

    private fun dir(sessionId: String): File =
        File(raiz, sessionId).apply { if (!exists()) mkdirs() }

    private fun ficheroPendientes(sessionId: String) = File(dir(sessionId), "pendientes.json")
    private fun ficheroTraza(sessionId: String) = File(dir(sessionId), "traza.json")

    // ── Atasco de posiciones ─────────────────────────────────────────────────

    fun guardaPendientes(sessionId: String, pendientes: List<Fix>) {
        escribe(ficheroPendientes(sessionId), Api.json.encodeToString(pendientes))
    }

    fun leePendientes(sessionId: String): List<Fix> =
        lee(ficheroPendientes(sessionId))
            ?.let { runCatching { Api.json.decodeFromString<List<Fix>>(it) }.getOrNull() }
            ?: emptyList()

    // ── Traza retenida ───────────────────────────────────────────────────────

    fun guardaTraza(sessionId: String, traza: List<TrailPoint>) {
        escribe(ficheroTraza(sessionId), Api.json.encodeToString(traza))
    }

    fun leeTraza(sessionId: String): List<TrailPoint> =
        lee(ficheroTraza(sessionId))
            ?.let { runCatching { Api.json.decodeFromString<List<TrailPoint>>(it) }.getOrNull() }
            ?: emptyList()

    // ── Ruta planificada ─────────────────────────────────────────────────────

    /** El blob del plan asociado, tal cual llegó del backend (gzip). Se guarda
     *  sin tocar para que el visor pueda servirlo igual que lo haría el
     *  servidor: recomprimirlo sería arriesgarse a alterarlo por el camino. */
    fun guardaPlan(sessionId: String, gz: ByteArray) {
        runCatching { File(dir(sessionId), "plan.gz").writeBytes(gz) }
    }

    fun leePlan(sessionId: String): ByteArray? = runCatching {
        val f = File(dir(sessionId), "plan.gz")
        if (f.exists()) f.readBytes() else null
    }.getOrNull()

    /** El factor de forma confirmado y su historial, para que sobreviva a que
     *  el sistema mate la app a mitad de travesía. */
    @Serializable
    data class FormaGuardada(val factor: Double, val log: List<ViewerData.FormaWire>)

    fun guardaForma(sessionId: String, forma: FormaGuardada) {
        escribe(File(dir(sessionId), "forma.json"), Api.json.encodeToString(forma))
    }

    fun leeForma(sessionId: String): FormaGuardada? =
        lee(File(dir(sessionId), "forma.json"))
            ?.let { runCatching { Api.json.decodeFromString<FormaGuardada>(it) }.getOrNull() }

    // ── Notas de campo ───────────────────────────────────────────────────────

    private fun ficheroNotas(sessionId: String) = File(dir(sessionId), "notas.json")
    private fun ficheroNotasPendientes(sessionId: String) =
        File(dir(sessionId), "notas-pendientes.json")
    private fun ficheroBorradosPendientes(sessionId: String) =
        File(dir(sessionId), "notas-borradas.json")

    fun guardaNotas(sessionId: String, notas: List<Note>) {
        escribe(ficheroNotas(sessionId), Api.json.encodeToString(notas))
    }

    fun leeNotas(sessionId: String): List<Note> = leeLista(ficheroNotas(sessionId))

    fun guardaNotasPendientes(sessionId: String, notas: List<Note>) {
        escribe(ficheroNotasPendientes(sessionId), Api.json.encodeToString(notas))
    }

    fun leeNotasPendientes(sessionId: String): List<Note> =
        leeLista(ficheroNotasPendientes(sessionId))

    /**
     * Las lápidas: notas borradas en local cuya baja aún no ha llegado al
     * servidor. Sin ellas, una nota creada sin cobertura y borrada acto seguido
     * reaparecería al vaciar el atasco.
     */
    fun guardaBorradosPendientes(sessionId: String, ids: List<String>) {
        escribe(ficheroBorradosPendientes(sessionId), Api.json.encodeToString(ids))
    }

    fun leeBorradosPendientes(sessionId: String): List<String> =
        lee(ficheroBorradosPendientes(sessionId))
            ?.let { runCatching { Api.json.decodeFromString<List<String>>(it) }.getOrNull() }
            ?: emptyList()

    private inline fun <reified T> leeLista(fichero: File): List<T> =
        lee(fichero)
            ?.let { runCatching { Api.json.decodeFromString<List<T>>(it) }.getOrNull() }
            ?: emptyList()

    // ── Medios de las notas (foto y audio) ───────────────────────────────────

    /** Un medio guardado en local y aún sin subir. */
    @Serializable
    data class MedioPendiente(val noteId: String, val kind: String, val file: String)

    private fun ficheroMedios(sessionId: String) = File(dir(sessionId), "medios-pendientes.json")

    /** El directorio de medios de una sesión. Los ficheros se conservan aunque
     *  ya se hayan subido: son la copia local que el visor sin cobertura
     *  necesita para poder enseñar la foto. */
    fun dirMedios(sessionId: String): File =
        File(dir(sessionId), "medios").apply { if (!exists()) mkdirs() }

    fun extension(kind: String): String = if (kind == "audio") "m4a" else "jpg"

    fun nombreMedio(noteId: String, kind: String): String =
        "${noteId}_$kind.${extension(kind)}"

    fun ficheroMedio(sessionId: String, nombre: String): File = File(dirMedios(sessionId), nombre)

    /** Guarda los bytes de un medio y devuelve su nombre, o null si no se pudo
     *  escribir (sin espacio): mejor perder la foto que perder la nota. */
    fun guardaMedio(sessionId: String, noteId: String, kind: String, datos: ByteArray): String? {
        val nombre = nombreMedio(noteId, kind)
        return runCatching {
            ficheroMedio(sessionId, nombre).writeBytes(datos)
            nombre
        }.getOrNull()
    }

    fun leeMedio(sessionId: String, nombre: String): ByteArray? =
        runCatching {
            val f = ficheroMedio(sessionId, nombre)
            if (f.exists()) f.readBytes() else null
        }.getOrNull()

    fun borraMediosDe(sessionId: String, noteId: String) {
        for (kind in listOf("audio", "photo")) {
            runCatching { ficheroMedio(sessionId, nombreMedio(noteId, kind)).delete() }
        }
    }

    /**
     * Lo que ocupan en local los medios de una sesión. Es lo mismo que acabará
     * ocupando en el servidor (se sube el mismo fichero compacto) y, a
     * diferencia de la cifra del servidor, cuenta también lo que está esperando
     * cobertura: por eso es la medida honesta del "tamaño de esta sesión".
     */
    fun bytesMedios(sessionId: String): Long =
        runCatching { dirMedios(sessionId).listFiles()?.sumOf { it.length() } ?: 0L }
            .getOrDefault(0L)

    /** Fotos y audios de la sesión, por el nombre del fichero. */
    fun cuentaMedios(sessionId: String): Pair<Int, Int> {
        val ficheros = runCatching { dirMedios(sessionId).listFiles() }.getOrNull() ?: return 0 to 0
        var fotos = 0
        var audios = 0
        for (f in ficheros) {
            if (f.name.endsWith("_photo.jpg")) fotos++ else if (f.name.endsWith("_audio.m4a")) audios++
        }
        return fotos to audios
    }

    fun guardaMediosPendientes(sessionId: String, medios: List<MedioPendiente>) {
        escribe(ficheroMedios(sessionId), Api.json.encodeToString(medios))
    }

    fun leeMediosPendientes(sessionId: String): List<MedioPendiente> =
        leeLista(ficheroMedios(sessionId))

    // ── Estado activo ────────────────────────────────────────────────────────

    fun guardaActivo(estado: EstadoActivo) {
        prefs.edit().putString(CLAVE_ACTIVO, Api.json.encodeToString(estado)).apply()
    }

    fun leeActivo(): EstadoActivo? =
        prefs.getString(CLAVE_ACTIVO, null)
            ?.let { runCatching { Api.json.decodeFromString<EstadoActivo>(it) }.getOrNull() }

    fun borraActivo() {
        prefs.edit().remove(CLAVE_ACTIVO).apply()
    }

    /** Al terminar una sesión se borra su rastro local; la traza se conserva
     *  aparte solo si algún día la revisamos sin conexión (fase de notas). */
    fun limpiaSesion(sessionId: String) {
        runCatching { File(raiz, sessionId).deleteRecursively() }
    }

    // ── Fontanería ───────────────────────────────────────────────────────────

    /** Escritura atómica: se escribe a un temporal y se renombra. Si el sistema
     *  mata el proceso a mitad, lo que queda en disco es la versión anterior
     *  entera y no un JSON cortado que no se podría leer. */
    private fun escribe(destino: File, contenido: String) {
        runCatching {
            val tmp = File(destino.parentFile, destino.name + ".tmp")
            tmp.writeText(contenido)
            if (destino.exists()) destino.delete()
            tmp.renameTo(destino)
        }
    }

    private fun lee(fichero: File): String? =
        runCatching { if (fichero.exists()) fichero.readText() else null }.getOrNull()

    companion object {
        private const val CLAVE_ACTIVO = "estado_activo"
    }
}
