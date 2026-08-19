package com.themakercrowd.silosenosalgo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Cliente HTTP del backend, espejo de `ios/Sources/API.swift`.
 *
 * Dos detalles del protocolo que no son evidentes y que hay que respetar:
 *
 *  - **`X-Auth-Mode: token` en TODAS las peticiones.** Le dice al backend que
 *    este cliente no usa cookies; sin esa cabecera el login contesta con una
 *    cookie de sesión que una app nativa no puede aprovechar.
 *  - **Los campos opcionales se OMITEN, no se mandan como null.** El backend
 *    distingue "no lo sé" de "ponlo a null" (p. ej. `activity`), así que los
 *    cuerpos se construyen a mano en vez de serializar el modelo entero.
 */
class Api(
    private val baseUrl: String = Config.BASE_URL,
    private val client: OkHttpClient = defaultClient,
) {
    companion object {
        private val JSON_MEDIA = "application/json".toMediaType()

        val json = Json {
            ignoreUnknownKeys = true      // un backend más nuevo no puede tumbar al cliente
            explicitNulls = false
        }

        val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()
        }
    }

    // ── Fontanería ───────────────────────────────────────────────────────────

    private suspend fun request(
        path: String,
        method: String,
        token: String?,
        body: JsonObject? = null,
    ): Pair<String, Int> = withContext(Dispatchers.IO) {
        val reqBody: RequestBody? = when {
            body != null -> body.toString().toRequestBody(JSON_MEDIA)
            // POST/PUT sin cuerpo necesitan uno vacío: OkHttp lo exige.
            method == "POST" || method == "PUT" -> ByteArray(0).toRequestBody(JSON_MEDIA)
            else -> null
        }
        val req = Request.Builder()
            .url("$baseUrl/$path")
            .method(method, reqBody)
            .header("Content-Type", "application/json")
            .header("X-Auth-Mode", "token")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
        try {
            client.newCall(req).execute().use { resp ->
                (resp.body?.string() ?: "") to resp.code
            }
        } catch (e: IOException) {
            throw ApiException(0, "network")
        }
    }

    /** El backend contesta `{"error":"codigo"}`; si no se puede leer, se usa el
     *  estado como código para no perder la pista. */
    private fun decodeError(body: String, status: Int): ApiException {
        val code = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull() ?: "http_$status"
        return ApiException(status, code)
    }

    private fun ok(status: Int) = status in 200..299

    private inline fun <reified T> decode(body: String): T = json.decodeFromString(body)

    // ── Auth ─────────────────────────────────────────────────────────────────

    suspend fun login(username: String, password: String): AuthResponse {
        val (body, status) = request(
            "api/auth/login", "POST", null,
            buildJsonObject {
                put("username", JsonPrimitive(username))
                put("password", JsonPrimitive(password))
            },
        )
        if (!ok(status)) throw decodeError(body, status)
        return decode(body)
    }

    suspend fun register(username: String, password: String): AuthResponse {
        val (body, status) = request(
            "api/auth/register", "POST", null,
            buildJsonObject {
                put("username", JsonPrimitive(username))
                put("password", JsonPrimitive(password))
            },
        )
        if (!ok(status)) throw decodeError(body, status)
        return decode(body)
    }

    suspend fun me(token: String): AuthUser? {
        val (body, status) = request("api/auth/me", "GET", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode<MeResponse>(body).user
    }

    suspend fun logout(token: String) {
        runCatching { request("api/auth/logout", "POST", token) }
    }

    // ── Rutas planificadas ───────────────────────────────────────────────────

    suspend fun listPlans(token: String): List<PlanSummary> {
        val (body, status) = request("api/plans", "GET", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode<PlansWrapper>(body).plans
    }

    @kotlinx.serialization.Serializable
    private data class PlansWrapper(val plans: List<PlanSummary> = emptyList())

    @kotlinx.serialization.Serializable
    private data class SessionsWrapper(val sessions: List<TrackSessionSummary> = emptyList())

    /**
     * Los bytes CRUDOS de un plan: un SharePayload comprimido en gzip, tal cual
     * lo produjo el navegador al guardarlo. No se decodifica aquí a propósito —
     * se guardan como llegan para que el visor incrustado pueda servirlos igual
     * que el backend, sin volver a comprimir ni arriesgarse a alterarlos.
     */
    suspend fun fetchPlanPayload(token: String, planId: String): ByteArray =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$baseUrl/api/plans/$planId")
                .header("X-Auth-Mode", "token")
                .header("Authorization", "Bearer $token")
                .build()
            try {
                client.newCall(req).execute().use { resp ->
                    if (!ok(resp.code)) throw decodeError(resp.body?.string() ?: "", resp.code)
                    resp.body?.bytes() ?: ByteArray(0)
                }
            } catch (e: IOException) {
                throw ApiException(0, "network")
            }
        }

    // ── Almacenamiento ───────────────────────────────────────────────────────

    suspend fun storage(token: String): StorageInfo {
        val (body, status) = request("api/storage", "GET", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode(body)
    }

    // ── Seguimiento ──────────────────────────────────────────────────────────

    suspend fun listSessions(token: String): List<TrackSessionSummary> {
        val (body, status) = request("api/track", "GET", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode<SessionsWrapper>(body).sessions
    }

    suspend fun createTrack(
        token: String,
        title: String? = null,
        planId: String? = null,
        startAt: Double? = null,
        activity: BeaconActivity? = null,
    ): CreateTrackResponse {
        val (body, status) = request(
            "api/track", "POST", token,
            buildJsonObject {
                if (!title.isNullOrEmpty()) put("title", JsonPrimitive(title))
                if (planId != null) put("planId", JsonPrimitive(planId))
                if (startAt != null) put("startAt", JsonPrimitive(startAt))
                if (activity != null) put("activity", JsonPrimitive(activity.wire))
            },
        )
        if (!ok(status)) throw decodeError(body, status)
        return decode(body)
    }

    private fun fixJson(f: Fix) = buildJsonObject {
        put("lat", JsonPrimitive(f.lat))
        put("lon", JsonPrimitive(f.lon))
        f.trackKm?.let { put("trackKm", JsonPrimitive(it)) }
        f.speed?.let { put("speed", JsonPrimitive(it)) }
        f.heading?.let { put("heading", JsonPrimitive(it)) }
        f.accuracy?.let { put("accuracy", JsonPrimitive(it)) }
        f.altitude?.let { put("altitude", JsonPrimitive(it)) }
        f.fixAt?.let { put("fixAt", JsonPrimitive(it)) }
    }

    suspend fun ping(token: String, id: String, fix: Fix) {
        val (body, status) = request("api/track/$id/ping", "POST", token, fixJson(fix))
        if (!ok(status)) throw decodeError(body, status)
    }

    /**
     * Sube de golpe varias posiciones acumuladas (vaciado del atasco offline).
     * El servidor las ordena por `fixAt` y toma la más reciente como posición
     * en vivo. Devuelve los seguidores activos (null contra un servidor antiguo
     * que contesta 204 sin cuerpo).
     */
    suspend fun pingBatch(token: String, id: String, fixes: List<Fix>): Int? {
        val (body, status) = request(
            "api/track/$id/ping", "POST", token,
            buildJsonObject {
                put("fixes", buildJsonArray { fixes.forEach { add(fixJson(it)) } })
            },
        )
        if (!ok(status)) throw decodeError(body, status)
        return runCatching { decode<PingResponse>(body).viewers }.getOrNull()
    }

    /**
     * Crea una nota de campo. Lleva un `id` generado por el cliente, así que
     * reintentar tras una respuesta perdida es idempotente (el servidor
     * de-duplica con INSERT OR IGNORE): una nota tomada sin cobertura no se
     * puede duplicar al vaciar el atasco.
     */
    suspend fun createNote(token: String, sessionId: String, note: Note) {
        val (body, status) = request(
            "api/track/$sessionId/notes", "POST", token,
            buildJsonObject {
                put("id", JsonPrimitive(note.id))
                put("createdAt", JsonPrimitive(note.createdAt))
                put("lat", JsonPrimitive(note.lat))
                put("lon", JsonPrimitive(note.lon))
                put("poiType", JsonPrimitive(note.poiType))
                note.fixAt?.let { put("fixAt", JsonPrimitive(it)) }
                note.accuracy?.let { put("accuracy", JsonPrimitive(it)) }
                note.altitude?.let { put("altitude", JsonPrimitive(it)) }
                note.trackKm?.let { put("trackKm", JsonPrimitive(it)) }
                note.distM?.let { put("distM", JsonPrimitive(it)) }
                note.title?.let { put("title", JsonPrimitive(it)) }
                note.body?.let { put("body", JsonPrimitive(it)) }
                note.poiSym?.let { put("poiSym", JsonPrimitive(it)) }
            },
        )
        if (!ok(status)) throw decodeError(body, status)
    }

    suspend fun deleteNote(token: String, sessionId: String, noteId: String) {
        val (body, status) = request("api/track/$sessionId/notes/$noteId", "DELETE", token)
        if (!ok(status)) throw decodeError(body, status)
    }

    /** Sube el medio de una nota (audio/foto) como cuerpo crudo: `kind` es
     *  "audio" | "photo" y `contentType` audio/mp4 | image/jpeg. */
    suspend fun uploadNoteMedia(
        token: String, sessionId: String, noteId: String,
        kind: String, data: ByteArray, contentType: String,
    ) = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("$baseUrl/api/track/$sessionId/notes/$noteId/media?kind=$kind")
            .put(data.toRequestBody(contentType.toMediaType()))
            .header("X-Auth-Mode", "token")
            .header("Authorization", "Bearer $token")
            .build()
        try {
            client.newCall(req).execute().use { resp ->
                if (!ok(resp.code)) throw decodeError(resp.body?.string() ?: "", resp.code)
            }
        } catch (e: IOException) {
            throw ApiException(0, "network")
        }
    }

    /** Reabre una sesión terminada (mismo enlace) para seguir compartiendo. */
    suspend fun reopen(token: String, id: String): CreateTrackResponse {
        val (body, status) = request("api/track/$id/reopen", "POST", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode(body)
    }

    suspend fun end(token: String, id: String, retainHours: Double? = null) {
        runCatching {
            request(
                "api/track/$id/end", "POST", token,
                retainHours?.let { buildJsonObject { put("retainHours", JsonPrimitive(it)) } },
            )
        }
    }

    suspend fun deleteSession(token: String, id: String) {
        runCatching { request("api/track/$id", "DELETE", token) }
    }

    /** Chincheta: las sesiones fijadas se conservan indefinidamente. */
    suspend fun setPinned(token: String, id: String, pinned: Boolean) {
        runCatching {
            request(
                "api/track/$id/pin", "POST", token,
                buildJsonObject { put("pinned", JsonPrimitive(pinned)) },
            )
        }
    }

    /** Un título vacío devuelve la sesión a "Sin nombre". */
    suspend fun rename(token: String, id: String, title: String?) {
        runCatching {
            request(
                "api/track/$id/rename", "POST", token,
                buildJsonObject { put("title", JsonPrimitive(title ?: "")) },
            )
        }
    }

    /** Cadena vacía = "Automático" (el servidor lo deduce o lo deja sin poner). */
    suspend fun setActivity(token: String, id: String, activity: BeaconActivity?) {
        runCatching {
            request(
                "api/track/$id/activity", "POST", token,
                buildJsonObject { put("activity", JsonPrimitive(activity?.wire ?: "")) },
            )
        }
    }
}
