package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Vista previa de qué mapa hay descargado: la ruta y, en verde, las zonas cuyas
 * teselas ya están en el móvil.
 *
 * Espejo de `ios/Sources/CoverageMap.swift`, con una diferencia deliberada: allí
 * se dibuja encima de un mapa de Apple y aquí NO hay mapa de fondo. No es una
 * carencia — es que el fondo aquí serían las propias teselas, y pintar en verde
 * "lo descargado" sobre un mapa que solo se ve donde hay descarga no diría nada.
 * Sin fondo, el hueco se ve por lo que es: un trozo de ruta sin mapa.
 *
 * Solo lee del disco; nunca descarga nada.
 */
@Composable
fun MapaCobertura(
    ruta: List<Pair<Double, Double>>,
    cache: TileCache,
    modifier: Modifier = Modifier,
) {
    if (ruta.size < 2) return

    /** z12 como en iOS: pocos cuadros y siempre forman parte de un corredor. */
    val zoom = 12

    val datos = remember(ruta, zoom) {
        val proyectada = ruta.map { (lat, lon) -> TileMath.proyecta(lat, lon) }
        val xs = proyectada.map { it.first }
        val ys = proyectada.map { it.second }

        // Un margen para que la ruta no muera pegada al borde del recuadro.
        val margen = 0.08
        val anchoX = (xs.max() - xs.min()).coerceAtLeast(1e-6)
        val anchoY = (ys.max() - ys.min()).coerceAtLeast(1e-6)
        val x0 = xs.min() - anchoX * margen
        val x1 = xs.max() + anchoX * margen
        val y0 = ys.min() - anchoY * margen
        val y1 = ys.max() + anchoY * margen

        val latMin = ruta.minOf { it.first }
        val latMax = ruta.maxOf { it.first }
        val lonMin = ruta.minOf { it.second }
        val lonMax = ruta.maxOf { it.second }
        val cuadros = TileMath.teselasEnCaja(latMin, lonMin, latMax, lonMax, zoom)
            .filter { cache.estaEnDisco(it.z, it.x, it.y) }
            .map { t ->
                val (latNO, lonNO) = TileMath.esquinaNoroeste(t.z, t.x, t.y)
                val (latSE, lonSE) = TileMath.esquinaNoroeste(t.z, t.x + 1, t.y + 1)
                val (px0, py0) = TileMath.proyecta(latNO, lonNO)
                val (px1, py1) = TileMath.proyecta(latSE, lonSE)
                listOf(px0, py0, px1, py1)
            }

        Datos(proyectada, x0, x1, y0, y1, cuadros)
    }

    Canvas(modifier = modifier.fillMaxWidth().height(160.dp)) {
        fun aPantalla(x: Double, y: Double): Offset {
            val fx = (x - datos.x0) / (datos.x1 - datos.x0)
            val fy = (y - datos.y0) / (datos.y1 - datos.y0)
            return Offset((fx * size.width).toFloat(), (fy * size.height).toFloat())
        }

        drawRect(color = Color(0xFF0F172A))

        // Primero los cuadros descargados, debajo de la ruta.
        for (c in datos.cuadros) {
            val esquina = aPantalla(c[0], c[1])
            val opuesta = aPantalla(c[2], c[3])
            drawRect(
                color = Color(0x4722C55E),
                topLeft = esquina,
                size = Size(opuesta.x - esquina.x, opuesta.y - esquina.y),
            )
        }

        val camino = Path()
        datos.proyectada.forEachIndexed { i, (x, y) ->
            val p = aPantalla(x, y)
            if (i == 0) camino.moveTo(p.x, p.y) else camino.lineTo(p.x, p.y)
        }
        drawPath(camino, color = Color(0xFF0EA5E9), style = Stroke(width = 3f))
    }
}

private data class Datos(
    val proyectada: List<Pair<Double, Double>>,
    val x0: Double,
    val x1: Double,
    val y0: Double,
    val y1: Double,
    val cuadros: List<List<Double>>,
)
