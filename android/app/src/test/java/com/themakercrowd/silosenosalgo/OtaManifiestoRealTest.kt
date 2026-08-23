package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Las reglas OTA contra el manifiesto REAL de producción.
 *
 * Los otros tests usan manifiestos inventados, que prueban la lógica pero no
 * que el modelo case con lo que sirve el backend de verdad. El fichero de
 * `resources/` se descargó de https://silosenosalgo.themakercrowd.com/ota-manifest.json:
 * si algún día el generador (`scripts/make-ota-manifest.mjs`) cambia de forma,
 * estas pruebas se caen aquí y no en el móvil de alguien en mitad del monte.
 */
class OtaManifiestoRealTest {

    private fun manifiestoReal(): OtaRules.Manifest {
        val texto = javaClass.classLoader!!
            .getResourceAsStream("ota-manifest-produccion.json")!!
            .bufferedReader().readText()
        return Api.json.decodeFromString(texto)
    }

    @Test fun `el manifiesto de produccion se decodifica y pasa la validacion`() {
        val m = manifiestoReal()
        assertEquals("d8d0611391174a05", m.buildId)
        assertEquals(20, m.files.size)
        assertNull("producción debería ser siempre instalable", OtaRules.validaManifiesto(m))
    }

    @Test fun `el visor real cabe de sobra en el tope de tamano`() {
        val m = manifiestoReal()
        // ~2,9 MB hoy. El tope son 24 MB: si algún día se acercara, es que algo
        // se ha colado en dist/ (un vídeo, un mapa) y conviene enterarse.
        assertTrue("el visor ha crecido a ${m.totalBytes / 1024 / 1024} MB", m.totalBytes < 8 * 1024 * 1024)
        assertEquals(m.totalBytes, m.files.sumOf { it.bytes })
    }

    @Test fun `trae index y modulos, que es lo que exige la validacion de cascara`() {
        val m = manifiestoReal()
        assertNotNull(m.files.firstOrNull { it.path == "index.html" })
        val modulos = m.files.filter { it.path.startsWith("assets/") && it.path.endsWith(".js") }
        assertTrue("sin módulos en assets/ la cáscara nunca casaría", modulos.isNotEmpty())
    }

    @Test fun `ninguna ruta de produccion es de las que rechazamos`() {
        val m = manifiestoReal()
        for (f in m.files) {
            assertTrue("producción trae una ruta que rechazamos: ${f.path}", !OtaRules.esRutaPeligrosa(f.path))
        }
    }

    @Test fun `todos los hashes son sha256 en hexadecimal`() {
        val m = manifiestoReal()
        val hex = Regex("^[0-9a-f]{64}$")
        for (f in m.files) {
            assertTrue("hash con formato raro en ${f.path}: ${f.sha256}", hex.matches(f.sha256))
        }
    }
}
