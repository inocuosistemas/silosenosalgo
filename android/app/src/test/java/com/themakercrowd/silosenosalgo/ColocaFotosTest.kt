package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.TimeZone

/** Espejo de `FotosEnRutaTests` en iOS: los mismos casos, los mismos números. */
class ColocaFotosTest {
    private val inicio = 1_790_000_000_000.0
    private val traza = (0..60).map { TrailPoint(inicio + it * 60_000.0, 42.0 + it * 0.001, 1.0, 5) }
    private val acum = ColocaFotos.acumulado(traza)

    @Test fun porLaHoraCaeEntreLosDosPuntos() {
        val s = ColocaFotos.porHora(inicio + 10.5 * 60_000, traza, acum)!!
        assertEquals(42.0105, s.lat, 1e-6)
        assertEquals(acum[10] + (acum[11] - acum[10]) / 2, s.distM, 0.01)
        assertEquals(ColocaFotos.Modo.POR_HORA, s.modo)
    }

    @Test fun antesDeSalirVaAlPrincipioYMuchoAntesNoVa() {
        val s = ColocaFotos.porHora(inicio - 5 * 60_000, traza, acum)!!
        assertEquals(0.0, s.distM, 0.0)
        assertNull(ColocaFotos.porHora(inicio - 3_600_000, traza, acum))
        assertNull(ColocaFotos.porHora(inicio + 3 * 3_600_000, traza, acum))
    }

    @Test fun conHoraYGpsDeAcuerdoMandaLaHora() {
        val s = ColocaFotos.coloca(inicio + 20 * 60_000, 42.0201 to 1.0005, traza, acum)!!
        assertEquals(ColocaFotos.Modo.POR_HORA, s.modo)
        assertEquals(42.02, s.lat, 1e-9)
    }

    @Test fun siElGpsEstaLejosDeLaHoraMandaElGps() {
        val s = ColocaFotos.coloca(inicio + 5 * 60_000, 42.05 to 1.0, traza, acum)!!
        assertEquals(ColocaFotos.Modo.POR_GPS, s.modo)
        assertEquals(acum[50], s.distM, 0.01)
        assertEquals(traza[50].t, s.t, 0.0)
    }

    @Test fun sinHoraDentroSeUsaElGps() {
        val s = ColocaFotos.coloca(inicio - 86_400_000, 42.0302 to 1.0, traza, acum)!!
        assertEquals(ColocaFotos.Modo.POR_GPS, s.modo)
        assertEquals(42.0302, s.lat, 1e-9)
        assertEquals(acum[30], s.distM, 0.01)
    }

    @Test fun sinNadaNoSeColoca() {
        assertNull(ColocaFotos.coloca(null, null, traza, acum))
    }

    @Test fun aManoSePegaAlTrazado() {
        val s = ColocaFotos.aMano(42.0403, 1.002, traza, acum)!!
        assertEquals(traza[40].lat, s.lat, 0.0)
        assertEquals(1.0, s.lon, 0.0)
        assertEquals(ColocaFotos.Modo.A_MANO, s.modo)
    }

    @Test fun losMetrosNoSumanElTembleoParado() {
        val quieto = (0 until 5).map { TrailPoint(it * 1000.0, 42 + it * 0.00001, 1.0, 20) }
        assertEquals(0.0, ColocaFotos.acumulado(quieto).last(), 0.001)
        assertEquals(TrackingRules.distanciaTraza(traza), acum.last(), 0.01)
    }

    @Test fun lasYaAnadidasSeReconocen() {
        val m = 60_000.0
        val fotos = listOf("a" to 0.0, "b" to 10 * m, "c" to 20 * m, "d" to 20 * m + 30_000, "e" to 40 * m, "f" to 50 * m)
        val notas = listOf(
            10 * m + 400 to null,          // añadida por la hora
            33 * m to 40 * m,              // añadida por el GPS: fixAt es la hora de la foto
            21 * m + 20_000 to null,       // hecha en marcha: la última antes de guardarla, «d»
            70 * m to null,                // sin foto reciente: nada
        )
        assertEquals(setOf("b", "e", "d"), ColocaFotos.yaAnadidas(fotos, notas))
    }

    @Test fun laFechaDelExifConYSinDesfase() {
        val con = ColocaFotos.fechaExif("2026:09:20 10:42:07", "+02:00")!!
        assertEquals(1_789_893_727_000.0, con, 0.5)
        val sin = ColocaFotos.fechaExif("2026:09:20 10:42:07", null, TimeZone.getTimeZone("Europe/Madrid"))!!
        assertEquals(con, sin, 0.0)
        assertNull(ColocaFotos.fechaExif("ayer", null))
    }
}
