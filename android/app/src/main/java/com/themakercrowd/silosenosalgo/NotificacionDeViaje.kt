package com.themakercrowd.silosenosalgo

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

/**
 * La notificación del VIAJE: la tarjeta de la pantalla de bloqueo de iOS, en
 * Android. Plegada, de dónde a dónde, lo que queda y la barra; desplegada, el
 * dibujo: los códigos a los lados y el vehículo avanzando por la barra —o por
 * el semicírculo, en avión—, con los colores elegidos.
 */
object NotificacionDeViaje {

    fun construye(
        ctx: Context, canal: String, e: ViajeEnDirecto.Estado,
        abrir: PendingIntent, terminar: PendingIntent,
    ): Notification {
        val v = e.viaje!!
        val ruta = "${v.origen.abreviatura} → ${v.destino.abreviatura}"
        val titulo = if (e.llegado) "✅ Has llegado a ${v.destino.nombre}" else (v.titulo?.takeIf { it.isNotBlank() } ?: ruta)
        val texto = if (e.llegado) ruta else buildString {
            append("${km(e.restanteKm)} km en línea recta")
            e.llegadaMs?.let { append(" · llegada ${hora(it)}") }
        }
        return NotificationCompat.Builder(ctx, canal)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setSubText("${v.transporte.emoji} $ruta")
            .setContentTitle(titulo)
            .setContentText(texto)
            .setProgress(100, (e.progreso * 100).roundToInt(), false)
            .setStyle(NotificationCompat.BigPictureStyle().bigPicture(dibujo(e)).setSummaryText(texto))
            .setColor(color(v.colores.trayecto))
            .setContentIntent(abrir)
            .addAction(0, "Terminar", terminar)
            .setOngoing(!e.llegado)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun km(v: Double): String =
        if (v >= 100) String.format(Locale("es", "ES"), "%,.0f", v).replace(',', '.') else String.format(Locale("es", "ES"), "%.1f", v)

    private fun hora(ms: Double): String = SimpleDateFormat("HH:mm", Locale("es", "ES")).format(Date(ms.toLong()))

    private fun color(hex: String): Int = runCatching { android.graphics.Color.parseColor(hex) }.getOrDefault(0xFF0284C7.toInt())

    /** Negro o blanco sobre el fondo, según lo claro que sea (como en iOS). */
    private fun textoSobre(fondo: Int): Int {
        val r = android.graphics.Color.red(fondo); val g = android.graphics.Color.green(fondo); val b = android.graphics.Color.blue(fondo)
        return if (0.299 * r + 0.587 * g + 0.114 * b > 150) 0xFF0F172A.toInt() else 0xFFF1F5F9.toInt()
    }

    fun dibujo(e: ViajeEnDirecto.Estado): Bitmap {
        val v = e.viaje!!
        val w = 1000; val h = 420
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val fondo = color(v.colores.fondo)
        val tray = color(v.colores.trayecto)
        val tray2 = color(v.colores.trayecto2 ?: v.colores.trayecto)
        val texto = textoSobre(fondo)
        val apagado = (texto and 0x00FFFFFF) or 0x99000000.toInt()
        c.drawColor(fondo)
        val grande = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = texto; textSize = 64f; isFakeBoldText = true }
        val peq = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = apagado; textSize = 30f }
        val p = e.progreso.toFloat()

