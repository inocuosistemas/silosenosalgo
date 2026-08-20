package com.themakercrowd.silosenosalgo

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Cómo habla el cliente: cabeceras, rutas, y sobre todo QUÉ campos manda.
 *
 * Se prueba contra un servidor de mentira (MockWebServer) porque lo que hay que
 * fijar es la forma de la petición: el backend real ya se comprueba aparte con
 * el test de humo.
 */
class ApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun arranca() {
        server = MockWebServer()
        server.start()
        api = Api(baseUrl = server.url("/").toString().trimEnd('/'))
    }

    @After fun para() { server.shutdown() }

    @Test fun `toda peticion lleva X-Auth-Mode token y el Bearer cuando hay sesion`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"sessions":[]}"""))
        api.listSessions("tok_1")
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/track", req.path)
        // Sin esta cabecera el backend contestaría en modo cookie, inservible
        // para una app nativa.
        assertEquals("token", req.getHeader("X-Auth-Mode"))
        assertEquals("Bearer tok_1", req.getHeader("Authorization"))
    }

    @Test fun `el login va sin Authorization y con las credenciales en el cuerpo`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"user":{"id":"u","username":"jm"},"token":"t"}"""))
        val r = api.login("jm", "secreta")
        val req = server.takeRequest()
        assertEquals("/api/auth/login", req.path)
        assertNull(req.getHeader("Authorization"))
        val cuerpo = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("jm", cuerpo["username"]?.jsonPrimitive?.content)
        assertEquals("secreta", cuerpo["password"]?.jsonPrimitive?.content)
        assertEquals("t", r.token)
    }

    @Test fun `crear sesion OMITE lo que no se sabe en vez de mandar nulos`() = runBlocking {
        // El backend distingue "no lo sé" de "ponlo a null": mandar nulls
        // borraría la actividad o el plan en vez de dejarlos como estaban.
        server.enqueue(MockResponse().setBody("""{"id":"s1","expiresAt":123}"""))
        api.createTrack("tok", title = "Ruta", planId = null, startAt = null, activity = null)
        val cuerpo = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(setOf("title"), cuerpo.keys)
    }

    @Test fun `crear sesion con todo manda la actividad como texto del cable`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":"s1","expiresAt":123}"""))
        api.createTrack("tok", title = "R", planId = "p1", startAt = 1755.0, activity = BeaconActivity.BIKE)
        val cuerpo = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("bike", cuerpo["activity"]?.jsonPrimitive?.content)
        assertEquals("p1", cuerpo["planId"]?.jsonPrimitive?.content)
    }

    @Test fun `un ping solo manda los datos que trae la posicion`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        api.ping("tok", "s1", Fix(lat = 43.1, lon = -7.5, accuracy = 8.0))
        val req = server.takeRequest()
        assertEquals("/api/track/s1/ping", req.path)
        val cuerpo = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals(setOf("lat", "lon", "accuracy"), cuerpo.keys)
    }

    @Test fun `el envio por lotes agrupa las posiciones bajo fixes`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"viewers":2}"""))
        val n = api.pingBatch("tok", "s1", listOf(
            Fix(lat = 1.0, lon = 2.0, fixAt = 100.0),
            Fix(lat = 3.0, lon = 4.0, fixAt = 200.0),
        ))
        assertEquals(2, n)
        val cuerpo = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(2, cuerpo["fixes"]!!.jsonArray.size)
    }

    @Test fun `un lote contra servidor antiguo sin cuerpo no es un error`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        assertNull(api.pingBatch("tok", "s1", listOf(Fix(lat = 1.0, lon = 2.0))))
    }

    @Test fun `la nota lleva su id de cliente para que reintentar sea idempotente`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        api.createNote("tok", "s1", Note(
            id = "n-uuid", createdAt = 10.0, lat = 1.0, lon = 2.0, poiType = "water",
        ))
        val cuerpo = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("n-uuid", cuerpo["id"]?.jsonPrimitive?.content)
        assertEquals("water", cuerpo["poiType"]?.jsonPrimitive?.content)
    }

    @Test fun `el medio de una nota sube crudo con su tipo y su kind`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200))
        api.uploadNoteMedia("tok", "s1", "n1", "photo", byteArrayOf(1, 2, 3), "image/jpeg")
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/track/s1/notes/n1/media?kind=photo", req.path)
        assertTrue(req.getHeader("Content-Type")!!.startsWith("image/jpeg"))
        assertEquals(3, req.bodySize)
    }

    @Test fun `actividad automatica se manda como cadena vacia, no como null`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200))
        api.setActivity("tok", "s1", null)
        val cuerpo = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("", cuerpo["activity"]?.jsonPrimitive?.content)
    }

    @Test fun `un error del backend llega con su codigo y su mensaje en castellano`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid_credentials"}"""))
        try {
            api.login("jm", "mal")
            fail("tenía que lanzar")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
            assertEquals("invalid_credentials", e.code)
            assertEquals("Usuario o contraseña incorrectos.", e.message)
        }
    }

    @Test fun `un error sin cuerpo JSON no se traga el estado`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>bad gateway</html>"))
        try {
            api.listSessions("tok")
            fail("tenía que lanzar")
        } catch (e: ApiException) {
            assertEquals(502, e.status)
            assertEquals("http_502", e.code)
        }
    }

    @Test fun `las operaciones de cortesia no lanzan aunque el servidor falle`() = runBlocking {
        // end/delete/pin/rename se llaman al salir o en segundo plano: un fallo
        // ahí no puede tumbar la app ni dejar un diálogo colgado.
        repeat(4) { server.enqueue(MockResponse().setResponseCode(500)) }
        api.end("tok", "s1")
        api.deleteSession("tok", "s1")
        api.setPinned("tok", "s1", true)
        api.rename("tok", "s1", "otro")
    }
}
