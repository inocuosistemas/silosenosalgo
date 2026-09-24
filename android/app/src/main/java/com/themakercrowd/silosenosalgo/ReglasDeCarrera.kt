package com.themakercrowd.silosenosalgo

import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * La hoja de tramos de una carrera, tal como la calcula la web al empezar la
 * baliza (ver `src/lib/hojaDeTramos.ts`): los puntos que cierran tramo con su
 * corte, el perfil de la ruta y el horario previsto por el plan. La misma que
 * usa iOS para su tarjeta: así las dos apps dicen lo mismo.
 */
@Serializable
data class HojaDeTramos(
    val version: Int = 1,
    /** La salida oficial, en milisegundos. */
    val salida: Double,
    val totalKm: Double,
    val perfil: List<Muestra>,
    val previsto: List<Previsto>,
    val puntos: List<Punto>,
) {
    @Serializable data class Punto(val nombre: String, val km: Double, val tipo: String, val corte: Double? = null)
    @Serializable data class Muestra(val km: Double, val ele: Double)
    @Serializable data class Previsto(val km: Double, val min: Double)
}

/** Lo que enseña la notificación del tramo. Espejo de `DatosDeTramo` en iOS. */
data class DatosTramo(
    val numero: Int,
    val deTramos: Int,
    val desdeNombre: String,
    val desdeKm: Double,
    val hastaNombre: String,
    val hastaKm: Double,
    val hastaTipo: String?,
    val posicionKm: Double,
    val totalKm: Double,
    /** Alturas del tramo en puntos parejos, para dibujarlo. */
    val perfil: List<Double>,
    val subidaRestanteM: Int,
    val bajadaRestanteM: Int,
    val salidaMs: Double,
    /** A qué hora se llega al final del tramo yendo como se va. */
    val previsionMs: Double?,
    val corteMs: Double?,
    val enMeta: Boolean,
) {
    val restanteKm: Double get() = max(0.0, hastaKm - posicionKm)
    val progreso: Double get() = if (hastaKm > desdeKm) ((posicionKm - desdeKm) / (hastaKm - desdeKm)).coerceIn(0.0, 1.0) else 1.0
    /** Minutos de margen al corte del final del tramo (negativo: fuera de corte). */
    val margenMin: Double? get() = if (corteMs != null && previsionMs != null) (corteMs - previsionMs) / 60_000.0 else null
}

/**
 * Las REGLAS de la carrera en directo, sin estado para poder probarlas: de un
 * km y una hora a lo que enseña la notificación del tramo. Traducción de
 * `ReglasDeCarrera` en iOS: si una cambia, cambia la otra.
 */
object ReglasDeCarrera {
    const val MUESTRAS_DEL_TRAMO = 40
    /** Un repecho de menos de esto no cuenta como subida: el GPS y el modelo
     *  de terreno tienen más ruido que eso. */
    const val UMBRAL_DE_DESNIVEL = 3.0

    data class Tramo(val numero: Int, val desde: HojaDeTramos.Punto, val hasta: HojaDeTramos.Punto)

    /** El tramo en el que se va: desde el último punto pasado hasta el siguiente. */
    fun tramo(km: Double, hoja: HojaDeTramos): Tramo? {
        if (hoja.puntos.isEmpty()) return null
        val i = hoja.puntos.indexOfFirst { it.km > km + 0.05 }.let { if (it < 0) hoja.puntos.size - 1 else it }
        val desde = if (i == 0) HojaDeTramos.Punto("Salida", 0.0, "salida") else hoja.puntos[i - 1]
        return Tramo(i + 1, desde, hoja.puntos[i])
    }

    /** La altitud en un km, interpolada en el perfil. */
    fun ele(km: Double, perfil: List<HojaDeTramos.Muestra>): Double {
        val i = perfil.indexOfFirst { it.km >= km }
        if (i < 0) return perfil.lastOrNull()?.ele ?: 0.0
        if (i == 0) return perfil[0].ele
        val a = perfil[i - 1]; val b = perfil[i]
        val t = (km - a.km) / max(1e-9, b.km - a.km)
        return a.ele + (b.ele - a.ele) * t
    }

    fun perfil(desde: Double, hasta: Double, hoja: HojaDeTramos, n: Int = MUESTRAS_DEL_TRAMO): List<Double> {
        if (hasta <= desde || n < 2) return emptyList()
        return (0 until n).map { j -> ele(desde + (hasta - desde) * j / (n - 1), hoja.perfil) }
    }

