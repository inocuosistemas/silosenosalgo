package com.themakercrowd.silosenosalgo

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * PREPARAR una carrera la noche antes y dejarla ARMADA el mismo día. Espejo de
 * `PreparacionDeCarrera` en iOS.
 *
 * Armar la baliza por la noche para que salga sola por la mañana depende de que
 * el sistema deje viva la app toda la noche, y no siempre lo hace. Así que la
 * noche antes no se arma nada: se comprueba que está todo (ver
 * `PantallaPrepararCarrera`) y se programa un AVISO para la mañana. Al tocarlo
 * se abre la app y la baliza queda armada con la carrera elegida, con el móvil
 * en la mano. Si no se toca, un recordatorio poco antes.
 *
 * Una carrera preparada a la vez: es la de mañana.
 */
@Serializable
data class PreparacionDeCarrera(
    val eventoId: String,
    val nombre: String,
    val salidaMs: Double,
    /** Cuánto antes de la salida llega el aviso para armarla. */
    val avisoMin: Int,
) {
    val avisoMs: Double get() = salidaMs - avisoMin * 60_000.0
    val recordatorioMs: Double get() = salidaMs - RECORDATORIO_MIN * 60_000.0

    companion object {
        const val RECORDATORIO_MIN = 10
        val OPCIONES = listOf(30, 60, 90, 120)
        const val POR_DEFECTO = 60

        /** El extra del aviso: abrir la app para armar la preparada. */
        const val EXTRA_ARMAR = "armar_preparada"

        private const val PREFS = "preparacion"
        private const val CLAVE = "carrera"
        private const val CLAVE_AVISO = "avisoMin"
        private const val CANAL = "preparacion"
        private const val ACCION = "com.themakercrowd.silosenosalgo.AVISO_PREPARADA"
        private const val EXTRA_CUAL = "cual"
        private const val AVISO = 1
        private const val RECORDATORIO = 2

        private val json = Json { ignoreUnknownKeys = true }

        /** Pedido desde el aviso, para que la pantalla lo haga (ver `MainActivity`). */
        private val _armarPedido = MutableStateFlow(false)
        val armarPedido: StateFlow<Boolean> = _armarPedido
        fun pideArmar() { _armarPedido.value = true }
        fun armadoAtendido() { _armarPedido.value = false }

        fun lee(ctx: Context): PreparacionDeCarrera? {
            val s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CLAVE, null) ?: return null
            val p = runCatching { json.decodeFromString<PreparacionDeCarrera>(s) }.getOrNull() ?: return null
            // Una de una salida que ya pasó hace rato no vale para nada.
            if (p.salidaMs < System.currentTimeMillis() - 6 * 3_600_000.0) { olvida(ctx); return null }
            return p
        }

        fun de(ctx: Context, eventoId: String): PreparacionDeCarrera? =
            lee(ctx)?.takeIf { it.eventoId == eventoId }

        /** El último aviso elegido: se propone el mismo la próxima vez. */
        fun avisoElegido(ctx: Context): Int {
            val v = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(CLAVE_AVISO, POR_DEFECTO)
            return if (v in OPCIONES) v else POR_DEFECTO
        }

        /** Dejarla lista: se guarda y se programan el aviso y el recordatorio. */
        fun guarda(ctx: Context, p: PreparacionDeCarrera) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(CLAVE, json.encodeToString(p))
                .putInt(CLAVE_AVISO, p.avisoMin)
                .apply()
            programa(ctx, p)
        }

        fun olvida(ctx: Context) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(CLAVE).apply()
            quitaAvisos(ctx)
        }

        /** Los dos avisos, con el despertador del sistema: llegan con la app cerrada. */
        fun programa(ctx: Context, p: PreparacionDeCarrera) {
            quitaAvisos(ctx)
            pon(ctx, AVISO, p.avisoMs)
            pon(ctx, RECORDATORIO, p.recordatorioMs)
        }

        /** Si se pueden poner a su hora exacta (Android 12+ lo pide aparte). */
        fun alarmasExactas(ctx: Context): Boolean {
            val am = ctx.getSystemService(AlarmManager::class.java)
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        }

        private fun pon(ctx: Context, cual: Int, cuandoMs: Double) {
            if (cuandoMs <= System.currentTimeMillis()) return
            val am = ctx.getSystemService(AlarmManager::class.java)
            val pi = intencion(ctx, cual)
            // A su hora si se puede; si no, aproximada (el sistema la agrupa
            // con otras, unos minutos arriba o abajo).
            if (alarmasExactas(ctx)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuandoMs.toLong(), pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuandoMs.toLong(), pi)
            }
        }

        fun quitaAvisos(ctx: Context) {
            val am = ctx.getSystemService(AlarmManager::class.java)
            am.cancel(intencion(ctx, AVISO))
            am.cancel(intencion(ctx, RECORDATORIO))
            NotificationManagerCompat.from(ctx).cancel(ID_NOTIFICACION)
        }

        private fun intencion(ctx: Context, cual: Int): PendingIntent =
            PendingIntent.getBroadcast(
                ctx, 700 + cual,
                Intent(ctx, AvisoDePreparacion::class.java).setAction(ACCION).putExtra(EXTRA_CUAL, cual),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        private const val ID_NOTIFICACION = 7_001

        /** El aviso de verdad, cuando salta la alarma. */
        internal fun avisa(ctx: Context, cual: Int) {
            val p = lee(ctx) ?: return
            // Ya armada (o en marcha): nada que avisar.
            if (TrackingStore.estado.value.compartiendo) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CANAL, "Preparar la carrera", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "El aviso de la mañana para dejar la baliza armada"
                },
            )
            val hora = hora(p.salidaMs)
            val (titulo, texto) = if (cual == AVISO) {
                "Hoy corres ${p.nombre}" to "Salida a las $hora. Toca para dejar la baliza armada: saldrá sola."
            } else {
                "⏳ ${p.nombre} sale en $RECORDATORIO_MIN min" to "La baliza aún no está armada. Toca para armarla."
            }
            val abrir = PendingIntent.getActivity(
                ctx, 710,
                Intent(ctx, MainActivity::class.java)
                    .putExtra(EXTRA_ARMAR, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val n = NotificationCompat.Builder(ctx, CANAL)
                .setSmallIcon(R.drawable.ic_notificacion)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
                .setContentIntent(abrir)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            runCatching { NotificationManagerCompat.from(ctx).notify(ID_NOTIFICACION, n) }
        }

        private fun hora(ms: Double): String =
            java.text.SimpleDateFormat("HH:mm", java.util.Locale("es", "ES")).format(java.util.Date(ms.toLong()))
    }
}

/**
 * Salta la alarma del aviso (o se reinicia el móvil, que borra las alarmas: se
 * vuelven a poner).
 */
class AvisoDePreparacion : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            PreparacionDeCarrera.lee(context)?.let { PreparacionDeCarrera.programa(context, it) }
            return
        }
        TrackingStore.inicia(context.applicationContext)
        PreparacionDeCarrera.avisa(context, intent.getIntExtra("cual", 1))
    }
}
