package com.themakercrowd.silosenosalgo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.WindowManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Dónde está quien mira el visor, y hacia dónde mira: lo que el visor pide a
 * `/api/yo` para pintar su punto azul con el cono de la brújula (ver
 * `src/lib/miPosicion.ts`). Espejo de `ios/Sources/MiPosicion.swift`.
 *
 * Va aparte del GPS de la baliza ([LocationEngine]): aquel se enciende y se
 * apaga con la salida; este, solo mientras el visor pregunta. Cada pregunta
 * alarga la vida del GPS unos segundos; si el visor deja de preguntar, se
 * apaga solo. La app ya tiene permiso de ubicación —es una baliza—; si no lo
 * tuviera, el visor dice que no hay permiso (pedirlo es cosa de la app, no de
 * una petición del visor).
 */
object MiPosicion {
    /** Sin preguntas en este tiempo, el GPS y la brújula se apagan. */
    private const val VIDA_MS = 6_000L

    private val principal = Handler(Looper.getMainLooper())
    private var contexto: Context? = null
    @Volatile private var ultima: Location? = null
    @Volatile private var rumbo: Double? = null
    private var encendido = false

    private val gps = LocationListener { l -> ultima = mejor(ultima, l) }
    private val apaga = Runnable { apaga() }

    private val brujula = object : SensorEventListener {
        private val r = FloatArray(9)
        private val remapeada = FloatArray(9)
        private val o = FloatArray(3)
        override fun onSensorChanged(e: SensorEvent) {
            SensorManager.getRotationMatrixFromVector(r, e.values)
            // La pantalla girada cambia hacia dónde "mira" el móvil.
            val (x, y) = when (rotacion()) {
                Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
                Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
                Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
                else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
            }
            SensorManager.remapCoordinateSystem(r, x, y, remapeada)
            SensorManager.getOrientation(remapeada, o)
            var grados = Math.toDegrees(o[0].toDouble())
            // Del norte magnético al de verdad, si se sabe dónde se está.
            ultima?.let { l ->
                grados += GeomagneticField(l.latitude.toFloat(), l.longitude.toFloat(), l.altitude.toFloat(), System.currentTimeMillis()).declination
            }
            rumbo = (grados + 360.0) % 360.0
        }
        override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
    }

    /** La respuesta para el visor, en JSON. Se llama desde un hilo de WebView. */
    fun responde(context: Context): ByteArray {
        val app = context.applicationContext
        contexto = app
        val fino = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val grueso = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fino && !grueso) return JSONObject().put("estado", "sin-permiso").toString().toByteArray()
        principal.post { enciende(app) }
        val l = ultima ?: return JSONObject().put("estado", "esperando").toString().toByteArray()
        return JSONObject()
            .put("estado", "ok")
            .put("lat", l.latitude)
            .put("lon", l.longitude)
            .put("precision", if (l.hasAccuracy()) l.accuracy.toDouble() else JSONObject.NULL)
            .put("rumbo", rumbo ?: JSONObject.NULL)
            .put("t", l.time)
            .toString().toByteArray()
    }

    @SuppressLint("MissingPermission") // comprobado en `responde`
    private fun enciende(app: Context) {
        if (!encendido) {
            encendido = true
            val lm = ContextCompat.getSystemService(app, LocationManager::class.java)
            if (lm != null) {
                for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    if (!runCatching { lm.isProviderEnabled(p) }.getOrDefault(false)) continue
                    runCatching {
                        lm.getLastKnownLocation(p)?.let { ultima = mejor(ultima, it) }
                        lm.requestLocationUpdates(p, 1_000L, 1f, gps, Looper.getMainLooper())
                    }
                }
            }
            val sm = ContextCompat.getSystemService(app, SensorManager::class.java)
            sm?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let {
                sm.registerListener(brujula, it, SensorManager.SENSOR_DELAY_UI)
            }
        }
        principal.removeCallbacks(apaga)
        principal.postDelayed(apaga, VIDA_MS)
    }

    private fun apaga() {
        val app = contexto ?: return
        encendido = false
        ContextCompat.getSystemService(app, LocationManager::class.java)?.removeUpdates(gps)
        ContextCompat.getSystemService(app, SensorManager::class.java)?.unregisterListener(brujula)
        rumbo = null
    }

    @Suppress("DEPRECATION")
    private fun rotacion(): Int {
        val app = contexto ?: return Surface.ROTATION_0
        return ContextCompat.getSystemService(app, WindowManager::class.java)?.defaultDisplay?.rotation ?: Surface.ROTATION_0
    }

    /** La lectura que vale más: la más reciente, salvo que sea mucho peor y casi igual de vieja. */
    private fun mejor(a: Location?, b: Location): Location {
        if (a == null) return b
        val masNueva = b.time - a.time
        if (masNueva > 10_000) return b
        if (masNueva < -10_000) return a
        return if (!b.hasAccuracy() || (a.hasAccuracy() && b.accuracy > a.accuracy * 2)) a else b
    }
}
