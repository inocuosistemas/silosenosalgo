package com.themakercrowd.silosenosalgo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri

/**
 * Leer una imagen YA reducida, sin pasar por el tamaño completo.
 *
 * Una foto de 48 MP son ~190 MB de memoria si se decodifica entera, y aquí casi
 * siempre se quiere a 1400-1600 px: primero se miden sus lados sin cargarla
 * (`inJustDecodeBounds`) y luego se decodifica ya muestreada (`inSampleSize`).
 * El muestreo va en potencias de 2 y nunca deja el lado mayor por debajo de
 * `ladoMax`: el ajuste fino, si hace falta, lo hace quien la reescala.
 */
object Imagen {
    /** El `inSampleSize` para `ancho`×`alto`: el mayor que deja el lado mayor en `ladoMax` o más. */
    fun muestreo(ancho: Int, alto: Int, ladoMax: Int): Int {
        val mayor = maxOf(ancho, alto)
        var n = 1
        while (mayor / (n * 2) >= ladoMax) n *= 2
        return n
    }

    fun deBytes(bytes: ByteArray, ladoMax: Int): Bitmap? {
        val lados = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, lados)
        if (lados.outWidth <= 0 || lados.outHeight <= 0) return null
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opciones(lados, ladoMax))
    }

    fun deFichero(ruta: String, ladoMax: Int): Bitmap? {
        val lados = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(ruta, lados)
        if (lados.outWidth <= 0 || lados.outHeight <= 0) return null
        return BitmapFactory.decodeFile(ruta, opciones(lados, ladoMax))
    }

    /** De una foto elegida o capturada: se abre dos veces, una para medirla y otra para leerla. */
    fun deUri(context: Context, uri: Uri, ladoMax: Int): Bitmap? {
        val lados = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, lados) }
        if (lados.outWidth <= 0 || lados.outHeight <= 0) return null
        return context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opciones(lados, ladoMax)) }
    }

    private fun opciones(lados: BitmapFactory.Options, ladoMax: Int) =
        BitmapFactory.Options().apply { inSampleSize = muestreo(lados.outWidth, lados.outHeight, ladoMax) }
}
