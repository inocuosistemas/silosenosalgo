package com.themakercrowd.silosenosalgo

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Los modelos del protocolo, espejo de `/shared/wireTypes.ts` y de la mitad
 * superior de `ios/Sources/API.swift`.
 *
 * Dos reglas que se repiten en todo el archivo y que son la fuente clásica de
 * errores al portar: **todas las marcas de tiempo son epoch en MILISEGUNDOS**
 * (Double, no Long: el backend puede mandar decimales) y **todo campo que un
 * servidor antiguo pueda no enviar es nullable con valor por defecto**, para
 * que un cliente nuevo no reviente contra un backend viejo.
 */

/** Tipo de movimiento que declara quien transmite (espejo de `BeaconActivity`).
 *  Nulo en la sesión = "Automático": el visor lo deduce de la traza. Decide la
 *  unidad de velocidad, el icono y la velocidad máxima realista con la que se
 *  descartan los saltos imposibles del GPS. */
@Serializable
enum class BeaconActivity {
    @SerialName("walk") WALK,
    @SerialName("run") RUN,
    @SerialName("bike") BIKE,
    @SerialName("transport") TRANSPORT;

    /** El valor que viaja por el cable (el mismo que el `rawValue` de Swift). */
    val wire: String
        get() = when (this) {
            WALK -> "walk"; RUN -> "run"; BIKE -> "bike"; TRANSPORT -> "transport"
        }

    val emoji: String
        get() = when (this) {
            WALK -> "🚶"; RUN -> "🏃"; BIKE -> "🚴"; TRANSPORT -> "🚌"
        }

    val label: String
        get() = when (this) {
            WALK -> "Caminar"; RUN -> "Correr"; BIKE -> "Bici"; TRANSPORT -> "Transporte"
        }

    /** Velocidad máxima realista (km/h), espejo de ACTIVITY_MAX_SPEED_KMH. */
    val maxSpeedKmh: Double
        get() = when (this) {
            WALK -> 12.0; RUN -> 25.0; BIKE -> 80.0; TRANSPORT -> 200.0
        }

    companion object {
        fun fromWire(value: String?): BeaconActivity? =
            entries.firstOrNull { it.wire == value }
    }
}

@Serializable
data class AuthUser(val id: String, val username: String)

@Serializable
data class AuthResponse(val user: AuthUser, val token: String? = null)

@Serializable
data class MeResponse(val user: AuthUser? = null)

@Serializable
data class CreateTrackResponse(val id: String, val expiresAt: Double)

/** Respuesta a un ping: cuántos siguen la sesión ahora mismo. Nullable porque
 *  un servidor antiguo contesta 204 sin cuerpo. */
@Serializable
data class PingResponse(val viewers: Int? = null)

/** Una sesión de seguimiento, tal como la lista GET /api/track. */
@Serializable
data class TrackSessionSummary(
    val id: String,
    val title: String? = null,
    val planName: String? = null,
    val status: String,
    val startedAt: Double,
    val expiresAt: Double,
    val updatedAt: Double? = null,
    val endedAt: Double? = null,
    val pinned: Boolean? = null,
    val activity: BeaconActivity? = null,
    /** Evento al que pertenece la salida; null = baliza suelta (o servidor
     *  viejo que no manda el campo). */
    val eventId: String? = null,
) {
    val isActive: Boolean get() = status == "active"

    /** `pinned` es nullable porque un servidor antiguo no lo manda: ausente se
     *  trata como "sin chincheta", que es el valor por defecto real. */
    val isPinned: Boolean get() = pinned == true
}

/**
 * Un evento en el que participo, tal y como lo necesita la baliza: lo justo
 * para elegirlo al empezar a compartir.
 *
 * El lobby, los colores y el mapa de todos viven en la web y necesitan
 * cobertura; aquí solo hace falta saber a qué carrera se atribuye esta salida,
 * que es lo único que la app tiene que decidir sin conexión.
 */
@Serializable
data class EventSummary(
    val id: String,
    val name: String,
    val planName: String? = null,
    val startsAt: Double? = null,
    /** Terminado por el organizador: no se ofrece para emitir. */
    val endedAt: Double? = null,
) {
    val isOver: Boolean get() = endedAt != null
}

@Serializable
data class EventsWrapper(val events: List<EventSummary> = emptyList())

/** Una posición enviada al backend. */
@Serializable
data class Fix(
    val lat: Double,
    val lon: Double,
    val trackKm: Double? = null,
    val speed: Double? = null,
    val heading: Double? = null,
    val accuracy: Double? = null,
    val altitude: Double? = null,
    val fixAt: Double? = null,
)

/** Una miga de pan de la traza local retenida (espejo de `TrailPoint`): `t` es
 *  epoch ms y `a` la precisión horizontal redondeada, ausente si no se conoce. */
@Serializable
data class TrailPoint(
    val t: Double,
    val lat: Double,
    val lon: Double,
    val a: Int? = null,
)

/** Una nota de campo anclada a una posición (espejo de `TrackNote`). Las claves
 *  coinciden 1:1 con la forma web porque alimentan al visor incrustado. */
@Serializable
data class Note(
    val id: String,
    val createdAt: Double,
    val fixAt: Double? = null,
    val lat: Double,
    val lon: Double,
    val accuracy: Double? = null,
    val altitude: Double? = null,
    val trackKm: Double? = null,
    val distM: Double? = null,
    val title: String? = null,
    val body: String? = null,
    val poiType: String,
    val poiSym: String? = null,
    val audioKey: String? = null,
    val photoKey: String? = null,
)

/** Uso de almacenamiento de medios frente a la cuota del usuario (bytes). */
@Serializable
data class StorageInfo(val usedBytes: Long, val quotaBytes: Long)

@Serializable
data class PlanSummary(
    val id: String,
    val name: String? = null,
    val routeName: String? = null,
    val distanceKm: Double? = null,
    /** Salida prevista del plan, en ISO. Es la referencia de los ritmos y las
     *  predicciones del visor: al elegir un plan, la hora de salida se toma de
     *  aquí y no del momento de darle a compartir. */
    val startTime: String? = null,
    val updatedAt: Double? = null,
)

/** Error del API con el mismo repertorio de códigos y textos que iOS: los dos
 *  clientes tienen que decir lo mismo ante el mismo fallo. */
class ApiException(val status: Int, val code: String) : Exception() {
    override val message: String
        get() = when (code) {
            "invalid_credentials" -> "Usuario o contraseña incorrectos."
            "username_taken" -> "Ese usuario ya existe."
            "invalid_username" -> "Usuario no válido (3–32 caracteres: a–z, 0–9, . _ -)."
            "invalid_password" -> "Contraseña no válida (mínimo 8 caracteres)."
            "rate_limited" -> "Demasiados intentos. Inténtalo de nuevo en unos minutos."
            "unauthorized" -> "Sesión caducada. Inicia sesión de nuevo."
            "ended" -> "La sesión de seguimiento ha terminado."
            "network" -> "No se pudo conectar con el servidor."
            else -> "Error ($status): $code"
        }
}
