package com.themakercrowd.silosenosalgo

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * El WIDGET de la cuenta atrás: la próxima (o la elegida), con su foto o su
 * color de fondo, los días en grande y el reloj corriendo. El reloj lo cuenta
 * el propio sistema (un `Chronometer` hacia atrás hasta el momento en que baja
 * el número de días), así que el widget solo se repinta cuando cambia el
 * número: al llegar ese momento hay una alarma que lo repinta. Espejo del
 * widget de iOS.
 */
class WidgetCuentaAtras : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { pinta(context, manager, it) }
        programaSiguiente(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, opciones: Bundle) {
        pinta(context, manager, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val p = prefs(context).edit()
        ids.forEach { p.remove("elegido-$it") }
        p.apply()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACCION_REFRESCO) { refresca(context); return }
        super.onReceive(context, intent)
    }

    companion object {
        private const val ACCION_REFRESCO = "com.themakercrowd.silosenosalgo.WIDGET_REFRESCO"
        /** «La próxima»: el widget va pasando de una a otra solo. */
        const val LA_PROXIMA = "la-proxima"

        private fun prefs(ctx: Context) = ctx.getSharedPreferences("widget-cuenta-atras", Context.MODE_PRIVATE)

        fun elige(ctx: Context, widgetId: Int, contadorId: String) {
            prefs(ctx).edit().putString("elegido-$widgetId", contadorId).apply()
        }

        /** Repintar todos (al cambiar las cuentas atrás, o al bajar un día). */
        fun refresca(ctx: Context) {
            val m = AppWidgetManager.getInstance(ctx)
            val ids = m.getAppWidgetIds(ComponentName(ctx, WidgetCuentaAtras::class.java))
            ids.forEach { pinta(ctx, m, it) }
            programaSiguiente(ctx)
        }

        private fun elegido(ctx: Context, widgetId: Int, ahora: Double): Contador? {
            val lista = Contadores.lee(ctx)
            val id = prefs(ctx).getString("elegido-$widgetId", LA_PROXIMA)
            return lista.firstOrNull { it.id == id && it.vigente(ahora) } ?: Contadores.ordenados(lista, ahora).firstOrNull()
        }

        fun pinta(ctx: Context, m: AppWidgetManager, widgetId: Int) {
            val ahora = System.currentTimeMillis().toDouble()
            val c = elegido(ctx, widgetId, ahora)
            val v = RemoteViews(ctx.packageName, R.layout.widget_cuenta_atras)
            val o = m.getAppWidgetOptions(widgetId)
            val densidad = ctx.resources.displayMetrics.density
            val wDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 170).coerceAtLeast(80)
            val hDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 170).coerceAtLeast(80)
            val grande = hDp >= 150 && wDp >= 150

            // Tocarlo abre las cuentas atrás en la app.
            val abrir = PendingIntent.getActivity(
                ctx, 40,
                Intent(ctx, MainActivity::class.java).putExtra(EXTRA_ABRIR_CONTADORES, true)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            v.setOnClickPendingIntent(android.R.id.background, abrir)

            if (c == null) {
                v.setTextViewText(R.id.nombre, "Sin cuentas atrás")
                v.setTextViewText(R.id.dias, "⏳")
                v.setTextViewText(R.id.unidad, "Toca para añadir una")
                v.setViewVisibility(R.id.reloj, View.GONE)
                v.setImageViewBitmap(R.id.fondo, fondo(ctx, null, "#1e293b", null, (wDp * densidad).roundToInt(), (hDp * densidad).roundToInt()))
                m.updateAppWidget(widgetId, v)
                return
            }

            v.setTextViewText(R.id.nombre, listOfNotNull(c.emoji, c.nombre).joinToString(" "))
            val fecha = c.fechaVigente(ahora)
            if (fecha > ahora) {
                val (dias, corte) = c.diasYCorte(ahora)
                if (c.conHora) {
                    v.setTextViewText(R.id.dias, "$dias")
                    v.setTextViewText(R.id.unidad, if (dias == 1) "día" else "días")
                    v.setViewVisibility(R.id.reloj, if (grande || dias == 0) View.VISIBLE else View.GONE)
                    v.setChronometer(R.id.reloj, SystemClock.elapsedRealtime() + (corte - ahora).toLong(), null, true)
                    v.setChronometerCountDown(R.id.reloj, true)
                } else {
                    // Sin hora, días enteros: «mañana» es 1, no «0 días y 14 h».
                    val hoy = java.util.Calendar.getInstance().apply { set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0) }
                    val d = ((fecha - hoy.timeInMillis) / 86_400_000).toInt().coerceAtLeast(0)
                    v.setTextViewText(R.id.dias, "$d")
                    v.setTextViewText(R.id.unidad, if (d == 1) "día" else "días")
                    v.setViewVisibility(R.id.reloj, View.GONE)
                }
            } else {
                // Ya pasó y cuenta hacia arriba: lo que lleva (el día de la carrera,
                // el tiempo que llevas corriendo).
                val lleva = ahora - fecha
                val dias = (lleva / 86_400_000).toInt()
                v.setTextViewText(R.id.dias, if (dias == 0) "¡Ya!" else "+$dias")
                v.setTextViewText(R.id.unidad, if (dias == 0) "" else if (dias == 1) "día" else "días")
                v.setViewVisibility(R.id.reloj, if (c.conHora) View.VISIBLE else View.GONE)
                v.setChronometer(R.id.reloj, SystemClock.elapsedRealtime() - (lleva - dias * 86_400_000.0).toLong(), null, true)
                v.setChronometerCountDown(R.id.reloj, false)
            }
            v.setImageViewBitmap(R.id.fondo, fondo(ctx, c.foto, c.color, c.color2, (wDp * densidad).roundToInt(), (hDp * densidad).roundToInt()))
            m.updateAppWidget(widgetId, v)
        }

        /**
         * El fondo al tamaño del widget: la foto recortada al centro, o el color
         * (en degradado si tiene dos), con una sombra abajo para que el texto se
         * lea sobre cualquier foto. Tope de 700 px: el widget tiene la memoria
         * contada.
         */
        private fun fondo(ctx: Context, foto: String?, color: String, color2: String?, w0: Int, h0: Int): Bitmap {
            val escala = minOf(1f, 700f / max(w0, h0))
            val w = (w0 * escala).roundToInt().coerceAtLeast(60)
            val h = (h0 * escala).roundToInt().coerceAtLeast(60)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            val img = foto?.let { f ->
                val fichero = if (f.startsWith("/")) java.io.File(f) else java.io.File(Contadores.dirFotos(ctx), f)
                runCatching { BitmapFactory.decodeFile(fichero.path, BitmapFactory.Options().apply { inSampleSize = 2 }) }.getOrNull()
            }
            if (img != null) {
                // Recorte al centro con la proporción del widget.
                val r = w.toFloat() / h
                val (sw, sh) = if (img.width.toFloat() / img.height > r) ((img.height * r).toInt() to img.height) else (img.width to (img.width / r).toInt())
                val sx = (img.width - sw) / 2; val sy = (img.height - sh) / 2
                c.drawBitmap(img, Rect(sx, sy, sx + sw, sy + sh), RectF(0f, 0f, w.toFloat(), h.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))
                c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), Paint().apply {
                    shader = LinearGradient(0f, h * 0.35f, 0f, h.toFloat(), 0x00000000, 0xB3000000.toInt(), Shader.TileMode.CLAMP)
                })
            } else {
                val a = parse(color); val b = color2?.let { parse(it) } ?: oscurece(a)
                c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), Paint().apply {
                    shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), a, b, Shader.TileMode.CLAMP)
                })
            }
            return bmp
        }

        private fun parse(hex: String) = runCatching { android.graphics.Color.parseColor(hex) }.getOrDefault(0xFF8B5CF6.toInt())
        private fun oscurece(c: Int): Int {
            val f = 0.55f
            return android.graphics.Color.rgb(
                (android.graphics.Color.red(c) * f).toInt(), (android.graphics.Color.green(c) * f).toInt(), (android.graphics.Color.blue(c) * f).toInt(),
            )
        }

        /** La próxima vez que cambia algún número (el corte más cercano): se repinta. */
        private fun programaSiguiente(ctx: Context) {
            val ahora = System.currentTimeMillis().toDouble()
            val proximo = Contadores.lee(ctx).filter { it.vigente(ahora) }.mapNotNull { c ->
                val f = c.fechaVigente(ahora)
                when {
                    f > ahora -> c.diasYCorte(ahora).second
                    else -> f + (((ahora - f) / 86_400_000).toInt() + 1) * 86_400_000.0
                }
            }.minOrNull() ?: return
            val pi = PendingIntent.getBroadcast(
                ctx, 41, Intent(ctx, WidgetCuentaAtras::class.java).setAction(ACCION_REFRESCO),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val am = ctx.getSystemService(AlarmManager::class.java)
            val cuando = proximo.toLong() + 1_000
            if (PreparacionDeCarrera.alarmasExactas(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC, cuando, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC, cuando, pi)
        }

        const val EXTRA_ABRIR_CONTADORES = "abrir_contadores"
    }
}
