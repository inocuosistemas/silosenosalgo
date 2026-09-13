package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ActualizacionTest {
    @Test fun `la version sale de la etiqueta del release`() {
        assertEquals(483, Actualizacion.versionDeEtiqueta("v1.0-483"))
        assertEquals(1200, Actualizacion.versionDeEtiqueta("v2.1-1200"))
        assertNull(Actualizacion.versionDeEtiqueta("v1.0"))
        assertNull(Actualizacion.versionDeEtiqueta("borrador"))
    }

    @Test fun `solo se anuncia una version mas nueva`() {
        assertEquals(490, Actualizacion.nuevaQue(483, 490))
        assertNull(Actualizacion.nuevaQue(490, 490))
        // Compilada a mano desde un commit posterior al último release.
        assertNull(Actualizacion.nuevaQue(495, 490))
        // Sin red no se sabe, y no se dice nada.
        assertNull(Actualizacion.nuevaQue(483, null))
    }
}
