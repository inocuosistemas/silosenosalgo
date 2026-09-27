package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Test

class ImagenTest {
    @Test fun `una foto de 48 MP se lee a la cuarta parte para 1600 px`() {
        // 8000×6000 → /4 = 2000×1500: el lado mayor sigue por encima de 1600.
        assertEquals(4, Imagen.muestreo(8000, 6000, 1600))
    }

    @Test fun `nunca deja el lado mayor por debajo del pedido`() {
        for (lado in listOf(1599, 1600, 3199, 3200, 6400, 12000)) {
            val n = Imagen.muestreo(lado, lado / 2, 1600)
            assert(lado / n >= 1600 || n == 1) { "$lado → /$n" }
        }
    }

    @Test fun `una pequeña se lee entera`() {
        assertEquals(1, Imagen.muestreo(1200, 900, 1600))
    }
}
