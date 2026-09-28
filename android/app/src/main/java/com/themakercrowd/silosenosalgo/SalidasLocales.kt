package com.themakercrowd.silosenosalgo

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

/**
 * Usar la app SIN CUENTA: se graba la salida en el móvil y se ve en su mapa, sin
 * pasar por nuestro servidor. Lo que necesita servidor —que te sigan en directo
 * por un enlace, las carreras, los ánimos— pide entrar con una cuenta, que es por
 * invitación.
 *
 * Es lo que deja probar la app a quien la baja de la tienda sin invitación, y lo
 * que cuesta cero: no escribe nada en el servidor.
 */
object ModoLocal {
    private val _activo = MutableStateFlow(false)
    val activo: StateFlow<Boolean> = _activo.asStateFlow()

    /** Atajo para el código que no observa: ¿se está usando sin cuenta? */
    val esta: Boolean get() = _activo.value

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("modo", Context.MODE_PRIVATE)

    fun lee(ctx: Context) { _activo.value = prefs(ctx).getBoolean("local", false) }

    fun pon(ctx: Context, activo: Boolean) {
        prefs(ctx).edit().putBoolean("local", activo).apply()
        _activo.value = activo
    }
}

/**
 * Una salida grabada SOLO en este móvil: sin cuenta, o empezada sin cobertura y
 * terminada antes de poder darse de alta. El servidor no la conoce, así que sin
 * este apunte no tendría nombre ni fecha en el Archivo, y la poda —que conserva
 * solo lo que lista el servidor— la tiraría al entrar con una cuenta.
 */
@Serializable
data class SalidaLocal(
    val id: String,
    val titulo: String? = null,
    val startedAt: Double,
    /** null mientras se graba. */
    val endedAt: Double? = null,
    val actividad: BeaconActivity? = null,
) {
    /** Como las del servidor, para la misma lista del Archivo. No caduca: está
     *  en el móvil y no depende de nadie. */
    fun comoResumen() = TrackSessionSummary(
        id = id,
        title = titulo,
        status = if (endedAt == null) "active" else "ended",
        startedAt = startedAt,
        expiresAt = Double.MAX_VALUE,
        endedAt = endedAt,
        activity = actividad,
    )
}
