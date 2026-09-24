package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/** Las cuentas atrás: días, corte, anuales y cuáles se enseñan (como en iOS). */
class ContadoresTest {
    private val dia = 86_400_000.0
    private val ahora = 1_800_000_000_000.0

    @Test fun `los dias y el momento en que baja el numero`() {
        val c = Contador(nombre = "X", fechaMs = ahora + 3 * dia + 5 * 3_600_000.0)
        val (dias, corte) = c.diasYCorte(ahora)
        assertEquals(3, dias)
        assertEquals(ahora + 5 * 3_600_000.0, corte, 1.0)
    }

    @Test fun `un anual que ya paso cuenta hasta el del ano que viene`() {
        val cal = Calendar.getInstance().apply { timeInMillis = ahora.toLong(); add(Calendar.DAY_OF_YEAR, -10) }
        val c = Contador(nombre = "Cumple", fechaMs = cal.timeInMillis.toDouble(), anual = true)
        val f = c.fechaVigente(ahora)
        assertTrue(f > ahora)
        assertEquals(355.0, (f - ahora) / dia, 1.5)
    }

    @Test fun `al pasar se oculta o cuenta hacia arriba`() {
        val pasado = Contador(nombre = "X", fechaMs = ahora - dia)
        assertFalse(pasado.vigente(ahora))
        assertTrue(pasado.copy(alPasar = "contarArriba").vigente(ahora))
    }

    @Test fun `el mas cercano primero, sin los que ya pasaron`() {
        val a = Contador(nombre = "A", fechaMs = ahora + 10 * dia)
        val b = Contador(nombre = "B", fechaMs = ahora + 2 * dia)
        val c = Contador(nombre = "C", fechaMs = ahora - dia)
        assertEquals(listOf("B", "A"), Contadores.ordenados(listOf(a, b, c), ahora).map { it.nombre })
    }
}
