// `FlowRow` sigue marcada como experimental en esta versión de Compose. Se
// asume a propósito: las filas de botones de aquí (hasta cinco por sesión) TIENEN
// que poder saltar de línea, y la alternativa sin API experimental —una fila con
// desplazamiento horizontal— escondería acciones fuera de pantalla, que en una
// pantalla de móvil estrecha significa que nadie las encuentra.
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
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
    onCopiar: (String) -> Unit,
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
            onCopiar = { onCopiar(s.id) },
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
    onCopiar: () -> Unit,
    onChincheta: () -> Unit,
    onRenombrar: () -> Unit,
    onBorrar: () -> Unit,
) {
    val caducada = TrackingRules.estaCaducada(sesion, System.currentTimeMillis().toDouble())
    var menuAbierto by remember { mutableStateOf(false) }

    // Fila compacta, como en iOS: un renglón de título con sus chips y otro de
    // estado. Todo lo que se hace con la sesión vive en el menú, no en una
    // parrilla de botones — son cosas que se usan de vez en cuando, y sacarlas
    // todas convertía la lista en un muro donde no se distinguía una ruta de
    // otra.
    Card(
        colors = CardDefaults.cardColors(containerColor = Paleta.slate900),
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (sesion.isPinned) {
                        Text("📌", style = MaterialTheme.typography.labelSmall)
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(
                        sesion.title ?: "Sin nombre",
                        style = MaterialTheme.typography.bodyLarge,
                        color = Paleta.slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    sesion.activity?.let {
                        Spacer(Modifier.width(6.dp))
                        Chip("${it.emoji} ${it.label}", Paleta.slate800.copy(alpha = 0.7f), Paleta.slate400)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val (texto, color) = when {
                        esLaActual || sesion.isActive -> "Activo" to Paleta.verde
                        caducada -> "Caducado" to Paleta.ambar
                        else -> "Finalizado" to Paleta.slate700
                    }
                    Chip(texto, color.copy(alpha = 0.25f), Paleta.slate100)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        fecha(sesion.startedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = Paleta.slate400,
                    )
                }
                sesion.planName?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = Paleta.slate400,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Box {
                IconButton(onClick = { menuAbierto = true }) {
                    Text("⋮", style = MaterialTheme.typography.titleMedium, color = Paleta.sky500)
                }
                DropdownMenu(expanded = menuAbierto, onDismissRequest = { menuAbierto = false }) {
                    if (!esLaActual) {
                        // Activa → se puede seguir transmitiendo sin tocar el
                        // backend. Terminada → hay que reabrirla primero, y el
                        // enlace sigue siendo el mismo.
                        if (sesion.isActive) {
                            Opcion("Continuar") { menuAbierto = false; onContinuar() }
                        } else if (!caducada) {
                            Opcion("Reanudar") { menuAbierto = false; onReanudar() }
                        }
                    }
                    Opcion(
                        if (sesion.isPinned) "Quitar chincheta" else "Fijar con chincheta",
                    ) { menuAbierto = false; onChincheta() }
                    Opcion("Renombrar") { menuAbierto = false; onRenombrar() }
                    if (!caducada) {
                        Opcion("Copiar enlace") { menuAbierto = false; onCopiar() }
                        Opcion("Compartir enlace") { menuAbierto = false; onCompartir() }
                    }
                    Opcion("Eliminar") { menuAbierto = false; onBorrar() }
                }
            }
        }
    }
}

@Composable
private fun Opcion(texto: String, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(texto) }, onClick = onClick)
}

