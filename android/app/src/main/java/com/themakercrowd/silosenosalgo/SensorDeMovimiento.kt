package com.themakercrowd.silosenosalgo

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Lo que dice el reconocimiento de actividad del móvil: a pie, corriendo, en
 * bici, en vehículo o quieto. Va con cada posición de una salida en
 * «Automático» sin ruta ni evento, y es lo que deja partir el recorrido en
 * tramos por medio de transporte (src/lib/tramosDeTransporte.ts en la web).
 * Espejo de `SensorDeMovimiento` en iOS.
 *
 * Es de los servicios de Google: en un móvil sin ellos (Huawei) no hay, y los
 * tramos salen solo por velocidad y mapa. Necesita el permiso de actividad
 * física, que se pide al empezar una salida inteligente.
 *
 * Códigos, los de `TrailPoint.m` (shared/wireTypes.ts): q quieto · w a pie ·
 * r corriendo · b bici · v en vehículo.
 */
object SensorDeMovimiento {
    /** Cada cuánto se pide: lo que cuesta es el GPS, no esto. */
    private const val CADA_MS = 20_000L
    /** Por debajo de esta confianza (0–100), no se dice nada. */
    private const val CONFIANZA_MIN = 50

    @Volatile var actual: String? = null
        private set
    private var encendido = false

    fun tienePermiso(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    private fun hayServicios(ctx: Context) =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS

    private fun intencion(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 60, Intent(ctx, Receptor::class.java),
        // Mutable: los servicios de Google escriben el resultado en ella.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    @SuppressLint("MissingPermission")
    fun enciende(ctx: Context) {
        if (encendido || !tienePermiso(ctx) || !hayServicios(ctx)) return
        encendido = true
        runCatching {
            ActivityRecognition.getClient(ctx).requestActivityUpdates(CADA_MS, intencion(ctx))
                .addOnFailureListener { encendido = false }
        }.onFailure { encendido = false }
    }

    @SuppressLint("MissingPermission")
    fun apaga(ctx: Context) {
        if (!encendido) return
        encendido = false
        actual = null
        runCatching { ActivityRecognition.getClient(ctx).removeActivityUpdates(intencion(ctx)) }
    }

    /** En vehículo manda sobre quieto: parado en un semáforo sigue yendo en coche. */
    internal fun codigo(actividades: List<Pair<Int, Int>>): String? {
        val validas = actividades.filter { it.second >= CONFIANZA_MIN }.map { it.first }
        return when {
            DetectedActivity.IN_VEHICLE in validas -> "v"
            DetectedActivity.ON_BICYCLE in validas -> "b"
            DetectedActivity.RUNNING in validas -> "r"
            DetectedActivity.WALKING in validas || DetectedActivity.ON_FOOT in validas -> "w"
            DetectedActivity.STILL in validas -> "q"
            else -> null
        }
    }

    class Receptor : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val r = ActivityRecognitionResult.extractResult(intent) ?: return
            codigo(r.probableActivities.map { it.type to it.confidence })?.let { actual = it }
        }
    }
}
