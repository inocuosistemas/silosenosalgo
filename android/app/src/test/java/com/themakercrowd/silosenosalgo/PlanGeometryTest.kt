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

    // ── Métricas de las notas sobre la ruta ──────────────────────────────────

    private fun punto(lat: Double, lon: Double, ele: Double) =
        PlanGeometry.PuntoPlan(lat, lon, ele)

    private fun nota(id: String, lat: Double, lon: Double) = Note(
        id = id, createdAt = 0.0, lat = lat, lon = lon, poiType = "water",
    )

    @Test fun `el desnivel ignora el ruido del altimetro`() {
        // Diez oscilaciones de 30 cm: sin histéresis sumarían 3 m de subida en
        // un tramo perfectamente llano, y una travesía entera se convertiría en
        // una etapa de montaña imaginaria.
        val ruido = (0 until 20).map { i ->
            punto(42.0 + i * 0.0001, -7.0, if (i % 2 == 0) 500.0 else 500.3)
        }
        assertEquals(0.0, PlanGeometry.desnivelAcumulado(ruido).last(), 0.001)
    }

    @Test fun `una subida de verdad si se acumula`() {
        val subida = (0 until 5).map { i -> punto(42.0 + i * 0.001, -7.0, 500.0 + i * 10) }
        assertEquals(40.0, PlanGeometry.desnivelAcumulado(subida).last(), 0.001)
    }

    @Test fun `las bajadas no restan del desnivel positivo`() {
        val puntos = listOf(
            punto(42.0, -7.0, 500.0),
            punto(42.001, -7.0, 600.0),
            punto(42.002, -7.0, 400.0),
        )
        assertEquals(100.0, PlanGeometry.desnivelAcumulado(puntos).last(), 0.001)
    }

    @Test fun `una nota se situa en el km del punto mas cercano de la ruta`() {
        // Ruta norte-sur; la nota cae al lado del tercer punto.
        val puntos = (0 until 5).map { i -> punto(42.0 + i * 0.01, -7.0, 500.0 + i * 20) }
        val m = PlanGeometry.metricasDeNotas(puntos, listOf(nota("n1", 42.0201, -7.0001)))
        val km = PlanGeometry.kmAcumulado(puntos)
        assertEquals(km[2], m["n1"]!!.kmDeRuta!!, 0.05)
        assertEquals(40.0, m["n1"]!!.desnivelPositivoM!!, 0.001)
    }

    @Test fun `sin plan la nota cae a su propio recorrido y sin desnivel`() {
        // No se inventa un kilometraje de ruta que no existe.
        val suelta = nota("n1", 42.0, -7.0).copy(distM = 2500.0)
        val m = PlanGeometry.metricasDeNotas(null, listOf(suelta))
        assertEquals(2.5, m["n1"]!!.kmDeRuta!!, 0.001)
        assertNull(m["n1"]!!.desnivelPositivoM)
    }

    @Test fun `un plan con algun punto sin altitud no da metricas a medias`() {
        // Mezclar puntos con y sin altitud daría un desnivel inventado.
        val mezclado = """
            {"track":{"points":[
              {"lat":42.0,"lon":-7.0,"ele":500},
              {"lat":42.1,"lon":-7.0}
            ]}}
        """.trimIndent()
        assertNull(PlanGeometry.puntosConAltitud(comprime(mezclado)))
    }

    @Test fun `una bomba de descompresion no se traga la memoria`() {
        // 64 MB de ceros comprimen a unos pocos KB. Sin el tope, un blob
        // manipulado dejaría la app sin memoria.
        val bomba = comprime("0".repeat(64 * 1024 * 1024))
        assertTrue(bomba.size < 1024 * 1024)
        assertNull(PlanGeometry.descomprime(bomba))
    }

    /**
     * Un CIRCUITO: sale y vuelve al mismo sitio. Al cruzar meta, el punto mas
     * cercano del trazado es el de la salida — proyectar por cercania a secas
     * devolveria el km 0 despues de recorrerlo entero, que es exactamente lo
     * que dejaba sin detectar el final de ruta.
     */
    @Test
    fun `proyecta sin saltar al principio en un circuito`() {
        // Cuadrado de ~1 km de lado que vuelve al origen.
        val puntos = listOf(
            PlanGeometry.PuntoPlan(42.000, -2.000, 0.0),
            PlanGeometry.PuntoPlan(42.009, -2.000, 0.0),
            PlanGeometry.PuntoPlan(42.009, -1.988, 0.0),
            PlanGeometry.PuntoPlan(42.000, -1.988, 0.0),
            PlanGeometry.PuntoPlan(42.000, -2.000, 0.0),
        )
        val kms = PlanGeometry.kmAcumulado(puntos)
        val total = kms.last()

        // Sin km previo, al principio: km 0.
        val salida = PlanGeometry.proyectaKm(puntos, kms, 42.000, -2.000, null)
        assertEquals(0.0, salida!!, 0.2)

        // Ya de vuelta en meta (misma coordenada que la salida) pero viniendo
        // del km anterior: tiene que dar el TOTAL, no cero.
        val meta = PlanGeometry.proyectaKm(puntos, kms, 42.000, -2.000, total - 0.3)
        assertEquals(total, meta!!, 0.3)
    }

    /** Lejos del recorrido no se inventa kilometro. */
    @Test
    fun `fuera de la ruta no devuelve kilometro`() {
        val puntos = listOf(
            PlanGeometry.PuntoPlan(42.000, -2.000, 0.0),
            PlanGeometry.PuntoPlan(42.010, -2.000, 0.0),
        )
        val kms = PlanGeometry.kmAcumulado(puntos)
        assertNull(PlanGeometry.proyectaKm(puntos, kms, 42.500, -2.500, null))
    }
}