/** Etiqueta compacta, como las cápsulas de iOS. */
@Composable
private fun Chip(texto: String, fondo: Color, colorTexto: Color) {
    Box(
        Modifier.clip(RoundedCornerShape(50)).background(fondo)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(texto, style = MaterialTheme.typography.labelSmall, color = colorTexto, maxLines = 1)
    }
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

/**
 * El medidor de almacenamiento. Espejo de `StorageMeterView.swift`.
 *
 * Las fotos y los audios viven en un almacén con poca capacidad, así que hay que
 * avisar ANTES de que se llene: descubrir que no caben las notas a mitad de
 * travesía no tiene arreglo desde el monte. Es de solo lectura; la limpieza se
 * hace borrando notas de seguimientos antiguos.
 */
@Composable
fun MedidorAlmacenamiento(estado: TrackingStore.Estado) {
    val usado = estado.usadoBytes
    val cuota = estado.cuotaBytes

    Text("Almacenamiento de notas", style = MaterialTheme.typography.titleSmall)
    if (usado == null || cuota == null || cuota <= 0) {
        Text("—", style = MaterialTheme.typography.bodySmall)
        return
    }

    val fraccion = (usado.toDouble() / cuota).coerceIn(0.0, 1.0)
    Text(
        "${formateaBytes(usado)} / ${formateaBytes(cuota)}",
        style = MaterialTheme.typography.bodyMedium,
    )
    LinearProgressIndicator(
        progress = { fraccion.toFloat() },
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
    if (fraccion >= 0.8) {
        Text(
            "Queda poco espacio (${(fraccion * 100).toInt()} %). Puedes seguir añadiendo " +
                "notas; si se llena, elimina fotos o audios de seguimientos antiguos.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }

    if (estado.compartiendo) {
        val bytes = TrackingStore.bytesMediosSesion()
        val (fotos, audios) = TrackingStore.cuentaMediosSesion()
        Text(
            if (bytes == 0L) "Esta sesión: sin fotos ni audios todavía."
            else "Esta sesión: ${formateaBytes(bytes)}" + sufijoMedios(fotos, audios),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

private fun sufijoMedios(fotos: Int, audios: Int): String {
    val partes = buildList {
        if (fotos > 0) add(if (fotos == 1) "1 foto" else "$fotos fotos")
        if (audios > 0) add(if (audios == 1) "1 audio" else "$audios audios")
    }
    return if (partes.isEmpty()) "" else " (${partes.joinToString(", ")})"
}

private fun formateaBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024 * 1024 ->
        String.format(Locale.getDefault(), "%.1f GB", bytes / 1024.0 / 1024 / 1024)
    bytes >= 1024L * 1024 ->
        String.format(Locale.getDefault(), "%.1f MB", bytes / 1024.0 / 1024)
    else -> String.format(Locale.getDefault(), "%.0f KB", bytes / 1024.0)
}

// ── Mandos previos a compartir ───────────────────────────────────────────────

@Composable
fun SelectorPlan(planes: List<PlanSummary>, elegido: String?, onElige: (String?) -> Unit) {
    if (planes.isEmpty()) return
    Text(
        "Al elegir una previsión, la hora de salida y las predicciones van contra " +
            "el plan.",
        style = MaterialTheme.typography.bodySmall,
        color = Paleta.slate400,
    )
    Spacer(Modifier.height(6.dp))
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
    var abierto by remember { mutableStateOf(false) }

    TextButton(onClick = { abierto = !abierto }, contentPadding = PaddingValues(0.dp)) {
        Text(if (abierto) "Avanzado ▾" else "Avanzado ▸")
    }
    if (!abierto) return

    Spacer(Modifier.height(4.dp))
    Text("Enviar", style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
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
        Text("Cada cuántos metros", style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TrackingRules.PASOS_DISTANCIA.forEach { m ->
                BotonElegible("${m.toInt()} m", ritmo.distanciaMetros == m) {
                    onCambia(ritmo.copy(distanciaMetros = m))
                }
            }
        }
    } else {
        Text("Cada cuánto tiempo", style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
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
    Text(
        "Conservar la ruta",
        style = MaterialTheme.typography.bodyMedium,
        color = Paleta.slate100,
    )
    Spacer(Modifier.height(6.dp))
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
