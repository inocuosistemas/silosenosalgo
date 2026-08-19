package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La geometría del mapa descargado por adelantado.
 *
 * Un fallo aquí es de los caros: no se ve en el sofá —el mapa parece completo— y
 * se descubre en mitad del monte, con un hueco justo donde hacía falta y sin
 * cobertura para taparlo. Por eso se prueba cada regla por separado en vez de
 * fiarlo a mirar el mapa por encima.
 */
class TileMathTest {

    @Test fun `el mundo entero cabe en una tesela en el zoom cero`() {
        assertEquals(0 to 0, TileMath.teselaDe(41.4, 2.2, 0))
        assertEquals(0 to 0, TileMath.teselaDe(-33.9, 151.2, 0))
    }

    @Test fun `el origen de coordenadas cae en el cruce de los cuatro cuadrantes`() {
        // A z=1 el mundo son 2x2 teselas y (0,0) es la esquina de las cuatro.
        assertEquals(1 to 1, TileMath.teselaDe(0.0, 0.0, 1))
        // Hemisferio noroeste → cuadrante (0,0).
        assertEquals(0 to 0, TileMath.teselaDe(45.0, -90.0, 1))
    }

    @Test fun `una tesela conocida cuadra con la del visor`() {
        // Barcelona a z=15: el mismo cuadro que pide Leaflet para esas
        // coordenadas. Si esto cambia, la app descargaría teselas distintas de
        // las que el mapa acaba pidiendo, y se bajaría el mapa para nada.
        val (x, y) = TileMath.teselaDe(41.3874, 2.1686, 15)
        assertEquals(16581, x)
        assertEquals(12238, y)
    }

    @Test fun `las teselas se hacen mas pequenas al acercarse`() {
        val z10 = TileMath.metrosPorTesela(41.4, 10)
        val z15 = TileMath.metrosPorTesela(41.4, 15)
        assertTrue(z15 < z10)
        // Cada nivel divide por dos: cinco niveles son un factor 32.
        assertEquals(32.0, z10 / z15, 0.001)
    }

    @Test fun `y mas pequenas cuanto mas al norte`() {
        // Mercator: a la misma z, una tesela cubre menos metros cerca del polo.
        assertTrue(TileMath.metrosPorTesela(60.0, 12) < TileMath.metrosPorTesela(0.0, 12))
    }

    // ── Proyección y cajas ───────────────────────────────────────────────────

    @Test fun `la proyeccion pone el origen arriba a la izquierda`() {
        val (x, y) = TileMath.proyecta(0.0, 0.0)
        assertEquals(0.5, x, 0.0001)
        assertEquals(0.5, y, 0.0001)
        // Más al norte = más arriba (y menor). Si se invierte, el mapa dibujado
        // sale del revés y nadie reconoce su propia ruta.
        assertTrue(TileMath.proyecta(45.0, 0.0).second < 0.5)
    }

    @Test fun `la esquina de una tesela deshace su calculo`() {
        val z = 12
        val (x, y) = TileMath.teselaDe(42.3737, -7.4149, z)
        val (lat, lon) = TileMath.esquinaNoroeste(z, x, y)
        // La esquina noroeste queda al norte y al oeste del punto original.
        assertTrue(lat >= 42.3737)
        assertTrue(lon <= -7.4149)
        assertEquals(x to y, TileMath.teselaDe(lat - 0.0001, lon + 0.0001, z))
    }

    @Test fun `una caja geografica trae todas sus teselas`() {
        val teselas = TileMath.teselasEnCaja(42.30, -7.50, 42.40, -7.30, 12)
        assertTrue(teselas.isNotEmpty())
        // La tesela del centro de la caja tiene que estar.
        val (cx, cy) = TileMath.teselaDe(42.35, -7.40, 12)
        assertTrue(teselas.contains(TileMath.Tesela(12, cx, cy)))
        // Y las de las dos esquinas opuestas también.
        val (x1, y1) = TileMath.teselaDe(42.40, -7.50, 12)
        val (x2, y2) = TileMath.teselaDe(42.30, -7.30, 12)
        assertTrue(teselas.contains(TileMath.Tesela(12, x1, y1)))
        assertTrue(teselas.contains(TileMath.Tesela(12, x2, y2)))
    }

    @Test fun `la cobertura no se dibuja a un zoom que lo pinte todo`() {
        // Caso REAL: con z12 fijo, una ruta corta cabia entera en una tesela de
        // ~10 km, asi que en cuanto habia algo descargado la capa salia TODA
        // verde. Los datos eran correctos y la respuesta, inutil.
        // Ruta de ~2 km: el zoom elegido tiene que ser el fino que se pidio.
        val z = TileMath.zoomDeCobertura(42.370, -7.420, 42.385, -7.400, zoomPedido = 15)
        assertEquals(15, z)
    }

