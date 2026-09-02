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

    // No hay `register`. El alta es solo por invitación y se hace en la web: el
    // backend exige un código válido (`invite`) y contesta 400 sin él, así que
    // un registro desde la app no puede funcionar por definición. Si algún día
    // se quiere aquí, hay que pedir el código en la pantalla y mandarlo — no
    // basta con resucitar esta llamada.

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

    /**
     * El estado PÚBLICO de una sesión, el mismo que ve quien abre el enlace. La
     * app lo consulta por una sola cosa: los **ánimos**, que los escriben los
     * seguidores y por tanto solo existen en el servidor.
     *
     * Sin autenticación a propósito: es el endpoint público, y usarlo tal cual
     * garantiza que la baliza ve exactamente lo mismo que sus seguidores.
     */
    suspend fun estadoPublico(id: String): JsonObject? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$baseUrl/api/track/$id").build()
            client.newCall(req).execute().use { resp ->
                if (!ok(resp.code)) return@use null
                resp.body?.string()?.let { json.parseToJsonElement(it).jsonObject }
            }
        }.getOrNull()
    }

    /**
     * Deja pasar al backend una petición del visor incrustado tal cual, y
     * devuelve el cuerpo con su tipo. **Bloqueante** a propósito: la usa el
     * interceptor del WebView, que ya corre fuera del hilo principal y necesita
     * contestar en el mismo instante.
     *
     * Existe para los ánimos: los escriben quienes siguen la ruta, así que viven
     * en el servidor y no hay forma de fabricarlos en local. Es la única cosa
     * del visor que de verdad necesita cobertura.
     */
    fun pasarelaBloqueante(
        rutaConConsulta: String,
        metodo: String,
        token: String?,
    ): Pair<ByteArray, String>? = runCatching {
        val cuerpo: RequestBody? =
            if (metodo == "POST" || metodo == "PUT") ByteArray(0).toRequestBody(JSON_MEDIA) else null
        val req = Request.Builder()
            .url("$baseUrl/$rutaConConsulta")
            .method(metodo, cuerpo)
            .header("X-Auth-Mode", "token")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
        client.newCall(req).execute().use { resp ->
            if (!ok(resp.code)) return null
            val tipo = resp.header("Content-Type") ?: "application/json"
            (resp.body?.bytes() ?: ByteArray(0)) to tipo.substringBefore(';').trim()
        }
    }.getOrNull()

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

    /**
     * Los bytes gzip de un recorrido COMPARTIDO (`/api/share/:id`).
     *
     * Es el camino para el recorrido de un evento, que no es una previsión
     * propia y por tanto no vive en `/api/plans`. Público: va sin sesión.
     */
    suspend fun fetchSharePayload(shareId: String): ByteArray = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$baseUrl/api/share/$shareId").build()
        try {
            client.newCall(req).execute().use { resp ->
                if (!ok(resp.code)) throw ApiException(resp.code, "not_found")
                resp.body?.bytes() ?: ByteArray(0)
            }
        } catch (e: IOException) {
            throw ApiException(0, "network")
        }
    }

    // ── Eventos ──────────────────────────────────────────────────────────────

    /** Los eventos en los que participo. Al mejor esfuerzo desde la interfaz:
     *  sin eventos, la baliza funciona exactamente como siempre. */
    suspend fun listEvents(token: String): List<EventSummary> {
        val (body, status) = request("api/events", "GET", token)
        if (!ok(status)) throw decodeError(body, status)
        return decode<EventsWrapper>(body).events
    }

    /**
     * Une (o saca) del evento la baliza que YA se está emitiendo.
     *
     * Es el camino para quien se acuerda a mitad de carrera, que es lo normal:
     * no obliga a parar y volver a empezar, que partiría la traza en dos.
     */
    suspend fun attachBeacon(token: String, eventId: String, attach: Boolean) {
        val (body, status) = request(
            "api/events/$eventId/beacon", "POST", token,
            buildJsonObject { put("attach", JsonPrimitive(attach)) },
        )
        if (!ok(status)) throw decodeError(body, status)
    }

    suspend fun createTrack(
        token: String,
        title: String? = null,
        planId: String? = null,
        startAt: Double? = null,
        activity: BeaconActivity? = null,
        eventId: String? = null,
        device: String? = null,
    ): CreateTrackResponse {
        val (body, status) = request(
            "api/track", "POST", token,
            buildJsonObject {
                if (!title.isNullOrEmpty()) put("title", JsonPrimitive(title))
                if (planId != null) put("planId", JsonPrimitive(planId))
                if (startAt != null) put("startAt", JsonPrimitive(startAt))
                if (activity != null) put("activity", JsonPrimitive(activity.wire))
                // Evento al que se atribuye la salida. El servidor exige ser
                // miembro; si no lo eres nace suelta en vez de fallar, que lo
                // importante es salir a correr.
                if (eventId != null) put("eventId", JsonPrimitive(eventId))
                // De qué aparato sale. Solo se usa para que el móvil al que le
                // quitemos la baliza pueda decir quién se la quitó.
                if (!device.isNullOrEmpty()) put("device", JsonPrimitive(device))
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

    /**
     * El factor de forma que confirma quien camina: 1 = va como el plan, 1,2 =
     * un 20 % más lento. Los seguidores lo necesitan para que las predicciones
     * de llegada dejen de mentir cuando el día se tuerce.
     *
     * Va en la query y no en el cuerpo porque así lo emite el visor web, que es
     * quien lo dispara (el interceptor no recibe cuerpos POST).
     */
    suspend fun setForm(token: String, id: String, factor: Double, km: Double? = null) {
        val consulta = buildString {
            append("factor=$factor")
            km?.let { append("&km=$it") }
        }
        runCatching { request("api/track/$id/form?$consulta", "POST", token) }
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
