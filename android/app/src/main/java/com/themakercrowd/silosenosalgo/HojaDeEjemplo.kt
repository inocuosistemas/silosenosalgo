package com.themakercrowd.silosenosalgo

import kotlin.math.sin

/**
 * Una carrera de ejemplo —42 km, siete tramos, cortes al plan × 1,25—, la misma
 * que `HojaDeTramos.ejemplo` en iOS: para las pruebas y para ver la
 * notificación del tramo en el emulador sin salir a correr.
 */
object HojaDeEjemplo {
    fun hoja(salidaMs: Double): HojaDeTramos {
        val total = 42.0
        fun ele(km: Double): Double {
            val base = when {
                km < 10 -> 800 + 80 * km
                km < 21 -> 1600 - 40 * (km - 10)
                km < 28 -> 1160 + 90 * (km - 21)
                else -> 1790 - 70 * (km - 28)
            }
            return base + 25 * sin(km * 2.3)
        }
        val perfil = (0..840).map { i -> val km = i * 0.05; HojaDeTramos.Muestra(km, ele(km)) }
        // 8 min/km en llano, más en subida.
        val previsto = mutableListOf(HojaDeTramos.Previsto(0.0, 0.0))
        var min = 0.0
        for (i in 1..168) {
            val km = i * 0.25
            val sube = maxOf(0.0, ele(km) - ele(km - 0.25))
            min += 0.25 * 8 + sube * 0.1
            previsto.add(HojaDeTramos.Previsto(km, min))
        }
        fun previstoEn(km: Double) = previsto.first { it.km >= km }.min
        fun corte(km: Double) = salidaMs + previstoEn(km) * 1.25 * 60_000
        return HojaDeTramos(
            salida = salidaMs, totalKm = total, perfil = perfil, previsto = previsto,
            puntos = listOf(
                HojaDeTramos.Punto("Font del Gel", 5.0, "liquido"),
                HojaDeTramos.Punto("Coll de Pal", 9.5, "control", corte(9.5)),
                HojaDeTramos.Punto("Refugi del Rebost", 15.0, "solido"),
                HojaDeTramos.Punto("La Pleta", 21.0, "liquido", corte(21.0)),
                HojaDeTramos.Punto("Collada Verda", 28.0, "completo", corte(28.0)),
                HojaDeTramos.Punto("Font Baixa", 35.0, "liquido"),
                HojaDeTramos.Punto("Meta", total, "meta"),
            ),
        )
    }
}
