package com.themakercrowd.silosenosalgo

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * La notificación del TRAMO: la tarjeta de la pantalla de bloqueo de iOS, en
 * Android. Plegada, el tramo, lo que queda y la barra; desplegada, además el
 * perfil del tramo dibujado —lo hecho en azul y dónde se va— y el corte.
 * Es la misma notificación fija de la baliza: una sola, no dos.
 */
object NotificacionDeTramo {

    /** El dibujo se rehace solo cuando cambia algo que se ve. */
    private var ultimaClave: String? = null
    private var ultimoDibujo: Bitmap? = null

    fun construye(
        ctx: Context, canal: String, t: DatosTramo, estado: TrackingStore.Estado,
        acciones: Pair<PendingIntent, PendingIntent>,
    ): Notification {
        val (abrir, parar) = acciones
        val hacia = "${ReglasDeCarrera.icono(t.hastaTipo)} ${t.hastaNombre}"
        val titulo = if (t.enMeta) "🏁 En meta" else "Tramo ${t.numero}/${t.deTramos} · hacia $hacia"
        val linea = buildString {
            append("${km(t.restanteKm)} km")
            if (t.subidaRestanteM > 0) append(" · ↗ ${t.subidaRestanteM} m")
            t.previsionMs?.let { append(" · llegada ${hora(it)}") }
        }
        val corte = t.corteMs?.let { c ->
            val m = t.margenMin
            "Corte ${hora(c)}" + (m?.let { " · ${margen(it)}" } ?: "")
        }
        val carrera = TrackingStore.eventoActual()?.let { (it.myEmoji?.let { e -> "$e " } ?: "") + it.name }
        val resumen = listOfNotNull(linea, corte).joinToString(" · ")

        return NotificationCompat.Builder(ctx, canal)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setSubText(carrera)
            .setContentTitle(titulo)
            .setContentText(resumen)
            // Plegada, la barra del tramo; desplegada, el perfil.
            .setProgress(100, (t.progreso * 100).roundToInt(), false)
            .setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(dibujo(t))
                    .setSummaryText(resumen),
            )
            .setColor(colorDelMargen(t.margenMin))
            .setContentIntent(abrir)
            .addAction(0, "Dejar de compartir", parar)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    /** Verde con margen, ámbar justo, rojo fuera: como en iOS (30 y 10 min). */
    private fun colorDelMargen(m: Double?): Int = when {
        m == null -> 0xFF0EA5E9.toInt()
        m >= 30 -> 0xFF22C55E.toInt()
        m >= 10 -> 0xFFF59E0B.toInt()
        else -> 0xFFF87171.toInt()
    }

    private fun margen(min: Double): String {
        val m = min.roundToInt()
        val a = abs(m)
        val txt = if (a >= 60) "${a / 60} h ${a % 60} min" else "$a min"
        return if (m >= 0) "+$txt" else "fuera por $txt"
    }

    private fun km(v: Double): String = String.format(Locale("es", "ES"), "%.1f", v)
    private fun hora(ms: Double): String = SimpleDateFormat("HH:mm", Locale("es", "ES")).format(Date(ms.toLong()))

    /** El perfil del tramo, lo hecho en azul y dónde se va. */
    private fun dibujo(t: DatosTramo): Bitmap {
        val clave = "${t.numero}|${(t.progreso * 200).roundToInt()}"
        if (clave == ultimaClave) ultimoDibujo?.let { return it }
        val w = 1000; val h = 420
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(0xFF0F1729.toInt())
        val alturas = t.perfil.ifEmpty { listOf(0.0, 0.0) }
        val min = alturas.min(); val max = alturas.max()
        val rango = (max - min).coerceAtLeast(40.0)   // un llano no se dibuja como una montaña
        val margen = 36f; val arriba = 34f; val abajo = h - 76f
        val pts = alturas.mapIndexed { i, e ->
            val x = margen + i / (alturas.size - 1f) * (w - 2 * margen)
            val y = abajo - ((e - min) / rango).toFloat() * (abajo - arriba)
            x to y
        }
        val relleno = Path().apply {
            moveTo(pts.first().first, abajo)
            pts.forEach { lineTo(it.first, it.second) }
            lineTo(pts.last().first, abajo); close()
        }
        c.drawPath(relleno, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1E293B.toInt() })
        val x = margen + t.progreso.toFloat() * (w - 2 * margen)
        c.save(); c.clipRect(0f, 0f, x, h.toFloat())
        c.drawPath(relleno, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, arriba, 0f, abajo, 0x800EA5E9.toInt(), 0x200EA5E9, Shader.TileMode.CLAMP)
        })
        c.restore()
        val linea = Path().apply { pts.forEachIndexed { i, p -> if (i == 0) moveTo(p.first, p.second) else lineTo(p.first, p.second) } }
        c.drawPath(linea, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF94A3B8.toInt(); style = Paint.Style.STROKE; strokeWidth = 4f })
        // Dónde se va, sobre la línea.
        val i = (t.progreso * (pts.size - 1)).toInt().coerceIn(0, pts.size - 1)
        val y = pts[i].second
        c.drawCircle(x, y, 16f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF38BDF8.toInt() })
        c.drawCircle(x, y, 7f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF94A3B8.toInt(); textSize = 32f }
        c.drawText(t.desdeNombre.take(22), margen, h - 26f, txt)
        val fin = "${ReglasDeCarrera.icono(t.hastaTipo)} ${t.hastaNombre.take(22)}"
        c.drawText(fin, w - margen - txt.measureText(fin), h - 26f, txt)
        ultimaClave = clave
        ultimoDibujo = bmp
        return bmp
    }
}
