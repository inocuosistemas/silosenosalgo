package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Los paquetes `.slsnsguide` llegan de FUERA: te los manda alguien por
 * mensajería y los abre la app. Eso convierte cada prueba de aquí en la defensa
 * contra un archivo hostil, no en una comprobación de forma.
 *
 * El ataque clásico contra un descompresor es el "zip slip": una entrada llamada
 * `../../algo` que, al extraerse, escribe encima de otra cosa del móvil.
 */
class GuideRulesTest {

    private fun manifiesto(
        format: String = GuideRules.FORMATO,
        version: Int = GuideRules.VERSION,
        id: String = "sesion123",
        trail: String = "trail.json",
        notes: String = "notes.json",
        plan: String? = null,
        media: List<GuideRules.Medio> = emptyList(),
    ) = GuideRules.Manifiesto(
        format = format, version = version, id = id,
        trailPath = trail, notesPath = notes, planPath = plan, media = media,
    )

    // ── Rutas hostiles ───────────────────────────────────────────────────────

    @Test fun `una ruta que sale del directorio se rechaza`() {
        assertFalse(GuideRules.esRutaSegura("../../databases/roto.db"))
        assertFalse(GuideRules.esRutaSegura("media/../../fuera.jpg"))
        assertFalse(GuideRules.esRutaSegura("/etc/passwd"))
    }

    @Test fun `el separador de Windows tambien se rechaza`() {
        // Sin esto, `..\` esquivaria una comprobacion que solo mirase "/".
        assertFalse(GuideRules.esRutaSegura("..\\fuera.jpg"))
        assertFalse(GuideRules.esRutaSegura("media\\foto.jpg"))
        assertFalse(GuideRules.esRutaSegura("C:/fuera.jpg"))
    }

    @Test fun `las rutas normales del formato se aceptan`() {
        assertTrue(GuideRules.esRutaSegura("trail.json"))
        assertTrue(GuideRules.esRutaSegura("media/nota123_photo.jpg"))
    }

    @Test fun `un id de nota con barras no puede formar un nombre de fichero`() {
        assertFalse(GuideRules.esComponenteSeguro("../otro"))
        assertFalse(GuideRules.esComponenteSeguro("con/barra"))
        assertFalse(GuideRules.esComponenteSeguro(""))
        assertTrue(GuideRules.esComponenteSeguro("Ab9_-xyz"))
    }

    @Test fun `un manifiesto con una ruta hostil se rechaza entero`() {
        val r = GuideRules.valida(manifiesto(trail = "../../fuera.json"))
        assertTrue(r is GuideRules.Rechazo.RutaPeligrosa)
    }

    @Test fun `un medio con ruta hostil se rechaza aunque el resto este bien`() {
        val malo = GuideRules.Medio("nota1", "photo", "../../fuera.jpg", "image/jpeg")
        assertTrue(GuideRules.valida(manifiesto(media = listOf(malo))) is GuideRules.Rechazo.RutaPeligrosa)
    }

    @Test fun `un medio de clase desconocida se rechaza`() {
        // Solo hay fotos y audios. Cualquier otra cosa es un intento de escribir
        // un fichero con una extension elegida por quien manda el paquete.
        val raro = GuideRules.Medio("nota1", "ejecutable", "media/x.sh", "text/plain")
        assertTrue(GuideRules.valida(manifiesto(media = listOf(raro))) is GuideRules.Rechazo.RutaPeligrosa)
    }

    // ── Formato y versión ────────────────────────────────────────────────────

    @Test fun `un zip cualquiera no es una guia`() {
        assertTrue(GuideRules.valida(manifiesto(format = "otracosa")) is GuideRules.Rechazo.NoEsGuia)
    }

    @Test fun `una guia del futuro se rechaza en vez de leerse a medias`() {
        // Leer una v2 con el lector de la v1 daria una guia incompleta sin
        // avisar, que es peor que decir que no se puede abrir.
        assertTrue(GuideRules.valida(manifiesto(version = 2)) is GuideRules.Rechazo.VersionFutura)
    }

    @Test fun `una guia de una version anterior se sigue abriendo`() {
        assertNull(GuideRules.valida(manifiesto(version = 1)))
    }

    @Test fun `un manifiesto correcto pasa`() {
        val bueno = manifiesto(
            plan = "plan.gz",
            media = listOf(GuideRules.Medio("nota1", "photo", "media/nota1_photo.jpg", "image/jpeg")),
        )
        assertNull(GuideRules.valida(bueno))
    }

    // ── Nombres ──────────────────────────────────────────────────────────────

    @Test fun `el nombre del fichero exportado es inofensivo`() {
        assertEquals("Ruta_del_Sil.slsnsguide", GuideRules.nombreDeFichero("Ruta del Sil"))
        assertEquals("guia.slsnsguide", GuideRules.nombreDeFichero(null))
        assertEquals("guia.slsnsguide", GuideRules.nombreDeFichero("/../"))
        assertFalse(GuideRules.nombreDeFichero("a/b/../c").contains("/"))
    }

    @Test fun `el id local no puede chocar con el de una sesion propia`() {
        val id = GuideRules.idLocal("SvhCHmAxgXMRhrwjjcaPLg")
        assertTrue(id.startsWith("guide_"))
        // Y sanea lo que venga: el id del manifiesto lo elige quien exporta.
        assertFalse(GuideRules.idLocal("../otro").contains("/"))
    }

    @Test fun `el nombre del medio guardado cuadra con el que espera el visor`() {
        assertEquals("n1_photo.jpg", GuideRules.nombreMedio("n1", "photo"))
        assertEquals("n1_audio.m4a", GuideRules.nombreMedio("n1", "audio"))
    }
}
