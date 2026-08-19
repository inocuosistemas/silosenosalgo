package com.themakercrowd.silosenosalgo

import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/**
 * La geometría de las teselas: qué cuadros del mapa hacen falta para cubrir una
 * ruta, y cuánto van a ocupar.
 *
 * Espejo de la parte de corredor de `ios/Sources/TileCache.swift`. Vive aparte
 * de la caché y de la red, sin nada de Android, porque es donde está el riesgo
 * de verdad: un error aquí no se ve —el mapa parece bien en el sofá— y se
 * descubre en mitad del monte, con un hueco justo donde hacía falta.
 */
object TileMath {

    /** Una tesela del mapa. */
    data class Tesela(val z: Int, val x: Int, val y: Int)

    /** Bytes aproximados que ocupa un conjunto. Una tesela raster de OSM ronda
     *  los 20 KB; sirve para avisar antes de bajar, no para contabilidad. */
    fun bytesEstimados(numeroDeTeselas: Int): Long = numeroDeTeselas.toLong() * 20_000L

    /** Coordenadas de la tesela que contiene un punto (slippy map). */
    fun teselaDe(lat: Double, lon: Double, z: Int): Pair<Int, Int> {
        val n = 1 shl z
        val x = floor((lon + 180.0) / 360.0 * n).toInt()
        val latRad = Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878))
        val y = floor((1.0 - asinh(tan(latRad)) / PI) / 2.0 * n).toInt()
        return x.coerceIn(0, n - 1) to y.coerceIn(0, n - 1)
    }

    /** Anchura real (metros) de una tesela a esa latitud y zoom. Es lo que
     *  traduce "300 m de corredor" a un número de teselas. */
    fun metrosPorTesela(lat: Double, z: Int): Double {
        val latRad = Math.toRadians(lat)
        return 156543.03392 * cos(latRad) / (1 shl z) * 256.0
    }

    /**
     * Proyección Web Mercator a coordenadas normalizadas 0…1, con el (0,0)
     * arriba a la izquierda. Es la misma que usan las teselas, así que dibujar
     * la ruta y los cuadros con ella hace que encajen exactamente.
     */
    fun proyecta(lat: Double, lon: Double): Pair<Double, Double> {
        val x = (lon + 180.0) / 360.0
        val latRad = Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878))
        val y = (1.0 - asinh(tan(latRad)) / PI) / 2.0
        return x to y
    }

    /** Esquina noroeste de una tesela (la inversa de [teselaDe]). */
    fun esquinaNoroeste(z: Int, x: Int, y: Int): Pair<Double, Double> {
        val n = 1 shl z
        val lon = x.toDouble() / n * 360.0 - 180.0
        val latRad = kotlin.math.atan(kotlin.math.sinh(PI * (1 - 2.0 * y / n)))
        return Math.toDegrees(latRad) to lon
    }

    /** Todas las teselas de un zoom que caen dentro de una caja geográfica. */
    fun teselasEnCaja(
        latMin: Double,
        lonMin: Double,
        latMax: Double,
        lonMax: Double,
        z: Int,
    ): List<Tesela> {
        // En Mercator la latitud MAYOR da la fila menor: si se toman al revés,
        // el rango sale vacío y no se dibujaría ni un cuadro.
        val (x1, y1) = teselaDe(latMax, lonMin, z)
        val (x2, y2) = teselaDe(latMin, lonMax, z)
        val teselas = ArrayList<Tesela>()
        for (x in minOf(x1, x2)..maxOf(x1, x2)) {
            for (y in minOf(y1, y2)..maxOf(y1, y2)) {
                teselas.add(Tesela(z, x, y))
            }
        }
        return teselas
    }

    /**
     * Las teselas que cubren un corredor de `corredorMetros` alrededor de la
     * ruta, en todos los zooms de `zMin` a `zMax`.
     *
     * Se construye en el zoom MÁS FINO y los demás se derivan subiendo a los
     * padres, que es mucho más barato que repetir el recorrido en cada zoom y
     * además garantiza que los niveles encajan: no puede pasar que a z15 tengas
     * un trozo y a z14 te falte el cuadro que lo contiene.
     *
     * Los tramos largos se **densifican** antes de pintar el corredor: entre dos
     * vértices separados varios kilómetros no hay nada que marque las teselas de
     * en medio, y sin esto la ruta quedaría con el mapa a trozos justo en las
     * rectas largas.
     */
    fun teselasDelCorredor(
        ruta: List<Pair<Double, Double>>,
        corredorMetros: Double,
        zMin: Int,
        zMax: Int,
    ): Set<Tesela> {
        val conjunto = HashSet<Tesela>()
        if (ruta.isEmpty() || zMax < zMin) return conjunto

        fun alrededorDe(lat: Double, lon: Double, z: Int) {
            val metros = metrosPorTesela(lat, z)
            val radio = max(1, ceil(corredorMetros / max(1.0, metros)).toInt())
            val (cx, cy) = teselaDe(lat, lon, z)
            for (dx in -radio..radio) {
                for (dy in -radio..radio) {
                    conjunto.add(Tesela(z, cx + dx, cy + dy))
                }
            }
        }

        for (i in ruta.indices) {
            val (lat, lon) = ruta[i]
            alrededorDe(lat, lon, zMax)
            if (i == ruta.size - 1) continue

            val (lat2, lon2) = ruta[i + 1]
            val tramo = TrackingRules.distanciaMetros(lat, lon, lat2, lon2)
            val paso = metrosPorTesela(lat, zMax) / 2
            if (tramo > paso) {
                // Tope por si llega una ruta con un salto absurdo (dos puntos en
                // continentes distintos): densificarla entera colgaría la app.
                val trozos = min(2000, (tramo / paso).toInt())
                for (k in 1 until trozos) {
                    val f = k.toDouble() / trozos
                    alrededorDe(lat + (lat2 - lat) * f, lon + (lon2 - lon) * f, zMax)
                }
            }
        }

        // Los zooms más gruesos salen de los padres.
        var actual = conjunto.filter { it.z == zMax }.toSet()
        var z = zMax - 1
        while (z >= zMin) {
            val padres = actual.map { Tesela(z, it.x shr 1, it.y shr 1) }.toSet()
            conjunto.addAll(padres)
            actual = padres
            z--
        }

        // Al ensanchar el corredor se puede salir del mundo por los bordes.
        return conjunto.filter {
            it.z in 0..19 && it.x >= 0 && it.y >= 0 &&
                it.x < (1 shl it.z) && it.y < (1 shl it.z)
        }.toSet()
    }
}
