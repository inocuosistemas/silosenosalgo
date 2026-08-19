@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Preparar el mapa antes de salir: bajarse las teselas de un corredor alrededor
 * de la ruta para que la travesía funcione sin cobertura.
 *
 * Espejo de `ios/Sources/MapDownloadView.swift`, con sus mismos valores por
 * defecto (corredor de 800 m, zoom 11 a 15), que están elegidos para que una
 * ruta de montaña normal quepa en unas decenas de megas.
 *
 * La cifra estimada se enseña ANTES de descargar y a propósito: son datos
 * móviles de alguien, y bajar el mapa de una ruta larga con el corredor ancho
 * puede pasar de 100 MB sin avisar.
 */
@Composable
fun SeccionMapaOffline(
    planId: String?,
    trazaActual: List<TrailPoint>,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val teselas = remember { TileCache(context.applicationContext) }

    var corredorMetros by remember { mutableStateOf(800.0) }
    var zoomMax by remember { mutableIntStateOf(15) }
    val zoomMin = 11

    var ruta by remember { mutableStateOf<List<Pair<Double, Double>>?>(null) }
    var cargandoRuta by remember { mutableStateOf(false) }
    var total by remember { mutableIntStateOf(0) }
    var yaEnDisco by remember { mutableIntStateOf(0) }
    var descargando by remember { mutableStateOf(false) }
    var hechas by remember { mutableIntStateOf(0) }
    var cancelar by remember { mutableStateOf(false) }
    var ocupado by remember { mutableStateOf(teselas.bytesOcupados()) }

    // La ruta: la planificada si hay plan elegido, y si no lo ya recorrido.
    LaunchedEffect(planId, trazaActual.size) {
        cargandoRuta = true
        val planificada = planId?.let { TrackingStore.trazadoDelPlan(it) }
        ruta = PlanGeometry.rutaParaDescargar(planificada, trazaActual)
        cargandoRuta = false
    }

    // El cálculo del corredor no es gratis (densifica la ruta entera), así que
    // se hace fuera del hilo de la interfaz cada vez que cambian los mandos.
    LaunchedEffect(ruta, corredorMetros, zoomMax) {
        val r = ruta
        if (r == null) { total = 0; yaEnDisco = 0; return@LaunchedEffect }
        val conjunto = withContext(Dispatchers.Default) {
            TileMath.teselasDelCorredor(r, corredorMetros, zoomMin, zoomMax)
        }
        total = conjunto.size
        yaEnDisco = withContext(Dispatchers.IO) { teselas.cuantasHay(conjunto) }
    }

    Text("Mapa sin cobertura", style = MaterialTheme.typography.titleSmall)
    Text(
        "Descarga el mapa de la ruta para que funcione en el monte. Hazlo con " +
            "wifi: son bastantes megas.",
        style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(8.dp))

    if (ruta == null) {
        Text(
            if (cargandoRuta) "Buscando la ruta…"
            else "No hay ruta que preparar. Elige una ruta planificada (con conexión), " +
                "o empieza a andar y se podrá descargar el mapa de por donde has pasado.",
            style = MaterialTheme.typography.bodySmall,
        )
        return
    }

    // La vista previa: en verde lo que ya está en el móvil. Se redibuja al
    // terminar una descarga (por eso depende de `yaEnDisco`).
    ruta?.let { r ->
        key(yaEnDisco) {
            MapaCobertura(ruta = r, cache = teselas)
        }
        Text(
            "Verde = mapa ya descargado. La línea azul es tu ruta.",
            style = MaterialTheme.typography.labelSmall,
        )
        Spacer(Modifier.height(8.dp))
    }

    Text("Detalle del mapa", style = MaterialTheme.typography.bodySmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(13, 14, 15, 16).forEach { z ->
            BotonZoom(etiquetaZoom(z), zoomMax == z) { zoomMax = z }
        }
    }

    Spacer(Modifier.height(6.dp))
    Text("Ancho del corredor: ${corredorMetros.toInt()} m", style = MaterialTheme.typography.bodySmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(250.0, 500.0, 800.0, 1200.0, 2000.0).forEach { m ->
            BotonZoom("${m.toInt()} m", corredorMetros == m) { corredorMetros = m }
        }
    }

    Spacer(Modifier.height(10.dp))
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(
                "≈ $total teselas · ≈ ${formateaBytes(TileMath.bytesEstimados(total))}",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "Ya descargadas: $yaEnDisco de $total",
                style = MaterialTheme.typography.bodySmall,
            )
            if (descargando) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { if (total > 0) hechas.toFloat() / total else 0f },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("$hechas de $total", style = MaterialTheme.typography.labelSmall)
            }
        }
    }

    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (descargando) {
            OutlinedButton(onClick = { cancelar = true }) { Text("Cancelar") }
        } else {
            Button(
                enabled = total > yaEnDisco,
                onClick = {
                    val r = ruta ?: return@Button
                    descargando = true
                    cancelar = false
                    hechas = 0
                    scope.launch {
                        val conjunto = withContext(Dispatchers.Default) {
                            TileMath.teselasDelCorredor(r, corredorMetros, zoomMin, zoomMax)
                        }
                        teselas.descargaCorredor(
                            teselas = conjunto,
                            alProgresar = { h, _ -> hechas = h },
                            cancelado = { cancelar },
                        )
                        descargando = false
                        yaEnDisco = withContext(Dispatchers.IO) { teselas.cuantasHay(conjunto) }
                        ocupado = withContext(Dispatchers.IO) { teselas.bytesOcupados() }
                    }
                },
            ) { Text(if (yaEnDisco > 0) "Completar descarga" else "Descargar mapa") }
        }
    }

    Spacer(Modifier.height(8.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("Mapas guardados: ${formateaBytes(ocupado)}", style = MaterialTheme.typography.bodySmall)
        TextButton(
            enabled = !descargando && ocupado > 0,
            onClick = {
                scope.launch {
                    withContext(Dispatchers.IO) { teselas.vacia() }
                    ocupado = 0
                    yaEnDisco = 0
                }
            },
        ) { Text("Borrar") }
    }
}

@Composable
private fun BotonZoom(texto: String, elegido: Boolean, onClick: () -> Unit) {
    if (elegido) Button(onClick = onClick) { Text(texto) }
    else OutlinedButton(onClick = onClick) { Text(texto) }
}

/** El zoom se nombra por lo que se ve, no por su número: "16" no le dice nada a
 *  nadie, "hasta los senderos" sí. */
private fun etiquetaZoom(z: Int): String = when (z) {
    13 -> "Básico"
    14 -> "Normal"
    15 -> "Detallado"
    else -> "Máximo"
}

private fun formateaBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024 * 1024 ->
        String.format(Locale.getDefault(), "%.1f GB", bytes / 1024.0 / 1024 / 1024)
    bytes >= 1024L * 1024 ->
        String.format(Locale.getDefault(), "%.0f MB", bytes / 1024.0 / 1024)
    else -> String.format(Locale.getDefault(), "%.0f KB", bytes / 1024.0)
}