    /** Lo que queda por subir y por bajar entre dos km, sin contar el ruido. */
    fun desnivel(desde: Double, hasta: Double, hoja: HojaDeTramos): Pair<Int, Int> {
        if (hasta <= desde) return 0 to 0
        val alturas = buildList {
            add(ele(desde, hoja.perfil))
            hoja.perfil.filter { it.km > desde && it.km < hasta }.forEach { add(it.ele) }
            add(ele(hasta, hoja.perfil))
        }
        var sube = 0.0; var baja = 0.0
        var ancla = alturas[0]
        for (e in alturas.drop(1)) {
            val d = e - ancla
            if (d >= UMBRAL_DE_DESNIVEL) { sube += d; ancla = e }
            else if (d <= -UMBRAL_DE_DESNIVEL) { baja -= d; ancla = e }
        }
        return sube.roundToInt() to baja.roundToInt()
    }

    /** Minutos desde la salida que el plan prevé para un km. */
    fun previsto(km: Double, hoja: HojaDeTramos): Double? {
        val p = hoja.previsto
        val i = p.indexOfFirst { it.km >= km }
        if (i < 0) return p.lastOrNull()?.min
        if (i == 0) return p.firstOrNull()?.min
        val a = p[i - 1]; val b = p[i]
        val t = (km - a.km) / max(1e-9, b.km - a.km)
        return a.min + (b.min - a.min) * t
    }

    /** Cuánto se tarda respecto al plan en la última hora: 1 = como el plan.
     *  `historia` son (hora en ms, km). */
    fun rendimiento(ahoraMs: Double, posicion: Double, historia: List<Pair<Double, Double>>, hoja: HojaDeTramos): Double {
        val desde = ahoraMs - 3_600_000.0
        val inicio = historia.firstOrNull { it.first >= desde } ?: historia.firstOrNull() ?: return 1.0
        val pInicio = previsto(inicio.second, hoja) ?: return 1.0
        val pAhora = previsto(posicion, hoja) ?: return 1.0
        val real = (ahoraMs - inicio.first) / 60_000.0
        val esperado = pAhora - pInicio
        // Con poco recorrido la proporción es ruido. Mínimos: 10 min y 0,5 km.
        if (real < 10 || posicion - inicio.second < 0.5 || esperado <= 0.5) return 1.0
        return min(3.0, max(0.5, real / esperado))
    }

    /** A qué hora se llegará a `hasta` yendo como se va (ver iOS). */
    fun prevision(posicion: Double, hasta: Double, ahoraMs: Double, historia: List<Pair<Double, Double>>, hoja: HojaDeTramos): Double? {
        val aqui = previsto(posicion, hoja) ?: return null
        val alli = previsto(hasta, hoja) ?: return null
        val plan = max(0.0, alli - aqui)
        return ahoraMs + plan * rendimiento(ahoraMs, posicion, historia, hoja) * 60_000.0
    }

    /** Todo lo que enseña la notificación, para un km y una hora. */
    fun datos(km: Double, ahoraMs: Double, historia: List<Pair<Double, Double>>, hoja: HojaDeTramos): DatosTramo? {
        val t = tramo(km, hoja) ?: return null
        val enMeta = km >= hoja.totalKm * 0.99
        val (sube, baja) = desnivel(km, t.hasta.km, hoja)
        return DatosTramo(
            numero = t.numero, deTramos = hoja.puntos.size,
            desdeNombre = t.desde.nombre, desdeKm = t.desde.km,
            hastaNombre = t.hasta.nombre, hastaKm = t.hasta.km, hastaTipo = t.hasta.tipo,
            posicionKm = km, totalKm = hoja.totalKm,
            perfil = perfil(t.desde.km, t.hasta.km, hoja),
            subidaRestanteM = sube, bajadaRestanteM = baja,
            salidaMs = hoja.salida,
            previsionMs = if (enMeta) ahoraMs else prevision(km, t.hasta.km, ahoraMs, historia, hoja),
            corteMs = if (enMeta) null else t.hasta.corte,
            enMeta = enMeta,
        )
    }

    /** El emoji de un tipo de punto, para el texto de la notificación. */
    fun icono(tipo: String?): String = when (tipo) {
        "control" -> "🚩"
        "liquido" -> "💧"
        "solido" -> "🍴"
        "completo" -> "☕"
        "bolsa" -> "🎒"
        "meta" -> "🏁"
        else -> "📍"
    }
}
