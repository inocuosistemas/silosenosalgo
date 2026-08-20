package com.themakercrowd.silosenosalgo

import kotlinx.serialization.Serializable

/**
 * Las REGLAS de los paquetes `.slsnsguide`, sin nada de Android ni de ficheros.
 *
 * Un `.slsnsguide` es un ZIP con todo lo necesario para ver una ruta terminada
 * sin conexión: la traza, las notas, sus fotos y audios, y el plan. El formato
 * está especificado en `../docs/slsnsguide-v1.md` y lo comparten los dos
 * clientes: un paquete exportado desde iOS tiene que abrirse en Android y al
 * revés.
 *
 * Aquí está lo que hay que comprobar **antes** de tocar el disco, y el motivo de
 * que viva aparte: un paquete llega de fuera —te lo manda alguien por
 * mensajería— y un ZIP hostil puede intentar escribir donde no debe. Eso no se
 * prueba a mano; se prueba aquí.
 */
object GuideRules {

    const val FORMATO = "slsnsguide"
    const val VERSION = 1

    /** Tope de entradas del ZIP. Una guía real tiene traza, notas, plan y unas
     *  pocas fotos; miles de entradas es un ZIP preparado para reventar algo. */
    const val MAX_ENTRADAS = 5_000

    /** Tope de lo descomprimido. Protege de un ZIP que comprime muy bien a
     *  propósito para llenar el disco del móvil. */
    const val MAX_DESCOMPRIMIDO_BYTES = 512L * 1024 * 1024

    @Serializable
    data class Medio(
        val noteId: String,
        val kind: String,
        val path: String,
        val mimeType: String? = null,
    )

    @Serializable
    data class Manifiesto(
        val format: String,
        val version: Int,
        val id: String,
        val title: String? = null,
        val startedAt: Double = 0.0,
        val endedAt: Double? = null,
        val exportedAt: Double = 0.0,
        val trailPath: String = "trail.json",
        val notesPath: String = "notes.json",
        val planPath: String? = null,
        val media: List<Medio> = emptyList(),
    )

    /** Una guía ya importada y guardada en el móvil. */
    @Serializable
    data class GuiaLocal(
        val id: String,
        val sesionOrigen: String,
        val titulo: String,
        val startedAt: Double,
        val endedAt: Double? = null,
        val importadaMs: Double,
        val notas: Int,
        val medios: Int,
    )

    /** Por qué se rechaza un paquete. Cada motivo es algo que puede llegar de
     *  verdad, no una posibilidad teórica. */
    sealed class Rechazo(val motivo: String) {
        data object NoEsGuia : Rechazo("El archivo no es una guía SiLoSeNoSalgo válida.")
        data object VersionFutura :
            Rechazo("La versión de esta guía todavía no es compatible con la app.")
        data class RutaPeligrosa(val path: String) :
            Rechazo("El paquete intenta escribir fuera de su sitio: $path")
        data object Enorme : Rechazo("El paquete es demasiado grande.")
        data object Incompleto : Rechazo("Al paquete le faltan la traza o las notas.")
    }

    /**
     * Una ruta del ZIP es segura si es relativa y no se sale del directorio.
     *
     * Es la defensa contra el "zip slip": una entrada llamada
     * `../../../databases/algo` haría que al extraer se escribiera encima de
     * otra cosa del móvil. También se rechaza el separador de Windows, porque
     * `..\` esquivaría una comprobación que solo mirase `/`.
     */
    fun esRutaSegura(path: String): Boolean {
        if (path.isBlank()) return false
        if (path.startsWith("/") || path.startsWith("\\")) return false
        if (path.contains("\\")) return false
        if (path.length > 2 && path[1] == ':') return false // C:algo
        return path.split('/').none { it == ".." || it == "." }
    }

    /** Un componente que va a formar parte de un nombre de fichero (un id de
     *  nota) tiene que ser inofensivo por sí solo. */
    fun esComponenteSeguro(valor: String): Boolean =
        valor.isNotEmpty() && valor.length <= 64 && valor.all {
            it.isLetterOrDigit() || it == '_' || it == '-'
        }

    /** Comprobaciones baratas del manifiesto, antes de extraer nada. */
    fun valida(m: Manifiesto): Rechazo? {
        if (m.format != FORMATO) return Rechazo.NoEsGuia
        // Solo se rechaza lo que viene del FUTURO: una guía de una versión
        // anterior debería poder seguir abriéndose cuando exista la 2.
        if (m.version > VERSION) return Rechazo.VersionFutura
        if (m.id.isBlank()) return Rechazo.NoEsGuia
        if (!esRutaSegura(m.trailPath) || !esRutaSegura(m.notesPath)) {
            return Rechazo.RutaPeligrosa(m.trailPath)
        }
        m.planPath?.let { if (!esRutaSegura(it)) return Rechazo.RutaPeligrosa(it) }
        for (medio in m.media) {
            if (!esRutaSegura(medio.path)) return Rechazo.RutaPeligrosa(medio.path)
            if (!esComponenteSeguro(medio.noteId)) return Rechazo.RutaPeligrosa(medio.noteId)
            if (medio.kind != "photo" && medio.kind != "audio") {
                return Rechazo.RutaPeligrosa(medio.kind)
            }
        }
        return null
    }

    /** Nombre de fichero legible para el paquete exportado. */
    fun nombreDeFichero(titulo: String?): String {
        val limpio = (titulo ?: "")
            .replace(Regex("[^A-Za-z0-9_-]+"), "_")
            .trim('_')
        return (if (limpio.isEmpty()) "guia" else limpio).take(80) + ".slsnsguide"
    }

    /** El id con el que la guía se guarda en el móvil. Va prefijado para no
     *  poder chocar nunca con el id de una sesión propia. */
    fun idLocal(idDelManifiesto: String): String =
        "guide_" + idDelManifiesto.replace(Regex("[^A-Za-z0-9_-]"), "_").take(64)

    /** El nombre que tendrá el medio ya guardado: `<nota>_<clase>.<ext>`. */
    fun nombreMedio(noteId: String, kind: String): String =
        "${noteId}_$kind." + if (kind == "audio") "m4a" else "jpg"
}
