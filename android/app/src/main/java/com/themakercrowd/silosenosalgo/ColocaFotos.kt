package com.themakercrowd.silosenosalgo

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Dónde va una foto en una salida ya terminada. Espejo de `ColocaFotos` en iOS
 * (ios/Sources/FotosEnRuta.swift), con los mismos umbrales.
 *
 * - POR LA HORA: la foto se hizo a las 10:42 y a las 10:42 estabas en tal
 *   punto del trazado. La buena casi siempre, y cae encima de la línea.
 * - POR EL GPS de la foto: si la hora no cae dentro de la salida, o si el GPS
 *   está lejos de donde dice la hora (otra cámara con el reloj mal puesto).
 * - A MANO: sin nada, se toca el mapa y se pega al punto del trazado más cercano.
 *
 * Los metros se cuentan como en la baliza (`TrackingRules.distanciaTraza`).
 */
object ColocaFotos {
    enum class Modo { POR_HORA, POR_GPS, A_MANO }

    data class Sitio(
        val lat: Double,
        val lon: Double,
        /** Metros recorridos hasta ahí. */
        val distM: Double,
        /** La hora del trazado en ese punto (epoch ms). */
        val t: Double,
        val modo: Modo,
    )

    /** Lo que se acepta antes de la primera posición o después de la última. */
    const val MARGEN_MS = 15 * 60_000.0
    /** Más lejos que esto entre el GPS de la foto y lo que dice la hora: manda el GPS. */
    const val DESACUERDO_M = 500.0

    fun acumulado(traza: List<TrailPoint>): DoubleArray {
        if (traza.isEmpty()) return DoubleArray(0)
        val acum = DoubleArray(traza.size)
        for (i in 1 until traza.size) {
            val a = traza[i - 1]
            val b = traza[i]
            val d = TrackingRules.distanciaMetros(a.lat, a.lon, b.lat, b.lon)
            val umbral = TrackingRules.umbralMovimiento(a.a?.toDouble(), b.a?.toDouble())
            acum[i] = acum[i - 1] + if (d >= umbral) d else 0.0
        }
        return acum
    }

    fun dentro(t: Double, traza: List<TrailPoint>): Boolean {
        val a = traza.firstOrNull()?.t ?: return false
        val b = traza.last().t
        return t >= a - MARGEN_MS && t <= b + MARGEN_MS
    }

    fun porHora(t: Double, traza: List<TrailPoint>, acum: DoubleArray): Sitio? {
        if (!dentro(t, traza)) return null
        val primero = traza.first()
        val ultimo = traza.last()
        if (t <= primero.t) return Sitio(primero.lat, primero.lon, 0.0, primero.t, Modo.POR_HORA)
        if (t >= ultimo.t) return Sitio(ultimo.lat, ultimo.lon, acum.last(), ultimo.t, Modo.POR_HORA)
        var lo = 0
        var hi = traza.size - 1
        while (lo < hi) {
            val m = (lo + hi) / 2
            if (traza[m].t < t) lo = m + 1 else hi = m
        }
        val b = traza[lo]
        val a = traza[lo - 1]
        val f = if (b.t > a.t) (t - a.t) / (b.t - a.t) else 0.0
        return Sitio(
            a.lat + (b.lat - a.lat) * f,
            a.lon + (b.lon - a.lon) * f,
            acum[lo - 1] + (acum[lo] - acum[lo - 1]) * f,
            t, Modo.POR_HORA,
        )
    }

    fun masCercano(lat: Double, lon: Double, traza: List<TrailPoint>): Int? {
        if (traza.isEmpty()) return null
        var mejor = 0
        var dMin = Double.MAX_VALUE
        traza.forEachIndexed { i, p ->
            val d = TrackingRules.distanciaMetros(lat, lon, p.lat, p.lon)
            if (d < dMin) { dMin = d; mejor = i }
        }
        return mejor
    }

    fun porGps(lat: Double, lon: Double, traza: List<TrailPoint>, acum: DoubleArray): Sitio? {
        val i = masCercano(lat, lon, traza) ?: return null
        return Sitio(lat, lon, acum[i], traza[i].t, Modo.POR_GPS)
    }

    fun aMano(lat: Double, lon: Double, traza: List<TrailPoint>, acum: DoubleArray): Sitio? {
        val i = masCercano(lat, lon, traza) ?: return null
        return Sitio(traza[i].lat, traza[i].lon, acum[i], traza[i].t, Modo.A_MANO)
    }

    fun coloca(fecha: Double?, gps: Pair<Double, Double>?, traza: List<TrailPoint>, acum: DoubleArray): Sitio? {
        if (fecha != null) {
            porHora(fecha, traza, acum)?.let { s ->
                if (gps != null && TrackingRules.distanciaMetros(gps.first, gps.second, s.lat, s.lon) > DESACUERDO_M) {
                    return porGps(gps.first, gps.second, traza, acum)
                }
                return s
            }
        }
        if (gps != null) return porGps(gps.first, gps.second, traza, acum)
        return null
    }

    /** Cuánto puede pasar entre hacer la foto con la cámara de la app y guardar la nota. */
    const val VENTANA_DE_NOTA_MS = 3 * 60_000.0

    /**
     * Cuáles de las fotos de la galería (`fotos`: id y hora) están ya en alguna
     * nota con foto de la salida (`notas`: su createdAt y su fixAt). Espejo de
     * `ColocaFotos.yaAnadidas` en iOS:
     * - EXACTAS: las añadidas desde aquí llevan la hora de la foto (en fixAt, y
     *   en createdAt si se colocaron por la hora), con un segundo de margen.
     * - Las hechas EN MARCHA con la cámara de la app: para cada nota que no casó
     *   exacta, la última foto hecha en los tres minutos antes de guardarla. Una
     *   por nota como mucho.
     */
    fun <K> yaAnadidas(fotos: List<Pair<K, Double>>, notas: List<Pair<Double, Double?>>): Set<K> {
        val hechas = mutableSetOf<K>()
        val sinCasar = mutableListOf<Double>()
        for ((creada, fix) in notas) {
            val exacta = fotos.firstOrNull { (_, t) ->
                kotlin.math.abs(t - creada) <= 1000 || (fix != null && kotlin.math.abs(t - fix) <= 1000)
            }
            if (exacta != null) hechas.add(exacta.first) else sinCasar.add(creada)
        }
        for (guardada in sinCasar) {
            fotos.filter { (k, t) -> k !in hechas && t <= guardada && t >= guardada - VENTANA_DE_NOTA_MS }
                .maxByOrNull { it.second }?.let { hechas.add(it.first) }
        }
        return hechas
    }

    /** "2026:09:20 10:42:07" con su desfase ("+02:00") si lo trae; sin él, la
     *  zona del móvil. En epoch ms. */
    fun fechaExif(s: String, desfase: String?, zona: TimeZone = TimeZone.getDefault()): Double? {
        val f = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).apply {
            isLenient = false
            timeZone = desfase?.let { zonaDe(it) } ?: zona
        }
        return runCatching { f.parse(s)?.time?.toDouble() }.getOrNull()
    }

    private fun zonaDe(desfase: String): TimeZone? {
        val m = Regex("""^([+-])(\d{2}):(\d{2})$""").find(desfase.trim()) ?: return null
        return TimeZone.getTimeZone("GMT${m.groupValues[1]}${m.groupValues[2]}:${m.groupValues[3]}")
    }
}