        if (v.transporte == TransporteDeViaje.AVION) {
            // El semicírculo: despegue, crucero y aterrizaje.
            c.drawText(v.origen.abreviatura, 30f, 250f, grande)
            val finW = grande.measureText(v.destino.abreviatura)
            c.drawText(v.destino.abreviatura, w - 30f - finW, 250f, grande)
            c.drawText(v.origen.nombre.take(20), 30f, 292f, peq)
            val fn = v.destino.nombre.take(20)
            c.drawText(fn, w - 30f - peq.measureText(fn), 292f, peq)
            val arco = RectF(230f, 50f, w - 230f, 500f)
            val fondoArco = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 5f; color = apagado
                pathEffect = android.graphics.DashPathEffect(floatArrayOf(4f, 18f), 0f)
                strokeCap = Paint.Cap.ROUND
            }
            c.drawArc(arco, 180f, 180f, false, fondoArco)
            val hecho = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 10f; strokeCap = Paint.Cap.ROUND
                shader = LinearGradient(230f, 0f, w - 230f, 0f, tray, tray2, Shader.TileMode.CLAMP)
            }
            c.drawArc(arco, 180f, 180f * p, false, hecho)
            val ang = Math.toRadians(180.0 + 180.0 * p)
            val cx = arco.centerX() + arco.width() / 2 * Math.cos(ang).toFloat()
            val cy = arco.centerY() + arco.height() / 2 * Math.sin(ang).toFloat()
            // El avión del emoji ya mira hacia arriba a la derecha: sin darle la vuelta.
            chapa(c, cx, cy, v.transporte.emoji, mezcla(tray, tray2, p), mira = false)
            pie(c, e, texto, peq, w)
        } else {
            // La barra: de un código al otro, con el vehículo en su sitio.
            c.drawText(v.origen.abreviatura, 30f, 100f, grande)
            val finW = grande.measureText(v.destino.abreviatura)
            c.drawText(v.destino.abreviatura, w - 30f - finW, 100f, grande)
            c.drawText(v.origen.nombre.take(24), 30f, 145f, peq)
            val fn = v.destino.nombre.take(24)
            c.drawText(fn, w - 30f - peq.measureText(fn), 145f, peq)
            val y = 250f; val x0 = 60f; val x1 = w - 60f
            val punteado = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 6f; color = apagado; strokeCap = Paint.Cap.ROUND
                pathEffect = android.graphics.DashPathEffect(floatArrayOf(2f, 16f), 0f)
            }
            c.drawLine(x0, y, x1, y, punteado)
            val x = x0 + (x1 - x0) * p
            val hecho = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = 12f; strokeCap = Paint.Cap.ROUND
                shader = LinearGradient(x0, 0f, x1, 0f, tray, tray2, Shader.TileMode.CLAMP)
            }
            c.drawLine(x0, y, x, y, hecho)
            c.drawCircle(x0, y, 12f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = tray })
            c.drawCircle(x1, y, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4f; color = apagado })
            chapa(c, x, y, v.transporte.emoji, mezcla(tray, tray2, p), mira = v.transporte != TransporteDeViaje.TREN)
            pie(c, e, texto, peq, w)
        }
        return bmp
    }

    /** Lo que queda y la llegada, abajo; o «Has llegado». */
    private fun pie(c: Canvas, e: ViajeEnDirecto.Estado, texto: Int, peq: Paint, w: Int) {
        val grandeKm = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = texto; textSize = 60f; isFakeBoldText = true }
        if (e.llegado) {
            c.drawText("✅ Has llegado", 30f, 395f, grandeKm)
            return
        }
        val k = km(e.restanteKm)
        c.drawText(k, 30f, 395f, grandeKm)
        c.drawText("km en línea recta", 40f + grandeKm.measureText(k), 395f, peq)
        e.llegadaMs?.let {
            val l = "llegada ${hora(it)}"
            c.drawText(l, w - 30f - peq.measureText(l), 395f, peq)
        }
    }

    private fun chapa(c: Canvas, x: Float, y: Float, emoji: String, color: Int, mira: Boolean = true) {
        c.drawCircle(x, y, 38f, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; setShadowLayer(14f, 0f, 0f, color) })
        val t = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 40f; textAlign = Paint.Align.CENTER }
        // Los vehículos de los emojis miran a la izquierda: se les da la vuelta
        // para que vayan hacia el destino.
        c.save()
        if (mira) c.scale(-1f, 1f, x, y)
        c.drawText(emoji, x, y + 14f, t)
        c.restore()
    }

    private fun mezcla(a: Int, b: Int, t: Float): Int {
        fun ch(s: Int) = s and 0xFF
        val r = (ch(a shr 16) + (ch(b shr 16) - ch(a shr 16)) * t).toInt()
        val g = (ch(a shr 8) + (ch(b shr 8) - ch(a shr 8)) * t).toInt()
        val bl = (ch(a) + (ch(b) - ch(a)) * t).toInt()
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
    }
}
