package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * La lectura de los planes guardados. Los blobs los genera el navegador con
 * `CompressionStream('gzip')` y viajan comprimidos de punta a punta, así que
 * esto es la frontera entre el mundo web y el móvil: si se lee mal, la app se
 * baja el mapa de otro sitio o no se lo baja.
 */
class PlanGeometryTest {

    private fun comprime(texto: String): ByteArray {
        val salida = ByteArrayOutputStream()
        GZIPOutputStream(salida).use { it.write(texto.toByteArray()) }
        return salida.toByteArray()
    }

    private val planDeEjemplo = """
        {
          "name": "Ruta del Sil",
          "track": {
            "points": [
              {"lat": 42.30, "lon": -7.40, "ele": 500},
              {"lat": 42.31, "lon": -7.41, "ele": 540},
              {"lat": 42.32, "lon": -7.42, "ele": 610}
            ]
          }
        }
    """.trimIndent()

    @Test fun `se lee el trazado de un plan comprimido`() {
        val ruta = PlanGeometry.trazado(comprime(planDeEjemplo))
        assertEquals(3, ruta!!.size)
        assertEquals(42.30, ruta.first().first, 0.0001)
        assertEquals(-7.42, ruta.last().second, 0.0001)
    }

    @Test fun `se lee el nombre para poder decir que se descarga`() {
        assertEquals("Ruta del Sil", PlanGeometry.nombre(comprime(planDeEjemplo)))
    }

    @Test fun `los puntos sin coordenadas se saltan, no rompen el plan`() {
        // Un plan real puede traer waypoints incompletos; perder uno es mejor
        // que quedarse sin poder descargar el mapa de toda la ruta.
        val conBasura = """
            {"track":{"points":[
              {"lat":42.3,"lon":-7.4},
              {"ele":500},
              {"lat":42.4,"lon":-7.5}
            ]}}
        """.trimIndent()
        val ruta = PlanGeometry.trazado(comprime(conBasura))
        assertEquals(2, ruta!!.size)
    }

    @Test fun `un blob que no es gzip no revienta`() {
        assertNull(PlanGeometry.trazado("esto no esta comprimido".toByteArray()))
        assertNull(PlanGeometry.trazado(ByteArray(0)))
    }

    @Test fun `un plan sin ruta no da un trazado vacio, da nulo`() {
        // Distinguirlo importa: vacío se descargaría como corredor de cero
        // teselas y parecería que funcionó; nulo dice que no hay nada que bajar.
        assertNull(PlanGeometry.trazado(comprime("""{"track":{"points":[]}}""")))
        assertNull(PlanGeometry.trazado(comprime("""{"name":"sin ruta"}""")))
    }

    @Test fun `sin plan se usa la traza ya recorrida`() {
        val recorrida = listOf(
            TrailPoint(t = 1.0, lat = 42.0, lon = -7.0),
            TrailPoint(t = 2.0, lat = 42.1, lon = -7.1),
        )
        val ruta = PlanGeometry.rutaParaDescargar(null, recorrida)
        assertEquals(2, ruta!!.size)
        assertEquals(42.0, ruta.first().first, 0.0001)
    }

    @Test fun `el plan tiene preferencia sobre lo ya recorrido`() {
        val planificada = listOf(41.0 to 2.0)
        val recorrida = listOf(TrailPoint(t = 1.0, lat = 42.0, lon = -7.0))
        assertEquals(planificada, PlanGeometry.rutaParaDescargar(planificada, recorrida))
    }

    @Test fun `sin plan y sin traza no hay nada que descargar`() {
        assertNull(PlanGeometry.rutaParaDescargar(null, emptyList()))
        assertNull(PlanGeometry.rutaParaDescargar(emptyList(), emptyList()))
    }

    @Test fun `una bomba de descompresion no se traga la memoria`() {
        // 64 MB de ceros comprimen a unos pocos KB. Sin el tope, un blob
        // manipulado dejaría la app sin memoria.
        val bomba = comprime("0".repeat(64 * 1024 * 1024))
        assertTrue(bomba.size < 1024 * 1024)
        assertNull(PlanGeometry.descomprime(bomba))
    }
}
