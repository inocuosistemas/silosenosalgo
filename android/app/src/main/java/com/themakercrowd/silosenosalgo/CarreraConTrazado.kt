package com.themakercrowd.silosenosalgo

import android.content.Context
import android.location.Location
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * La tarjeta de carrera con una RUTA propia, sin carrera detrás: se elige una
 * ruta de la cuenta y una hora de salida, se empieza a mano y sigue el GPS por
 * su cuenta (ver [EnDirectoService]), sin baliza y sin compartir la posición.
 * Espejo de `CarreraConTrazado` en iOS: lo que enseña —tramos, previsión,
 * cortes si la ruta los tiene— es lo mismo que en una carrera, sin corredores.
 *
 * Lo necesario se guarda en disco: si el sistema mata el proceso, el servicio
 * vuelve y sigue donde iba.
 */
object CarreraConTrazado {

    data class Estado(
        val enMarcha: Boolean = false,
        val nombre: String = "",
        val tramo: DatosTramo? = null,
        val posiciones: Int = 0,
        val ultimaMs: Double? = null,
        val errorM: Double? = null,
        /** El km de la ruta de la última posición; null si iba fuera de ella. */
        val km: Double? = null,
        val fueraDeRuta: Boolean = false,
    )

    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    @Serializable
    private data class Guardada(val clave: String, val nombre: String)

    private val json = Json { ignoreUnknownKeys = true }
    private var hoja: HojaDeTramos? = null
    private var puntos: List<PlanGeometry.PuntoPlan>? = null
    private var kmAcum: List<Double>? = null
    private var kmAnterior: Double? = null
    private var historia: List<Pair<Double, Double>> = emptyList()

    private fun dir(ctx: Context, clave: String) = File(ctx.filesDir, "trazado/$clave").apply { mkdirs() }
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("carrera-trazado", Context.MODE_PRIVATE)

    fun hayUnaGuardada(ctx: Context): Boolean = prefs(ctx).getString("guardada", null) != null

    /**
     * La hoja de una ruta con una hora de salida: se baja la ruta (hace falta
     * cobertura) y la calcula la web, como en una carrera pero sin ajustes de
     * organización. Sirve también para la vista previa.
     */
    suspend fun hoja(ctx: Context, planId: String, salidaMs: Double): Pair<HojaDeTramos, ByteArray> {
        val bytes = TrackingStore.bytesDelPlan(planId) ?: throw IllegalStateException("No se ha podido bajar la ruta (¿sin cobertura?).")
        val conversor = ConversorGpx(ctx)
        try {
            val texto = conversor.hojaDeTramos(bytes, null, salidaMs)
            return json.decodeFromString(HojaDeTramos.serializer(), texto) to bytes
        } finally {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { conversor.suelta() }
        }
    }

    /** Empezar: guarda lo necesario y arranca el servicio con el GPS. */
    suspend fun empieza(ctx: Context, planId: String, nombre: String, salidaMs: Double) {
        if (TrackingStore.tramo.value != null) {
            throw IllegalStateException("Ya hay una tarjeta de carrera en marcha, la de la baliza. Para la baliza para empezar esta.")
        }
        val (h, bytes) = hoja(ctx, planId, salidaMs)
        val clave = "plan-$planId"
        val d = dir(ctx, clave)
        File(d, "plan.gz").writeBytes(bytes)
        File(d, "hoja.json").writeText(json.encodeToString(HojaDeTramos.serializer(), h))
        prefs(ctx).edit().putString("guardada", json.encodeToString(Guardada.serializer(), Guardada(clave, nombre))).apply()
        carga(h, bytes)
        _estado.value = Estado(enMarcha = true, nombre = nombre, tramo = ReglasDeCarrera.datos(0.0, ahora(), historia, h))
        EnDirectoService.arranca(ctx)
    }

    private fun carga(h: HojaDeTramos, bytes: ByteArray) {
        hoja = h
        puntos = PlanGeometry.puntosConAltitud(bytes)
        kmAcum = puntos?.let { PlanGeometry.kmAcumulado(it) }
        kmAnterior = null
        historia = emptyList()
    }

    /** Al volver el servicio (o abrir la app): seguir con la guardada. */
    fun reanuda(ctx: Context): Boolean {
        if (_estado.value.enMarcha) return true
        val g = prefs(ctx).getString("guardada", null)
            ?.let { runCatching { json.decodeFromString(Guardada.serializer(), it) }.getOrNull() } ?: return false
        val d = File(ctx.filesDir, "trazado/${g.clave}")
        val h = runCatching { json.decodeFromString(HojaDeTramos.serializer(), File(d, "hoja.json").readText()) }.getOrNull()
        val bytes = runCatching { File(d, "plan.gz").readBytes() }.getOrNull()
        if (h == null || bytes == null) { olvida(ctx); return false }
        carga(h, bytes)
        _estado.value = Estado(enMarcha = true, nombre = g.nombre, tramo = ReglasDeCarrera.datos(0.0, ahora(), historia, h))
        return true
    }

    /** Terminar (o llegar a meta): fuera la tarjeta, el GPS y lo guardado. */
    fun termina(ctx: Context) {
        olvida(ctx)
        EnDirectoService.para(ctx)
    }

    private fun olvida(ctx: Context) {
        prefs(ctx).edit().remove("guardada").apply()
        hoja = null; puntos = null; kmAcum = null; historia = emptyList()
        _estado.value = Estado()
    }

    /** Una posición del GPS: su km en la ruta, y la tarjeta al día. */
    fun llega(loc: Location) {
        val h = hoja ?: return
        val e = _estado.value
        if (!e.enMarcha) return
        val precision = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null
        _estado.value = e.copy(posiciones = e.posiciones + 1, ultimaMs = loc.time.toDouble(), errorM = precision)
        if (precision != null && precision > 100) return
        val p = puntos ?: return
        val k = kmAcum ?: return
        val km = PlanGeometry.proyectaKm(p, k, loc.latitude, loc.longitude, kmAnterior)
            ?: if (kmAnterior != null) PlanGeometry.proyectaKm(p, k, loc.latitude, loc.longitude, null) else null
        if (km == null) {
            _estado.value = _estado.value.copy(fueraDeRuta = true, km = null)
            return
        }
        kmAnterior = km
        val ahora = ahora()
        historia = (historia + (ahora to km)).filter { ahora - it.first <= 2 * 3_600_000.0 }
        _estado.value = _estado.value.copy(
            fueraDeRuta = false, km = km,
            tramo = ReglasDeCarrera.datos(km, ahora, historia, h),
        )
    }

    /** El margen al corte cambia con el reloj aunque no se avance. */
    fun tic() {
        val h = hoja ?: return
        if (!_estado.value.enMarcha) return
        val km = kmAnterior ?: 0.0
        _estado.value = _estado.value.copy(tramo = ReglasDeCarrera.datos(km, ahora(), historia, h))
    }

    /** Para las pruebas en el emulador: la carrera de ejemplo, ya en marcha. */
    internal fun empiezaDePrueba(ctx: Context) {
        val h = HojaDeEjemplo.hoja(ahora() - 60 * 60_000.0)
        hoja = h; puntos = null; kmAcum = null
        kmAnterior = 6.0
        historia = listOf((ahora() - 40 * 60_000.0) to 2.0, ahora() to 6.0)
        _estado.value = Estado(enMarcha = true, nombre = "Vuelta al Montseny", km = 6.0,
            tramo = ReglasDeCarrera.datos(6.0, ahora(), historia, h))
        EnDirectoService.arranca(ctx)
    }

    private fun ahora() = System.currentTimeMillis().toDouble()
}
