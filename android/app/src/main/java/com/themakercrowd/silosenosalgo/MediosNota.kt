package com.themakercrowd.silosenosalgo

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Foto y audio para las notas de campo.
 *
 * Todo lo que se captura se **encoge antes de guardarlo**, y no por avaricia: lo
 * que se sube se sube desde el monte, con una barra de cobertura y con la
 * batería contada. Una foto de 12 MP son 4 MB que pueden no llegar nunca; la
 * misma foto a 1600 px son ~300 KB que sí llegan.
 */
object MediosNota {

    /** Lado mayor al que se reduce una foto antes de subirla. */
    const val LADO_MAX = 1600

    /** Calidad JPEG. 80 es el punto donde se deja de notar la diferencia en
     *  pantalla de móvil y el fichero ya ha bajado mucho. */
    const val CALIDAD = 80

    /**
     * Lee la foto capturada, la endereza según el EXIF y la reduce.
     *
     * Lo del EXIF no es un adorno: las cámaras de Android guardan la foto en el
     * sensor y anotan la rotación aparte, así que sin aplicarla las fotos
     * tomadas en vertical se suben tumbadas.
     */
    fun preparaFoto(context: Context, uri: Uri): ByteArray? = runCatching {
        val original = context.contentResolver.openInputStream(uri).use { entrada ->
            BitmapFactory.decodeStream(entrada)
        } ?: return null

        val giro = context.contentResolver.openInputStream(uri).use { entrada ->
            entrada?.let { ExifInterface(it).rotationDegrees } ?: 0
        }

        val reducida = reduce(original, LADO_MAX)
        val enderezada = if (giro != 0) rota(reducida, giro.toFloat()) else reducida

        ByteArrayOutputStream().use { salida ->
            enderezada.compress(Bitmap.CompressFormat.JPEG, CALIDAD, salida)
            salida.toByteArray()
        }
    }.getOrNull()

    /**
     * Guarda el ORIGINAL a máxima calidad en la galería del móvil.
     *
     * La app se queda con una copia encogida (es la que se sube), pero la foto
     * buena es del usuario y no tiene por qué perderla: puede ser la única que
     * hizo de esa cima. Va a su propio álbum para no ensuciar el carrete.
     *
     * Al mejor esfuerzo: si falla, la nota conserva su copia igualmente. Desde
     * Android 10 no hace falta permiso para escribir lo propio en MediaStore.
     */
    fun guardaEnGaleria(context: Context, origen: Uri, nombre: String): Boolean = runCatching {
        val valores = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, nombre)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + File.separator + "SiLoSeNoSalgo",
            )
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val destino = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, valores)
            ?: return false

        resolver.openInputStream(origen).use { entrada ->
            resolver.openOutputStream(destino).use { salida ->
                if (entrada == null || salida == null) return false
                entrada.copyTo(salida)
            }
        }
        // Hasta que se quita IS_PENDING, la galería no la enseña: así nadie ve
        // una foto a medio escribir.
        valores.clear()
        valores.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(destino, valores, null, null)
        true
    }.getOrDefault(false)

    private fun reduce(origen: Bitmap, ladoMax: Int): Bitmap {
        val mayor = maxOf(origen.width, origen.height)
        if (mayor <= ladoMax) return origen
        val factor = ladoMax.toFloat() / mayor
        return Bitmap.createScaledBitmap(
            origen,
            (origen.width * factor).toInt(),
            (origen.height * factor).toInt(),
            true,
        )
    }

    private fun rota(origen: Bitmap, grados: Float): Bitmap {
        val matriz = android.graphics.Matrix().apply { postRotate(grados) }
        return Bitmap.createBitmap(origen, 0, 0, origen.width, origen.height, matriz, true)
    }
}

/**
 * Grabadora de voz para las notas.
 *
 * Graba en AAC dentro de un `.m4a`, que es lo que espera el backend
 * (`audio/mp4`) y lo mismo que graba iOS: los dos clientes tienen que producir
 * ficheros que el visor sepa reproducir.
 *
 * A 32 kbps mono, un minuto de voz son ~240 KB. Es voz al aire libre, no música:
 * subir el bitrate solo haría más difícil que la nota llegue.
 */
class GrabadoraAudio(private val context: Context) {

    private var grabadora: MediaRecorder? = null
    private var destino: File? = null

    val grabando: Boolean get() = grabadora != null

    fun empieza(): Boolean = runCatching {
        val fichero = File.createTempFile("nota_", ".m4a", context.cacheDir)
        val nueva = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        nueva.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioChannels(1)
            setAudioEncodingBitRate(32_000)
            setAudioSamplingRate(22_050)
            setOutputFile(fichero.absolutePath)
            prepare()
            start()
        }
        grabadora = nueva
        destino = fichero
        true
    }.getOrElse {
        suelta()
        false
    }

    /** Para y devuelve los bytes grabados, o null si no había nada o falló. */
    fun para(): ByteArray? {
        val fichero = destino
        runCatching { grabadora?.stop() }
        suelta()
        val bytes = runCatching { fichero?.takeIf { it.exists() }?.readBytes() }.getOrNull()
        runCatching { fichero?.delete() }
        return bytes?.takeIf { it.isNotEmpty() }
    }

    /** Cancela sin devolver nada (el usuario se arrepiente a medio grabar). */
    fun cancela() {
        runCatching { grabadora?.stop() }
        suelta()
        runCatching { destino?.delete() }
        destino = null
    }

    private fun suelta() {
        runCatching { grabadora?.release() }
        grabadora = null
    }
}
