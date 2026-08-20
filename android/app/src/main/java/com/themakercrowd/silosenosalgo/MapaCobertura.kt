package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Vista previa de qué mapa hay descargado: la ruta y, en verde, las teselas que
 * ya están en el móvil.
 *
 * Espejo de `ios/Sources/CoverageMap.swift`, con una diferencia deliberada: allí
 * se dibuja encima de un mapa de Apple y aquí NO hay mapa de fondo. No es una
 * carencia — el fondo aquí serían las propias teselas, y pintar "lo descargado"
 * sobre un mapa que solo se ve donde hay descarga no diría nada.
 *
 * Se dibujan **las teselas del corredor**, las mismas que descarga el botón, y
 * no una rejilla del encuadre. La diferencia importa: con una rejilla, en una
 * ruta más corta que una tesela salía todo verde y no distinguía "tengo mi ruta"
 * de "tengo un cuadro enorme que la contiene". Y el encuadre se calcula sobre
 * las TESELAS, no sobre la ruta, para que se vean enteras: si no, una tesela más
 * grande que la ruta se comía el recuadro entero.
 *
 * Solo lee del disco; nunca descarga nada.
 */
@Composable
fun MapaCobertura(
    ruta: List<Pair<Double, Double>>,
    cache: TileCache,
    zoomPedido: Int,
    corredorMetros: Double,
    modifier: Modifier = Modifier,
) {
    if (ruta.size < 2) return

    val datos = remember(ruta, zoomPedido, corredorMetros) {
        val latMin = ruta.minOf { it.first }
        val latMax = ruta.maxOf { it.first }
        val lonMin = ruta.minOf { it.second }
        val lonMax = ruta.maxOf { it.second }
        val zoom = TileMath.zoomDeCobertura(latMin, lonMin, latMax, lonMax, zoomPedido)

        val corredor = TileMath.teselasDelCorredor(ruta, corredorMetros, zoom, zoom)
        val cuadros = corredor.map { t ->
            val (latNO, lonNO) = TileMath.esquinaNoroeste(t.z, t.x, t.y)
            val (latSE, lonSE) = TileMath.esquinaNoroeste(t.z, t.x + 1, t.y + 1)
            val (x0, y0) = TileMath.proyecta(latNO, lonNO)
            val (x1, y1) = TileMath.proyecta(latSE, lonSE)
            Cuadro(x0, y0, x1, y1, cache.estaEnDisco(t.z, t.x, t.y))
        }

        val proyectada = ruta.map { (lat, lon) -> TileMath.proyecta(lat, lon) }
        // El encuadre lo marcan las teselas, no la ruta: asi se ven completas y
        // ninguna se sale del recuadro.
        val xs = cuadros.flatMap { listOf(it.x0, it.x1) } + proyectada.map { it.first }
        val ys = cuadros.flatMap { listOf(it.y0, it.y1) } + proyectada.map { it.second }
        val margen = 0.04
        val anchoX = (xs.max() - xs.min()).coerceAtLeast(1e-9)
        val anchoY = (ys.max() - ys.min()).coerceAtLeast(1e-9)

        Datos(
            proyectada = proyectada,
            cuadros = cuadros,
            x0 = xs.min() - anchoX * margen,
            x1 = xs.max() + anchoX * margen,
            y0 = ys.min() - anchoY * margen,
            y1 = ys.max() + anchoY * margen,
        )
    }

    Box(
        modifier
            .fillMaxWidth()
            .height(170.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Paleta.slate950)
            .border(1.dp, Paleta.slate700, RoundedCornerShape(12.dp)),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            // Las teselas se dibujan cuadradas, con la misma escala en los dos
            // ejes: estiradas para llenar el hueco dejarian de parecer teselas y
            // el mapa se leeria torcido.
            val escala = minOf(
                size.width / (datos.x1 - datos.x0).toFloat(),
                size.height / (datos.y1 - datos.y0).toFloat(),
            )
            val anchoDibujo = (datos.x1 - datos.x0).toFloat() * escala
            val altoDibujo = (datos.y1 - datos.y0).toFloat() * escala
            val despX = (size.width - anchoDibujo) / 2
            val despY = (size.height - altoDibujo) / 2

            fun aPantalla(x: Double, y: Double) = Offset(
                despX + ((x - datos.x0).toFloat() * escala),
                despY + ((y - datos.y0).toFloat() * escala),
            )

            for (c in datos.cuadros) {
                val esquina = aPantalla(c.x0, c.y0)
                val opuesta = aPantalla(c.x1, c.y1)
                val tam = Size(opuesta.x - esquina.x, opuesta.y - esquina.y)
                // Las que faltan se dibujan también, en hueco: sin ellas no se
                // sabría si el trozo sin verde es que falta mapa o que ahí no
                // hacía falta ninguno.
                drawRect(
                    color = if (c.descargada) Paleta.verde.copy(alpha = 0.30f)
                    else Paleta.slate800.copy(alpha = 0.35f),
                    topLeft = esquina,
                    size = tam,
                )
                drawRect(
                    color = if (c.descargada) Paleta.verde.copy(alpha = 0.55f)
                    else Paleta.slate700,
                    topLeft = esquina,
                    size = tam,
                    style = Stroke(width = 1f),
                )
            }

            val camino = Path()
            datos.proyectada.forEachIndexed { i, (x, y) ->
                val p = aPantalla(x, y)
                if (i == 0) camino.moveTo(p.x, p.y) else camino.lineTo(p.x, p.y)
            }
            drawPath(
                camino,
                color = Paleta.sky500,
                style = Stroke(width = 3f, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}

private data class Cuadro(
    val x0: Double,
    val y0: Double,
    val x1: Double,
    val y1: Double,
    val descargada: Boolean,
)

private data class Datos(
    val proyectada: List<Pair<Double, Double>>,
    val cuadros: List<Cuadro>,
    val x0: Double,
    val x1: Double,
    val y0: Double,
    val y1: Double,
)
