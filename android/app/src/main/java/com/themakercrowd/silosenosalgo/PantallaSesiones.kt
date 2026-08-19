// `FlowRow` sigue marcada como experimental en esta versión de Compose. Se
// asume a propósito: las filas de botones de aquí (hasta cinco por sesión) TIENEN
// que poder saltar de línea, y la alternativa sin API experimental —una fila con
// desplazamiento horizontal— escondería acciones fuera de pantalla, que en una
// pantalla de móvil estrecha significa que nadie las encuentra.
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "Mis seguimientos" y los mandos que en iOS viven en el formulario de la
 * pantalla de seguimiento: plan asociado, ritmo manual y retención.
 *
 * La regla que gobierna la lista es la de iOS: una sesión **caducada** —sin
 * chincheta y pasada su ventana de retención— ya no tiene ruta en el servidor,
 * así que su enlace está muerto. Se marca como tal y se le esconden los botones
 * de compartir: mandar un enlace roto a quien te espera es peor que no mandar
 * nada.
 */

@Composable
fun SeccionSesiones(
    sesiones: List<TrackSessionSummary>,
    idActual: String?,
    onContinuar: (String) -> Unit,
    onReanudar: (String) -> Unit,
    onCompartir: (String) -> Unit,
    onChincheta: (String, Boolean) -> Unit,
    onRenombrar: (String, String?) -> Unit,
    onBorrar: (String) -> Unit,
) {
    if (sesiones.isEmpty()) return
    var renombrando by remember { mutableStateOf<TrackSessionSummary?>(null) }
    var borrando by remember { mutableStateOf<TrackSessionSummary?>(null) }

    Text("Mis seguimientos", style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(6.dp))

    sesiones.forEach { s ->
        FilaSesion(
            sesion = s,
            esLaActual = s.id == idActual,
            onContinuar = { onContinuar(s.id) },
            onReanudar = { onReanudar(s.id) },
            onCompartir = { onCompartir(s.id) },
            onChincheta = { onChincheta(s.id, !s.isPinned) },
            onRenombrar = { renombrando = s },
            onBorrar = { borrando = s },
        )
    }

    renombrando?.let { s ->
        DialogoRenombrar(
            actual = s.title,
            onCancelar = { renombrando = null },
            onAceptar = { nuevo ->
                onRenombrar(s.id, nuevo)
                renombrando = null
            },
        )
    }

    borrando?.let { s ->
        // Borrar es irreversible y mata el enlace que ya pueda tener gente
        // guardado, así que se pregunta. La chincheta no: es reversible.
        AlertDialog(
            onDismissRequest = { borrando = null },
            title = { Text("¿Borrar este seguimiento?") },
            text = {
                Text(
                    "Se borra la ruta del servidor y el enlace deja de funcionar " +
                        "para quien lo tenga guardado. No se puede deshacer.",
                )
            },
            confirmButton = {
                TextButton(onClick = { onBorrar(s.id); borrando = null }) { Text("Borrar") }
            },
            dismissButton = {
                TextButton(onClick = { borrando = null }) { Text("Cancelar") }
            },
        )
    }
}

@Composable
private fun FilaSesion(
    sesion: TrackSessionSummary,
    esLaActual: Boolean,
    onContinuar: () -> Unit,
    onReanudar: () -> Unit,
    onCompartir: () -> Unit,
    onChincheta: () -> Unit,
    onRenombrar: () -> Unit,
    onBorrar: () -> Unit,
) {
    val caducada = TrackingRules.estaCaducada(sesion, System.currentTimeMillis().toDouble())

    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    (if (sesion.isPinned) "📌 " else "") + (sesion.title ?: "Sin nombre"),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(etiquetaEstado(sesion, caducada, esLaActual), style = MaterialTheme.typography.labelSmall)
            }
            sesion.planName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            Text(fecha(sesion.startedAt), style = MaterialTheme.typography.bodySmall)
            sesion.activity?.let {
                Text("${it.emoji} ${it.label}", style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!esLaActual) {
                    // Activa → se puede seguir transmitiendo sin tocar el
                    // backend. Terminada → hay que reabrirla primero, y el
                    // enlace sigue siendo el mismo.
                    if (sesion.isActive) {
                        Button(onClick = onContinuar) { Text("Continuar") }
                    } else if (!caducada) {
                        OutlinedButton(onClick = onReanudar) { Text("Reanudar") }
                    }
                }
                if (!caducada) {
                    OutlinedButton(onClick = onCompartir) { Text("Enlace") }
                }
                OutlinedButton(onClick = onChincheta) {
                    Text(if (sesion.isPinned) "Soltar" else "Fijar")
                }
                OutlinedButton(onClick = onRenombrar) { Text("Renombrar") }
                OutlinedButton(onClick = onBorrar) { Text("Borrar") }
            }
        }
    }
}

