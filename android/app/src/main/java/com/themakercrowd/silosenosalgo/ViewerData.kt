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

    /** Un cambio de forma confirmado por quien camina. */
    @Serializable
    data class FormaWire(val t: Double, val km: Double? = null, val factor: Double)

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
        /** Factor de forma confirmado (1 = el plan) y su historial. */
        val formFactor: Double? = null,
        val formLog: List<FormaWire>? = null,
    )

    @Volatile private var token: String? = null
    @Volatile private var usuario: String? = null
    @Volatile private var factorForma: Double = 1.0
    @Volatile private var historialForma: List<FormaWire> = emptyList()

    /** Límites del factor, los mismos que aplica el backend: fuera de ahí no es
     *  una recalibración, es un dato roto. */
    private const val FACTOR_MIN = 0.5
    private const val FACTOR_MAX = 2.2

    /** El historial se recorta: es para ver la evolución, no un registro
     *  contable, y en una ultra de 30 h se dispararía. */
    private const val HISTORIAL_MAX = 40

    /**
     * Quien camina confirma que va a otro ritmo del planificado. Llega desde el
     * propio visor (el interceptor lo encamina aquí), se guarda en disco para
     * que sobreviva a un reinicio, y se refleja ya en el estado sintetizado
     * aunque no haya cobertura para contárselo al servidor.
     */
    fun ajustaForma(sessionId: String, factor: Double, km: Double?, ahoraMs: Double) {
        if (token != sessionId) return
        val acotado = factor.coerceIn(FACTOR_MIN, FACTOR_MAX)
        factorForma = acotado
        historialForma = (historialForma + FormaWire(ahoraMs, km, acotado))
            .takeLast(HISTORIAL_MAX)
        TrackingStore.guardaForma(sessionId, acotado, historialForma)
    }

    /** Recupera de disco la forma confirmada al retomar una sesión. */
    fun cargaForma(factor: Double, historial: List<FormaWire>) {
        factorForma = factor
        historialForma = historial
    }

    /** El nombre que se enseña al seguir la ruta; lo pone la pantalla, que es
     *  quien conoce al usuario autenticado. */
    fun ponUsuario(nombre: String?) { usuario = nombre }

    fun registra(sessionId: String?) {
        token = sessionId
        // La forma es de cada sesión: al cambiar de sesión hay que soltar la de
        // la anterior o se arrastraría un factor que no es suyo.
        factorForma = 1.0
        historialForma = emptyList()
    }

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
            // El id de la sesión hace de id de "share": el visor pedirá
            // `/api/share/<sessionId>` y el interceptor le devolverá el blob del
            // plan que está en el móvil. Solo se anuncia si de verdad está
            // guardado: anunciarlo sin tenerlo dejaría al visor esperando una
            // ruta que nunca llega.
            planShareId = if (TrackingStore.hayPlanDe(id)) id else null,
            activity = estado.actividadEfectiva?.wire,
            fix = real,
            trail = TrackingStore.trazaActual(),
            reportedFix = reportada,
            notes = notas.ifEmpty { null },
            formFactor = factorForma,
            formLog = historialForma.ifEmpty { null },
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
