package com.themakercrowd.silosenosalgo

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * El contrato con el backend, blindado.
 *
 * Estos modelos son un espejo escrito a mano de `/shared/wireTypes.ts` y de
 * `ios/Sources/API.swift`: nada impide que se desvíen salvo estas pruebas. Los
 * JSON de aquí son la forma REAL que sirve el backend.
 */
class WireTypesTest {

    private val json = Api.json

    @Test
    fun `una sesion completa se decodifica entera`() {
        val cuerpo = """
            {"id":"abc123","title":"Subida al Xistral","planName":"Xistral norte",
             "status":"active","startedAt":1755500000000,"expiresAt":1755600000000,
             "updatedAt":1755500600000,"endedAt":null,"pinned":true,"activity":"bike"}
        """.trimIndent()
        val s = json.decodeFromString<TrackSessionSummary>(cuerpo)
        assertEquals("abc123", s.id)
        assertEquals("Subida al Xistral", s.title)
        assertEquals(BeaconActivity.BIKE, s.activity)
        assertTrue(s.isActive)
        assertEquals(true, s.pinned)
        // Epoch en MILISEGUNDOS: si alguien los pasara a segundos, esto canta.
        assertTrue(s.startedAt > 1_000_000_000_000.0)
    }

    @Test
    fun `una sesion de un servidor antiguo, sin campos nuevos, no revienta`() {
        // Un backend viejo no manda pinned/activity/updatedAt/endedAt. El cliente
        // nuevo tiene que tragarlo: es exactamente el caso de una app publicada
        // antes de un despliegue del servidor.
        val cuerpo = """
            {"id":"x","status":"ended","startedAt":1,"expiresAt":2}
        """.trimIndent()
        val s = json.decodeFromString<TrackSessionSummary>(cuerpo)
        assertNull(s.pinned)
        assertNull(s.activity)
        assertNull(s.title)
        assertTrue(!s.isActive)
    }

    @Test
    fun `campos desconocidos de un servidor mas nuevo se ignoran`() {
        val cuerpo = """
            {"id":"x","status":"active","startedAt":1,"expiresAt":2,"campoDelFuturo":42}
        """.trimIndent()
        val s = json.decodeFromString<TrackSessionSummary>(cuerpo)
        assertEquals("x", s.id)
    }

    @Test
    fun `la actividad viaja con el mismo texto que en iOS y la web`() {
        assertEquals("walk", BeaconActivity.WALK.wire)
        assertEquals("run", BeaconActivity.RUN.wire)
        assertEquals("bike", BeaconActivity.BIKE.wire)
        assertEquals("transport", BeaconActivity.TRANSPORT.wire)
        assertEquals(BeaconActivity.RUN, BeaconActivity.fromWire("run"))
        // Un valor que este cliente no conoce no puede tumbarlo.
        assertNull(BeaconActivity.fromWire("teleport"))
        assertNull(BeaconActivity.fromWire(null))
    }

    @Test
    fun `las velocidades maximas son las de ACTIVITY_MAX_SPEED_KMH`() {
        // Gobiernan qué saltos del GPS se descartan por imposibles: si se
        // desvían de la web, cada cliente pintaría una traza distinta.
        assertEquals(12.0, BeaconActivity.WALK.maxSpeedKmh, 0.0)
        assertEquals(25.0, BeaconActivity.RUN.maxSpeedKmh, 0.0)
        assertEquals(80.0, BeaconActivity.BIKE.maxSpeedKmh, 0.0)
        assertEquals(200.0, BeaconActivity.TRANSPORT.maxSpeedKmh, 0.0)
    }

    @Test
    fun `el login devuelve usuario y token`() {
        val r = json.decodeFromString<AuthResponse>(
            """{"user":{"id":"u1","username":"jm"},"token":"tok_123"}""",
        )
        assertEquals("jm", r.user.username)
        assertEquals("tok_123", r.token)
    }

    @Test
    fun `me sin sesion devuelve usuario nulo, no un error de formato`() {
        assertNull(json.decodeFromString<MeResponse>("""{"user":null}""").user)
        assertNull(json.decodeFromString<MeResponse>("""{}""").user)
    }

    @Test
    fun `el ping de un servidor antiguo sin cuerpo deja los espectadores en nulo`() {
        assertNull(json.decodeFromString<PingResponse>("""{}""").viewers)
        assertEquals(3, json.decodeFromString<PingResponse>("""{"viewers":3}""").viewers)
    }

    @Test
    fun `una nota conserva las claves que espera el visor web`() {
        val nota = Note(
            id = "n1", createdAt = 1755500000000.0, fixAt = 1755499999000.0,
            lat = 43.1, lon = -7.5, accuracy = 8.0, altitude = 900.0,
            trackKm = 4.2, distM = 12.0, title = "Fuente", body = "Agua buena",
            poiType = "water", poiSym = "💧", audioKey = null, photoKey = null,
        )
        val texto = json.encodeToString(Note.serializer(), nota)
        // explicitNulls=false: los nulos NO viajan (el visor y el backend
        // distinguen ausente de null).
        assertTrue(!texto.contains("audioKey"))
        assertTrue(texto.contains("\"poiType\":\"water\""))
        val vuelta = json.decodeFromString<Note>(texto)
        assertEquals(nota, vuelta)
    }

    @Test
    fun `la traza local usa las claves cortas del servidor`() {
        val p = json.decodeFromString<TrailPoint>("""{"t":1755500000000,"lat":43.1,"lon":-7.5,"a":9}""")
        assertEquals(9, p.a)
        assertEquals(43.1, p.lat, 0.0)
        // Sin precisión conocida, el campo simplemente no está.
        assertNull(json.decodeFromString<TrailPoint>("""{"t":1,"lat":0,"lon":0}""").a)
    }

    @Test
    fun `el almacenamiento llega en bytes y cabe en Long`() {
        val s = json.decodeFromString<StorageInfo>("""{"usedBytes":523456789,"quotaBytes":2147483648}""")
        assertEquals(523456789L, s.usedBytes)
        assertEquals(2147483648L, s.quotaBytes)   // > Int.MAX_VALUE: por eso es Long
    }

    @Test
    fun `los mensajes de error son los mismos que muestra iOS`() {
        assertEquals("Usuario o contraseña incorrectos.", ApiException(401, "invalid_credentials").message)
        assertEquals("Sesión caducada. Inicia sesión de nuevo.", ApiException(401, "unauthorized").message)
        assertEquals("No se pudo conectar con el servidor.", ApiException(0, "network").message)
        assertEquals("Error (500): http_500", ApiException(500, "http_500").message)
    }

    @Test
    fun `el enlace publico nunca sale por pages punto dev`() {
        val enlace = Config.shareLink("tok_abc")
        assertEquals("https://silosenosalgo.themakercrowd.com/?t=tok_abc", enlace)
        assertTrue(!enlace.contains("pages.dev"))
    }
}
