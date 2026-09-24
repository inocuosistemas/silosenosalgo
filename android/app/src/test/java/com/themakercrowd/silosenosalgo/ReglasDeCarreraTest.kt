package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Las reglas del tramo, las mismas cuentas que en iOS (ver `ReglasDeCarreraTests`). */
class ReglasDeCarreraTest {
    private val salida = 1_800_000_000_000.0
    private val hoja = HojaDeEjemplo.hoja(salida)

    @Test fun `el tramo va del ultimo punto pasado al siguiente`() {
        val t = ReglasDeCarrera.tramo(7.0, hoja)!!
        assertEquals(2, t.numero)
        assertEquals("Font del Gel", t.desde.nombre)
        assertEquals("Coll de Pal", t.hasta.nombre)
        val primero = ReglasDeCarrera.tramo(0.0, hoja)!!
        assertEquals("Salida", primero.desde.nombre)
        // A menos de 50 m del punto ya se da por llegado: el GPS no clava el
        // metro, y el tramo siguiente es el que interesa (como en iOS).
        assertEquals(2, ReglasDeCarrera.tramo(9.40, hoja)!!.numero)
        assertEquals(3, ReglasDeCarrera.tramo(9.48, hoja)!!.numero)
    }

    @Test fun `el desnivel no cuenta el ruido`() {
        val llano = hoja.copy(perfil = (0..100).map { HojaDeTramos.Muestra(it * 0.1, 100.0 + (it % 2) * 2.0) })
        assertEquals(0 to 0, ReglasDeCarrera.desnivel(0.0, 10.0, llano))
        val (sube, _) = ReglasDeCarrera.desnivel(0.0, 9.5, hoja)
        assertTrue("sube unos 760 m hasta el Coll de Pal: $sube", sube in 650..900)
    }

    @Test fun `el previsto se interpola`() {
        val a = ReglasDeCarrera.previsto(10.0, hoja)!!
        val b = ReglasDeCarrera.previsto(10.25, hoja)!!
        val medio = ReglasDeCarrera.previsto(10.125, hoja)!!
        assertEquals((a + b) / 2, medio, 0.01)
    }

    @Test fun `sin historia bastante se va como el plan`() {
        assertEquals(1.0, ReglasDeCarrera.rendimiento(salida + 60_000, 0.1, emptyList(), hoja), 1e-9)
    }

    @Test fun `quien va mas lento que el plan llega mas tarde`() {
        // En 60 min reales, lo que el plan hacía en 40.
        val kmA = 2.0
        val minA = ReglasDeCarrera.previsto(kmA, hoja)!!
        val kmB = (0..420).map { it * 0.1 }.first { ReglasDeCarrera.previsto(it, hoja)!! - minA >= 40 }
        val ahora = salida + 90 * 60_000.0
        val historia = listOf((ahora - 60 * 60_000.0) to kmA, ahora to kmB)
        val r = ReglasDeCarrera.rendimiento(ahora, kmB, historia, hoja)
        assertEquals(1.5, r, 0.05)
    }

    @Test fun `los datos del tramo con corte y margen`() {
        val km = 7.0
        val ahora = salida + ReglasDeCarrera.previsto(km, hoja)!! * 60_000
        val d = ReglasDeCarrera.datos(km, ahora, emptyList(), hoja)!!
        assertEquals("Coll de Pal", d.hastaNombre)
        assertEquals(2.5, d.restanteKm, 1e-9)
        assertNotNull(d.corteMs)
        // Como el plan, con cortes al plan × 1,25: margen de sobra.
        assertTrue("margen ${d.margenMin}", d.margenMin!! > 10)
        assertEquals(ReglasDeCarrera.MUESTRAS_DEL_TRAMO, d.perfil.size)
    }

    @Test fun `en meta no hay corte`() {
        val d = ReglasDeCarrera.datos(41.9, salida + 6 * 3_600_000.0, emptyList(), hoja)!!
        assertTrue(d.enMeta)
        assertNull(d.corteMs)
    }

    @Test fun `la hoja de la web se lee`() {
        val texto = """{"version":1,"salida":1.8E12,"totalKm":10,"perfil":[{"km":0,"ele":100},{"km":10,"ele":200}],
            "previsto":[{"km":0,"min":0},{"km":10,"min":60}],"puntos":[{"nombre":"Meta","km":10,"tipo":"meta"}],"otra":1}"""
        val h = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromString(HojaDeTramos.serializer(), texto)
        assertEquals(1, h.puntos.size)
        assertNull(h.puntos[0].corte)
    }
}
