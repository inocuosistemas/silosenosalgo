package com.themakercrowd.silosenosalgo

import android.content.Context
import android.location.Location
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

@Serializable
data class LugarDeViaje(val nombre: String, val abreviatura: String, val lat: Double, val lon: Double)

@Serializable
enum class TransporteDeViaje(val nombre: String, val emoji: String) {
    AVION("Avión", "✈️"), TREN("Tren", "🚆"), COCHE("Coche", "🚗"), AUTOBUS("Autobús", "🚌"),
    BARCO("Barco", "⛴️"), BICI("Bici", "🚲"), ANDANDO("A pie", "🚶"),
}

@Serializable
data class ColoresDeViaje(val fondo: String = "#0f1729", val trayecto: String = "#0284c7", val trayecto2: String? = "#38bdf8")

/** Lo que se configura de un viaje. Espejo de `ViajeAtributos` en iOS. */
@Serializable
data class Viaje(
    val titulo: String? = null,
    val origen: LugarDeViaje,
    val destino: LugarDeViaje,
    val transporte: TransporteDeViaje = TransporteDeViaje.AVION,
    val colores: ColoresDeViaje = ColoresDeViaje(),
    /** Parado este rato cerca del destino, se da por llegado (0, nunca). */
    val paradaMin: Int = 5,
) {
    val totalKm: Double get() = ReglasDeViaje.km(origen.lat, origen.lon, destino.lat, destino.lon)
}

/**
 * Las REGLAS del viaje en directo, sin estado para poder probarlas. Traducción
 * de `ReglasDeViaje` en iOS: si una cambia, cambia la otra. (Sin ruta por
 * carretera: en Android no hay un Apple Maps gratis; va en línea recta.)
 */
object ReglasDeViaje {
    /** Distancia en línea recta (haversine), en km. */
    fun km(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371.0
        val f1 = Math.toRadians(lat1); val f2 = Math.toRadians(lat2)
        val df = Math.toRadians(lat2 - lat1); val dl = Math.toRadians(lon2 - lon1)
        val h = sin(df / 2) * sin(df / 2) + cos(f1) * cos(f2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * asin(min(1.0, sqrt(h)))
    }

    fun progreso(restante: Double, total: Double): Double = if (total <= 0) 1.0 else (1 - restante / total).coerceIn(0.0, 1.0)

    /** A cuánto del destino se da por llegado: el 2 % del viaje, de 100 m a 2 km. */
    fun radioDeLlegada(totalKm: Double): Double = max(0.1, min(2.0, totalKm * 0.02))

    /** Con la precisión de ESTA posición: por tierra y con buena señal, se
     *  llega de verdad (100 m); en avión, el de siempre. */
    fun radioDeLlegada(totalKm: Double, precision: Double?, transporte: TransporteDeViaje): Double {
        val base = radioDeLlegada(totalKm)
        if (transporte == TransporteDeViaje.AVION || precision == null || precision < 0) return base
        return min(base, max(0.1, 3 * precision / 1000))
    }

    /** A qué hora se llega a esta velocidad (m/s); null parado o si sale más de un día. */
    fun llegada(restanteKm: Double, velocidad: Double?, ahoraMs: Double): Double? {
        if (velocidad == null || velocidad <= 1) return null
        val s = restanteKm * 1000 / velocidad
        return if (s < 24 * 3600) ahoraMs + s * 1000 else null
    }

    /** El error máximo que se admite: 1 km, o el 1 % del viaje si es más. */
    fun precisionAdmitida(totalKm: Double): Double = max(1000.0, totalKm * 1000 * 0.01)

    /** Parado cerca del destino: dónde y desde cuándo. */
    data class Parada(val lat: Double, val lon: Double, val desdeMs: Double)

    fun parada(anterior: Parada?, lat: Double, lon: Double, precision: Double?, tiempoMs: Double, viaje: Viaje): Parada? {
        if (viaje.paradaMin <= 0) return null
        if (km(lat, lon, viaje.destino.lat, viaje.destino.lon) > radioDeLlegada(viaje.totalKm)) return null
        if (anterior != null && km(anterior.lat, anterior.lon, lat, lon) * 1000 <= max(75.0, precision ?: 0.0)) return anterior
        return Parada(lat, lon, tiempoMs)
    }

    fun llegadoPorParada(p: Parada?, ahoraMs: Double, minutos: Int): Boolean =
        p != null && minutos > 0 && ahoraMs - p.desdeMs >= minutos * 60_000.0
}

/**
 * El VIAJE EN DIRECTO: lo que se enseña en la notificación, al día con el GPS
 * (ver [EnDirectoService]). Espejo de `ViajeEnDirecto` en iOS.
 */
object ViajeEnDirecto {
    data class Estado(
        val enMarcha: Boolean = false,
        val viaje: Viaje? = null,
        val restanteKm: Double = 0.0,
        val progreso: Double = 0.0,
        val llegadaMs: Double? = null,
        val llegado: Boolean = false,
        val posiciones: Int = 0,
        val descartadas: Int = 0,
        val ultimaMs: Double? = null,
        val errorM: Double? = null,
        val paradoDesdeMs: Double? = null,
    )

    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()
    private var parada: ReglasDeViaje.Parada? = null
    private val json = Json { ignoreUnknownKeys = true }
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("viaje", Context.MODE_PRIVATE)

