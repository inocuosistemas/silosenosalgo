package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Las reglas del viaje, las mismas que en iOS (ver `ReglasDeViajeTests`). */
class ReglasDeViajeTest {
    private val bcn = LugarDeViaje("Barcelona", "BCN", 41.3874, 2.1686)
    private val and = LugarDeViaje("Andorra la Vella", "AND", 42.5063, 1.5218)
    private val fatih = LugarDeViaje("Fatih", "HTL", 41.0186, 28.9497)
    private val ist = LugarDeViaje("Istanbul Airport", "IST", 41.2753, 28.7519)

    @Test fun `la distancia en linea recta`() {
        assertEquals(135.0, ReglasDeViaje.km(bcn.lat, bcn.lon, and.lat, and.lon), 3.0)
    }

    @Test fun `el radio de llegada`() {
        assertEquals(2.0, ReglasDeViaje.radioDeLlegada(3000.0), 1e-9)
        assertEquals(0.1, ReglasDeViaje.radioDeLlegada(3.0), 1e-9)
        // Estambul: 44 km y GPS fino, 100 m; y no los 880 m del 2 %.
        assertEquals(0.1, ReglasDeViaje.radioDeLlegada(44.0, 22.0, TransporteDeViaje.COCHE), 1e-9)
        assertEquals(0.88, ReglasDeViaje.radioDeLlegada(44.0, 2000.0, TransporteDeViaje.COCHE), 1e-9)
        assertEquals(2.0, ReglasDeViaje.radioDeLlegada(3000.0, 10.0, TransporteDeViaje.AVION), 1e-9)
    }

    @Test fun `la llegada a la velocidad de ahora`() {
        assertEquals(3_600_000.0, ReglasDeViaje.llegada(90.0, 25.0, 0.0)!!, 1.0)
        assertNull(ReglasDeViaje.llegada(90.0, 0.5, 0.0))
        assertNull(ReglasDeViaje.llegada(3000.0, 8.0, 0.0))   // más de un día: rodando por la pista
    }

    @Test fun `parado cerca del destino cuenta como llegado`() {
        val v = Viaje(origen = ist, destino = fatih, transporte = TransporteDeViaje.COCHE, paradaMin = 5)
        val norte = 400.0 / 111_195
        var p: ReglasDeViaje.Parada? = null
        for (t in 0..4) p = ReglasDeViaje.parada(p, fatih.lat + norte, fatih.lon, 10.0, t * 60_000.0, v)
        assertFalse(ReglasDeViaje.llegadoPorParada(p, 4 * 60_000.0, 5))
        p = ReglasDeViaje.parada(p, fatih.lat + norte, fatih.lon, 10.0, 5 * 60_000.0, v)
        assertTrue(ReglasDeViaje.llegadoPorParada(p, 5 * 60_000.0, 5))
        // Lejos del destino, nunca; y con «nunca», tampoco.
        assertNull(ReglasDeViaje.parada(null, fatih.lat + 5000.0 / 111_195, fatih.lon, 10.0, 0.0, v))
        assertNull(ReglasDeViaje.parada(null, fatih.lat, fatih.lon, 10.0, 0.0, v.copy(paradaMin = 0)))
    }

    @Test fun `la precision admitida crece con el viaje`() {
        assertEquals(1000.0, ReglasDeViaje.precisionAdmitida(50.0), 1e-9)
        assertEquals(20_000.0, ReglasDeViaje.precisionAdmitida(2000.0), 1e-9)
    }
}
