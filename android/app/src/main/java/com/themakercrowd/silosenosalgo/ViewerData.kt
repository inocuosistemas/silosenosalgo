package com.themakercrowd.silosenosalgo

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/**
 * Lo que el visor incrustado pide a `/api/track/:id`, pero fabricado aquí con la
 * traza local en vez de traído de la red. Espejo de `TrackStateWire` y de
 * `ViewerDataProvider` en `ios/Sources/ViewerDataProvider.swift`.
 *
 * Es lo que hace que el mapa funcione sin cobertura: el visor es el MISMO código
 * web que ve quien te sigue desde casa, y no sabe que le están contestando desde
 * el propio móvil.
 *
 * Solo se sirve en local la sesión que se está transmitiendo ahora. Las
 * terminadas se abren online, como en iOS.
 */
object ViewerData {

    /** La forma de `TrackFix` que consume el visor. Los nulos se OMITEN: el
     *  visor trata `undefined` y `null` igual, pero omitir es lo que hace el
     *  backend y conviene no divergir. */
    @Serializable
    data class FixWire(
        val lat: Double,
        val lon: Double,
        val trackKm: Double? = null,
        val speed: Double? = null,
        val heading: Double? = null,
        val accuracy: Double? = null,
        val altitude: Double? = null,
        val fixAt: Double? = null,
        val updatedAt: Double,
    )

    @Serializable
    data class EstadoWire(
        val status: String,
        val username: String? = null,
        val title: String? = null,
        val startedAt: Double,
        val expiresAt: Double,
        val endedAt: Double? = null,
        val planShareId: String? = null,
        val activity: String? = null,
        val fix: FixWire? = null,
        val trail: List<TrailPoint> = emptyList(),
        /** Solo en el visor incrustado: la última posición que llegó de verdad
         *  al servidor. La API pública nunca manda esto; el visor lo usa para
         *  dibujar el hueco entre dónde estás y dónde te ven. */
        val reportedFix: FixWire? = null,
        val notes: List<Note>? = null,
    )

    @Volatile private var token: String? = null
    @Volatile private var usuario: String? = null

    /** El nombre que se enseña al seguir la ruta; lo pone la pantalla, que es
     *  quien conoce al usuario autenticado. */
    fun ponUsuario(nombre: String?) { usuario = nombre }

    fun registra(sessionId: String?) { token = sessionId }

    fun esLaActual(id: String): Boolean = token == id

    /**
     * El estado sintetizado para `id`, o null si no es la sesión actual (el
     * interceptor contesta entonces 404 y el visor se comporta igual que ante
     * una sesión que no existe).
     */
    fun estadoJson(id: String, estado: TrackingStore.Estado, notas: List<Note>): String? {
        if (estado.sessionId != id) return null

        val real = estado.ultimaLectura?.let { aWire(it, it.fixAt ?: estado.salidaMs) }
        val reportada = estado.ultimaReportada?.let {
            aWire(it, estado.ultimoEnvioMs ?: it.fixAt ?: estado.salidaMs)
        }

        val wire = EstadoWire(
            status = if (estado.compartiendo) "active" else "ended",
            username = usuario,
            title = estado.titulo,
            startedAt = estado.salidaMs,
            // Sin dato real de caducidad en local se usa la retención elegida:
            // el visor solo lo utiliza para avisar de cuándo dejará de verse.
            expiresAt = estado.salidaMs + estado.retenerHoras * 3_600_000,
            endedAt = if (!estado.compartiendo) estado.ultimoEnvioMs else null,
            activity = estado.actividadEfectiva?.wire,
            fix = real,
            trail = TrackingStore.trazaActual(),
            reportedFix = reportada,
            notes = notas.ifEmpty { null },
        )
        return Api.json.encodeToString(wire)
    }

    private fun aWire(f: Fix, actualizado: Double) = FixWire(
        lat = f.lat,
        lon = f.lon,
        trackKm = f.trackKm,
        speed = f.speed,
        heading = f.heading,
        accuracy = f.accuracy,
        altitude = f.altitude,
        fixAt = f.fixAt,
        updatedAt = actualizado,
    )
}
