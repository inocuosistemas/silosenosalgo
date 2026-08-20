package com.themakercrowd.silosenosalgo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * El GPS, envuelto. Espejo de `ios/Sources/LocationManager.swift`.
 *
 * Entrega TODAS las lecturas por [onLectura]; el ritmo lo decide
 * [TrackingRules], igual que allí. Lo que cambia respecto a iOS es de dónde
 * salen las lecturas: aquí se usa el `LocationManager` de la plataforma y no
 * los servicios de Google Play. No es purismo — es que esta app se usa en
 * montaña, y depender de un componente que puede faltar o estar caducado en el
 * aparato a cambio de un fusionado de sensores que aquí no necesitamos sería
 * cambiar fiabilidad por comodidad.
 *
 * Que llegue algo con la pantalla apagada depende del servicio en primer plano
 * ([TrackingService]), no de esta clase: sin él Android congela las entregas a
 * los pocos minutos.
 */
class LocationEngine(private val context: Context) {

    var onLectura: ((Location) -> Unit)? = null

    private val manager: LocationManager? =
        ContextCompat.getSystemService(context, LocationManager::class.java)

    private var escuchando = false
    private var ajusteActual: TrackingRules.AjusteGps? = null
    private var latidoActivo = false

    private val listener = LocationListener { loc -> onLectura?.invoke(loc) }

    /**
     * Segundo enganche, SOLO por tiempo, que hace de latido.
     *
     * Es la pieza que hace que el seguimiento sobreviva a la pantalla apagada, y
     * cuesta explicarla pero no se puede quitar: parado y en modo distancia el
     * GPS no entrega nada, así que los puntos los tiene que generar algo cada
     * tanto. Ese "algo" NO puede ser un temporizador de la app: `postDelayed`
     * cuenta con `uptimeMillis`, que se para cuando la CPU se suspende con la
     * pantalla apagada, y entonces el latido deja de latir sin dar ningún error
     * — la traza simplemente se corta.
     *
     * Pidiéndoselo al propio `LocationManager` es el subsistema de ubicación
     * quien despierta la CPU para entregar cada lectura, y entre una y otra el
     * móvil puede seguir durmiendo. Mismo efecto que el `requestLocation` del
     * latido de iOS.
     */
    private val listenerLatido = LocationListener { loc -> onLectura?.invoke(loc) }

    /** ¿Tenemos el permiso de primer plano? Sin él no se puede ni empezar. */
    fun hayPermiso(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** ¿Y el de segundo plano? Se pide DESPUÉS del de primer plano, nunca a la
     *  vez: pedirlos juntos hace que Android rechace la petición en silencio. */
    fun hayPermisoSegundoPlano(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** ¿Está el GPS del aparato encendido? Con el permiso dado pero la ubicación
     *  apagada no llega ni una lectura, y hay que decirlo en vez de dejar la
     *  pantalla esperando para siempre. */
    fun ubicacionActivada(): Boolean = manager?.let {
        it.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            it.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    } ?: false

    /**
     * Aplica un ajuste. Reengancharse al proveedor con parámetros nuevos es la
     * única forma de cambiar el ritmo en Android, así que cambiar de perfil a
     * mitad de camino pasa por aquí; si el ajuste es el mismo no se toca nada,
     * para no reiniciar el GPS por gusto (un reenganche pierde el arranque en
     * caliente y las primeras lecturas vuelven a ser malas).
     */
    @SuppressLint("MissingPermission")
    fun aplica(ajuste: TrackingRules.AjusteGps) {
        if (!hayPermiso()) return
        val m = manager ?: return
        if (escuchando && ajuste == ajusteActual) return
        para()
        val proveedor = nombreProveedor(ajuste.proveedor, m)
        runCatching {
            m.requestLocationUpdates(
                proveedor,
                ajuste.tiempoMinimoMs,
                ajuste.distanciaMinimaM,
                listener,
                Looper.getMainLooper(),
            )
            escuchando = true
            ajusteActual = ajuste
        }
        // Con un filtro de distancia, el latido es obligatorio: sin él, quien se
        // para desaparece del mapa. Sin filtro no hace falta, porque el propio
        // enganche ya entrega por tiempo.
        if (ajuste.distanciaMinimaM > 0f) {
            enganchaLatido(m, proveedor, (TrackingRules.LATIDO_SEGUNDOS * 1000).toLong())
        }
    }

    @SuppressLint("MissingPermission")
    private fun enganchaLatido(m: LocationManager, proveedor: String, cadaMs: Long) {
        runCatching {
            m.requestLocationUpdates(proveedor, cadaMs, 0f, listenerLatido, Looper.getMainLooper())
            latidoActivo = true
        }
    }

    /**
     * Una lectura suelta, saltándose el filtro de distancia. Es el latido de
     * modo distancia: parado no llegan callbacks, y la última posición conocida
     * puede quedarse hasta `distanciaMetros` por detrás del sitio real.
     */
    @SuppressLint("MissingPermission")
    fun pideUnaLectura() {
        if (!hayPermiso()) return
        val m = manager ?: return
        val proveedor = nombreProveedor(TrackingRules.Proveedor.GPS, m)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                m.getCurrentLocation(proveedor, null, context.mainExecutor) { loc ->
                    if (loc != null) onLectura?.invoke(loc)
                }
            } else {
                @Suppress("DEPRECATION")
                m.requestSingleUpdate(proveedor, listener, Looper.getMainLooper())
            }
        }
    }

    /** La última posición conocida por el sistema, para no arrancar en blanco
     *  mientras el GPS engancha (puede ser vieja: solo se usa como semilla). */
    @SuppressLint("MissingPermission")
    fun ultimaConocida(): Location? {
        if (!hayPermiso()) return null
        val m = manager ?: return null
        return runCatching {
            m.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: m.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        }.getOrNull()
    }

    fun para() {
        runCatching { manager?.removeUpdates(listener) }
        runCatching { manager?.removeUpdates(listenerLatido) }
        escuchando = false
        latidoActivo = false
        ajusteActual = null
    }

    /** Si el proveedor pedido no está disponible se cae al otro antes que
     *  quedarse sin lecturas: media posición es mejor que ninguna. */
    private fun nombreProveedor(p: TrackingRules.Proveedor, m: LocationManager): String {
        val preferido = when (p) {
            TrackingRules.Proveedor.GPS -> LocationManager.GPS_PROVIDER
            TrackingRules.Proveedor.RED -> LocationManager.NETWORK_PROVIDER
        }
        if (runCatching { m.isProviderEnabled(preferido) }.getOrDefault(false)) return preferido
        val alternativo = if (preferido == LocationManager.GPS_PROVIDER) {
            LocationManager.NETWORK_PROVIDER
        } else {
            LocationManager.GPS_PROVIDER
        }
        return if (runCatching { m.isProviderEnabled(alternativo) }.getOrDefault(false)) {
            alternativo
        } else {
            preferido
        }
    }
}
