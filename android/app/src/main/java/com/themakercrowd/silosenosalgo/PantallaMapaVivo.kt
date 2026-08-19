@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * El mapa en directo a pantalla completa: el mismo visor que ve quien te sigue,
 * servido desde el móvil.
 *
 * Espejo de `ios/Sources/LiveMapView.swift`, **incluida su navegación**: desde
 * aquí se llega a las notas (verlas y añadirlas) y a la descarga del mapa. Es
 * deliberado y no una comodidad: cuando surge algo que anotar —una fuente, un
 * cruce dudoso— se está mirando el mapa, y obligar a salir a otro menú para
 * apuntarlo garantiza que no se apunte.
 */
@Composable
fun PantallaMapaVivo(
    sessionId: String,
    estado: TrackingStore.Estado,
    notas: List<Note>,
    /** Falso para una sesión terminada que se abre solo para consultarla: se
     *  puede mirar y descargar su mapa, pero ya no se anotan cosas en ella. */
    permiteEditar: Boolean = true,
    onCerrar: () -> Unit,
) {
    var viendoNotas by remember { mutableStateOf(false) }
    var anadiendoNota by remember { mutableStateOf(false) }
    var descargando by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onCerrar) { Text("‹ Volver") }
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                if (permiteEditar) {
                    TextButton(onClick = { viendoNotas = true }) {
                        Text(if (notas.isEmpty()) "Notas" else "Notas (${notas.size})")
                    }
                    // En modo espera la sesión aún no transmite ni registra
                    // posiciones, así que no habría dónde anclar la nota.
                    TextButton(
                        enabled = !estado.enEspera,
                        onClick = { anadiendoNota = true },
                    ) { Text("+ Nota") }
                }
                TextButton(onClick = { descargando = true }) { Text("Mapa") }
            }
        }

        VisorIncrustado(
            sessionId = sessionId,
            estado = estado,
            notas = notas,
            modifier = Modifier.fillMaxSize(),
        )
    }

    if (viendoNotas) {
        HojaListaNotas(
            notas = notas,
            sessionId = sessionId,
            onBorrar = { TrackingStore.borraNota(it) },
            onCerrar = { viendoNotas = false },
        )
    }

    if (anadiendoNota) {
        HojaAnadirNota(
            onGuardar = { texto, tipo, foto, audio ->
                TrackingStore.anadeNota(texto, tipo, foto, audio)
            },
            onCerrar = { anadiendoNota = false },
        )
    }

    if (descargando) {
        ModalBottomSheet(onDismissRequest = { descargando = false }) {
            Column(
                Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text("Preparar el mapa", style = MaterialTheme.typography.titleMedium)
                SeccionMapaOffline(
                    planId = estado.planId,
                    trazaActual = TrackingStore.trazaActual(),
                )
            }
        }
    }
}
