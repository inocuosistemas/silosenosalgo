package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * El visor OTA, la pieza donde un fallo se paga caro: si se activa un build a
 * medias, el visor se rompe justo donde no hay cobertura para arreglarlo.
 *
 * Cada prueba de aquí es un build malo que NO se puede llegar a activar.
 */
class OtaRulesTest {

    private fun entry(path: String, bytes: ByteArray) =
        OtaRules.Entry(path, OtaRules.sha256(bytes), bytes.size)

    private val js = "console.log('visor')".toByteArray()
    private val css = "body{margin:0}".toByteArray()
    private val html = """<html><script src="assets/main-a1b2.js"></script></html>""".toByteArray()

    private fun buildBueno(): Pair<OtaRules.Manifest, MutableMap<String, ByteArray>> {
        val files = listOf(
            entry("index.html", html),
            entry("assets/main-a1b2.js", js),
            entry("assets/estilo.css", css),
        )
        val m = OtaRules.Manifest("build001", files, files.sumOf { it.bytes })
        val datos = mutableMapOf(
            "index.html" to html,
            "assets/main-a1b2.js" to js,
            "assets/estilo.css" to css,
        )
        return m to datos
    }

    @Test fun `un build entero y coherente se acepta`() {
        val (m, datos) = buildBueno()
        assertNull(OtaRules.validaManifiesto(m))
        assertNull(OtaRules.validaDescarga(m, datos))
    }

    @Test fun `si falta un fichero no se activa nada`() {
        val (m, datos) = buildBueno()
        datos.remove("assets/estilo.css")
        assertEquals(OtaRules.Rechazo.FaltanFicheros, OtaRules.validaDescarga(m, datos))
    }

    @Test fun `un asset corrupto tumba el build entero`() {
        val (m, datos) = buildBueno()
        datos["assets/main-a1b2.js"] = "console.log('otra cosa')".toByteArray()
        val r = OtaRules.validaDescarga(m, datos)
        assertTrue(r is OtaRules.Rechazo.HashDistinto)
        assertEquals("assets/main-a1b2.js", (r as OtaRules.Rechazo.HashDistinto).path)
    }

    @Test fun `el HTML no se verifica por hash porque el middleware lo reescribe`() {
        // functions/_middleware.ts reescribe og:* al servir: los bytes NUNCA
        // coinciden con los del build. Si esto se verificara por hash, ninguna
        // actualización llegaría jamás a instalarse.
        val (m, datos) = buildBueno()
        datos["index.html"] =
            """<html><meta property="og:url" content="https://..."><script src="assets/main-a1b2.js"></script></html>"""
                .toByteArray()
        assertNull(OtaRules.validaDescarga(m, datos))
    }

    @Test fun `un index vacio se rechaza aunque el hash no se mire`() {
        val (m, datos) = buildBueno()
        datos["index.html"] = ByteArray(0)
        assertEquals(OtaRules.Rechazo.SinIndex, OtaRules.validaDescarga(m, datos))
    }

    @Test fun `la cascara de otro build se rechaza aunque todo lo demas cuadre`() {
        // El escenario que deja el visor en blanco: index.html de un build y
        // assets de otro. El hash del HTML no lo detecta (no se verifica), así
        // que la única defensa es comprobar que la cáscara cita un módulo del
        // manifiesto.
        val (m, datos) = buildBueno()
        datos["index.html"] =
            """<html><script src="assets/main-VIEJO.js"></script></html>""".toByteArray()
        assertEquals(OtaRules.Rechazo.CascaraDesparejada, OtaRules.validaDescarga(m, datos))
    }

    @Test fun `un manifiesto con rutas de escape no se descarga siquiera`() {
        val malas = listOf("../fuera.js", "assets/../../etc/passwd", "/absoluta.js", "")
        for (p in malas) {
            assertTrue("debería rechazar '$p'", OtaRules.esRutaPeligrosa(p))
        }
        assertTrue(!OtaRules.esRutaPeligrosa("assets/main.js"))
        assertTrue(!OtaRules.esRutaPeligrosa("index.html"))

        val m = OtaRules.Manifest("b", listOf(OtaRules.Entry("../fuera.js", "x", 1)), 1)
        assertTrue(OtaRules.validaManifiesto(m) is OtaRules.Rechazo.RutaPeligrosa)
    }

    @Test fun `un manifiesto enorme o vacio se descarta antes de gastar datos`() {
        val vacio = OtaRules.Manifest("b", emptyList(), 0)
        assertEquals(OtaRules.Rechazo.Vacio, OtaRules.validaManifiesto(vacio))

        val (m, _) = buildBueno()
        val enorme = m.copy(totalBytes = OtaRules.MAX_TOTAL_BYTES + 1)
        assertEquals(OtaRules.Rechazo.Enorme, OtaRules.validaManifiesto(enorme))
    }

    @Test fun `un manifiesto sin index se descarta antes de descargar`() {
        val soloJs = listOf(entry("assets/main-a1b2.js", js))
        val m = OtaRules.Manifest("b", soloJs, soloJs.sumOf { it.bytes })
        assertEquals(OtaRules.Rechazo.SinIndex, OtaRules.validaManifiesto(m))
    }

    @Test fun `solo se descarga cuando el buildId cambia`() {
        val (m, _) = buildBueno()
        assertTrue(!OtaRules.hayQueActualizar(m, "build001"))
        assertTrue(OtaRules.hayQueActualizar(m, "build000"))
        // Sin nada instalado (primer arranque tras instalar la app), sí.
        assertTrue(OtaRules.hayQueActualizar(m, null))
    }

    @Test fun `el hash es el mismo sha256 en hexadecimal que usa el generador`() {
        // Comprobado contra el valor conocido de sha256("abc").
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            OtaRules.sha256("abc".toByteArray()),
        )
    }
}