    // ── El borrador: lo configurado se guarda al momento ─────────────────────

    fun leeBorrador(ctx: Context): Viaje? = prefs(ctx).getString("borrador", null)
        ?.let { runCatching { json.decodeFromString(Viaje.serializer(), it) }.getOrNull() }

    fun guardaBorrador(ctx: Context, v: Viaje) {
        prefs(ctx).edit().putString("borrador", json.encodeToString(Viaje.serializer(), v)).apply()
    }

    // ── Empezar, terminar, retomar ───────────────────────────────────────────

    fun empieza(ctx: Context, v: Viaje) {
        prefs(ctx).edit().putString("enMarcha", json.encodeToString(Viaje.serializer(), v)).apply()
        parada = null
        _estado.value = Estado(enMarcha = true, viaje = v, restanteKm = v.totalKm, progreso = 0.0)
        EnDirectoService.arranca(ctx)
    }

    fun reanuda(ctx: Context): Boolean {
        if (_estado.value.enMarcha) return true
        val v = prefs(ctx).getString("enMarcha", null)
            ?.let { runCatching { json.decodeFromString(Viaje.serializer(), it) }.getOrNull() } ?: return false
        _estado.value = Estado(enMarcha = true, viaje = v, restanteKm = v.totalKm)
        return true
    }

    fun hayUnoGuardado(ctx: Context) = prefs(ctx).getString("enMarcha", null) != null

    fun termina(ctx: Context) {
        prefs(ctx).edit().remove("enMarcha").apply()
        parada = null
        _estado.value = Estado()
        EnDirectoService.refresca(ctx)
    }

    /** Una posición del GPS. */
    fun llega(loc: Location) {
        val e = _estado.value
        val v = e.viaje ?: return
        if (!e.enMarcha || e.llegado) return
        val precision = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null
        val ahora = System.currentTimeMillis().toDouble()
        if (precision != null && precision > ReglasDeViaje.precisionAdmitida(v.totalKm)) {
            _estado.value = e.copy(descartadas = e.descartadas + 1, ultimaMs = loc.time.toDouble(), errorM = precision)
            return
        }
        val resta = ReglasDeViaje.km(loc.latitude, loc.longitude, v.destino.lat, v.destino.lon)
        parada = ReglasDeViaje.parada(parada, loc.latitude, loc.longitude, precision, loc.time.toDouble(), v)
        val llegado = resta <= ReglasDeViaje.radioDeLlegada(v.totalKm, precision, v.transporte) ||
            ReglasDeViaje.llegadoPorParada(parada, loc.time.toDouble(), v.paradaMin)
        _estado.value = e.copy(
            restanteKm = if (llegado) 0.0 else resta,
            progreso = if (llegado) 1.0 else ReglasDeViaje.progreso(resta, v.totalKm),
            llegadaMs = if (llegado) null else ReglasDeViaje.llegada(resta, if (loc.hasSpeed()) loc.speed.toDouble() else null, ahora),
            llegado = llegado,
            posiciones = e.posiciones + 1,
            ultimaMs = loc.time.toDouble(),
            errorM = precision,
            paradoDesdeMs = parada?.desdeMs,
        )
    }

    /** Para las pruebas: un viaje de ejemplo, a medio camino. */
    internal fun empiezaDePrueba(ctx: Context) {
        val v = Viaje(
            titulo = "Esquí en Grandvalira",
            origen = LugarDeViaje("Barcelona", "BCN", 41.3874, 2.1686),
            destino = LugarDeViaje("Andorra la Vella", "AND", 42.5063, 1.5218),
            transporte = TransporteDeViaje.COCHE,
        )
        _estado.value = Estado(enMarcha = true, viaje = v, restanteKm = v.totalKm * 0.6, progreso = 0.4,
            llegadaMs = System.currentTimeMillis() + 75 * 60_000.0, posiciones = 12)
        EnDirectoService.arranca(ctx)
    }
}