    @Test fun `una ruta enorme baja el zoom para no comprobar miles de teselas`() {
        // 161 km a z16 serian cientos de miles de comprobaciones por cada
        // redibujado.
        val z = TileMath.zoomDeCobertura(42.0, -8.0, 43.5, -6.0, zoomPedido = 16)
        assertTrue("zoom elegido $z", z < 16)
        val teselas = TileMath.teselasEnCaja(42.0, -8.0, 43.5, -6.0, z)
        assertTrue("serian ${teselas.size} teselas", teselas.size <= 2_000)
    }

    @Test fun `nunca sube por encima del detalle descargado`() {
        // Enseñar cobertura a un zoom que no se ha bajado diria que falta mapa
        // cuando en realidad no se pidio ese detalle.
        val z = TileMath.zoomDeCobertura(42.370, -7.420, 42.371, -7.419, zoomPedido = 13)
        assertEquals(13, z)
    }

    // ── El corredor ──────────────────────────────────────────────────────────

    private val puntoEnGalicia = 42.3737 to -7.4149

    @Test fun `un punto suelto trae su tesela y las de alrededor`() {
        val teselas = TileMath.teselasDelCorredor(listOf(puntoEnGalicia), 300.0, 14, 14)
        val (x, y) = TileMath.teselaDe(puntoEnGalicia.first, puntoEnGalicia.second, 14)
        assertTrue(teselas.contains(TileMath.Tesela(14, x, y)))
        // Un corredor SIEMPRE trae vecinas: si no, al desviarte un metro del
        // trazado te quedas sin mapa.
        assertTrue(teselas.size > 1)
    }

    @Test fun `un corredor mas ancho trae mas teselas`() {
        val estrecho = TileMath.teselasDelCorredor(listOf(puntoEnGalicia), 200.0, 15, 15)
        val ancho = TileMath.teselasDelCorredor(listOf(puntoEnGalicia), 2000.0, 15, 15)
        assertTrue(ancho.size > estrecho.size)
    }

    @Test fun `los zooms gruesos salen completos de los padres`() {
        val teselas = TileMath.teselasDelCorredor(listOf(puntoEnGalicia), 500.0, 12, 15)
        // Cada nivel tiene que estar representado: un nivel vacío se ve como un
        // mapa en blanco justo al alejar el zoom.
        for (z in 12..15) {
            assertTrue("falta el zoom $z", teselas.any { it.z == z })
        }
        // Y el padre de cada tesela fina tiene que estar presente.
        val finas = teselas.filter { it.z == 15 }
        for (t in finas) {
            assertTrue(
                "falta el padre de $t",
                teselas.contains(TileMath.Tesela(14, t.x shr 1, t.y shr 1)),
            )
        }
    }

    @Test fun `un tramo largo se densifica y no deja huecos`() {
        // Dos puntos a ~11 km. Sin densificar solo saldrían los extremos y el
        // mapa quedaría a trozos justo en las rectas largas.
        val ruta = listOf(42.30 to -7.40, 42.40 to -7.40)
        val teselas = TileMath.teselasDelCorredor(ruta, 300.0, 14, 14)

        // Un punto intermedio tiene que estar cubierto.
        val (mx, my) = TileMath.teselaDe(42.35, -7.40, 14)
        assertTrue(teselas.contains(TileMath.Tesela(14, mx, my)))

        // Y la columna de teselas entre los dos extremos tiene que ser continua.
        val (_, y1) = TileMath.teselaDe(42.30, -7.40, 14)
        val (_, y2) = TileMath.teselaDe(42.40, -7.40, 14)
        for (y in minOf(y1, y2)..maxOf(y1, y2)) {
            assertTrue("hueco en la fila $y", teselas.any { it.z == 14 && it.y == y })
        }
    }

    @Test fun `nunca se devuelven teselas fuera del mundo`() {
        // Junto al antimeridiano y cerca del polo, ensanchar el corredor se sale
        // de la rejilla; esas coordenadas darían 404 y llenarían la caché de
        // marcadores.
        val teselas = TileMath.teselasDelCorredor(listOf(84.0 to 179.9), 5000.0, 8, 12)
        for (t in teselas) {
            val lado = 1 shl t.z
            assertTrue("$t se sale del mundo", t.x in 0 until lado && t.y in 0 until lado)
        }
    }

    @Test fun `una ruta vacia no descarga nada`() {
        assertTrue(TileMath.teselasDelCorredor(emptyList(), 300.0, 12, 15).isEmpty())
    }

    @Test fun `un rango de zoom al reves no descarga nada`() {
        assertTrue(TileMath.teselasDelCorredor(listOf(puntoEnGalicia), 300.0, 15, 12).isEmpty())
    }

    @Test fun `el tamano estimado avisa antes de gastar datos`() {
        // 1000 teselas ≈ 20 MB: es la cifra que se le enseña a alguien antes de
        // dejarle darle a descargar con datos móviles.
        assertEquals(20_000_000L, TileMath.bytesEstimados(1000))
    }
}