private fun etiquetaEstado(
    sesion: TrackSessionSummary,
    caducada: Boolean,
    esLaActual: Boolean,
): String = when {
    esLaActual -> "compartiendo"
    sesion.isActive -> "en marcha"
    caducada -> "caducada"
    else -> "terminada"
}

@Composable
private fun DialogoRenombrar(
    actual: String?,
    onCancelar: () -> Unit,
    onAceptar: (String?) -> Unit,
) {
    var texto by remember { mutableStateOf(actual.orEmpty()) }
    AlertDialog(
        onDismissRequest = onCancelar,
        title = { Text("Nombre del seguimiento") },
        text = {
            Column {
                OutlinedTextField(
                    value = texto,
                    onValueChange = { texto = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Vacío lo devuelve a \"Sin nombre\".",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onAceptar(texto.ifBlank { null }) }) { Text("Guardar") }
        },
        dismissButton = { TextButton(onClick = onCancelar) { Text("Cancelar") } },
    )
}

// ── Mandos previos a compartir ───────────────────────────────────────────────

@Composable
fun SelectorPlan(planes: List<PlanSummary>, elegido: String?, onElige: (String?) -> Unit) {
    if (planes.isEmpty()) return
    Text("Ruta planificada", style = MaterialTheme.typography.titleSmall)
    Text(
        "Al elegir una, la hora de salida y las predicciones van contra el plan.",
        style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(4.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        BotonElegible("Ninguna", elegido == null) { onElige(null) }
        planes.forEach { plan ->
            BotonElegible(plan.name ?: plan.routeName ?: "Sin nombre", elegido == plan.id) {
                onElige(plan.id)
            }
        }
    }
}

/**
 * Los mandos manuales. Tocar cualquiera pasa el perfil a "personalizado": si no,
 * la pantalla enseñaría "Equilibrado" mientras el ritmo real es otro.
 */
@Composable
fun MandosAvanzados(ritmo: TrackingRules.Ritmo, onCambia: (TrackingRules.Ritmo) -> Unit) {
    Text("Ajuste manual", style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(4.dp))

    Text("Modo", style = MaterialTheme.typography.bodySmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        BotonElegible("Por distancia", ritmo.modo == TrackingRules.Modo.DISTANCIA) {
            onCambia(ritmo.copy(modo = TrackingRules.Modo.DISTANCIA))
        }
        BotonElegible("Por tiempo", ritmo.modo == TrackingRules.Modo.TIEMPO) {
            onCambia(ritmo.copy(modo = TrackingRules.Modo.TIEMPO))
        }
    }

    Spacer(Modifier.height(6.dp))
    if (ritmo.modo == TrackingRules.Modo.DISTANCIA) {
        Text("Cada cuántos metros", style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TrackingRules.PASOS_DISTANCIA.forEach { m ->
                BotonElegible("${m.toInt()} m", ritmo.distanciaMetros == m) {
                    onCambia(ritmo.copy(distanciaMetros = m))
                }
            }
        }
    } else {
        Text("Cada cuánto tiempo", style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TrackingRules.PASOS_INTERVALO.forEach { s ->
                BotonElegible(etiquetaIntervalo(s), ritmo.intervaloSegundos == s) {
                    onCambia(ritmo.copy(intervaloSegundos = s))
                }
            }
        }
    }
}

@Composable
fun SelectorRetencion(horas: Double, onElige: (Double) -> Unit) {
    Text("Conservar al finalizar", style = MaterialTheme.typography.titleSmall)
    Text(
        "Cuánto tiempo se podrá consultar la ruta después de terminar " +
            "(o para siempre si la fijas con la chincheta).",
        style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(4.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        TrackingRules.PASOS_RETENCION.forEach { h ->
            BotonElegible(TrackingRules.etiquetaRetencion(h), horas == h) { onElige(h) }
        }
    }
}

@Composable
private fun BotonElegible(texto: String, elegido: Boolean, onClick: () -> Unit) {
    if (elegido) Button(onClick = onClick) { Text(texto) }
    else OutlinedButton(onClick = onClick) { Text(texto) }
}

private fun etiquetaIntervalo(segundos: Double): String =
    if (segundos < 60) "${segundos.toInt()} s" else "${(segundos / 60).toInt()} min"

private fun fecha(epochMs: Double): String =
    SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date(epochMs.toLong()))
