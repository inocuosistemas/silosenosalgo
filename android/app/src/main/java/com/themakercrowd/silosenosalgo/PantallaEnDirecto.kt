package com.themakercrowd.silosenosalgo

import android.app.TimePickerDialog
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Una fila de la pestaña «En directo», con el aire de las tarjetas de carrera. */
@Composable
fun FilaEnDirecto(icono: String, titulo: String, texto: String, activa: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Paleta.slate900)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icono, fontSize = 22.sp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(titulo, color = Paleta.slate100, fontWeight = FontWeight.SemiBold)
            Text(texto, color = if (activa) Paleta.sky500 else Paleta.slate400, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        Text("›", color = Paleta.slate400, fontSize = 22.sp)
    }
}

/**
 * La tarjeta del tramo tal como sale en la notificación, dentro de la app: la
 * vista previa antes de empezar y el «cómo va» con la tarjeta en marcha.
 */
@Composable
fun VistaDeTramo(t: DatosTramo) {
    val bmp = remember(t.numero, (t.progreso * 200).toInt()) { NotificacionDeTramo.dibujo(t).asImageBitmap() }
    val hora = { ms: Double -> SimpleDateFormat("HH:mm", Locale("es", "ES")).format(Date(ms.toLong())) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF0F1729)).padding(14.dp)) {
        Text(
            if (t.enMeta) "🏁 En meta" else "Tramo ${t.numero}/${t.deTramos} · hacia ${ReglasDeCarrera.icono(t.hastaTipo)} ${t.hastaNombre}",
            color = Paleta.slate100, fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            buildString {
                append(String.format(Locale("es", "ES"), "%.1f km", t.restanteKm))
                if (t.subidaRestanteM > 0) append(" · ↗ ${t.subidaRestanteM} m")
                t.previsionMs?.let { append(" · llegada ${hora(it)}") }
            },
            color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
        )
        t.corteMs?.let { c ->
            val m = t.margenMin ?: 0.0
            Text(
                "Corte ${hora(c)} · " + (if (m >= 0) "+" else "fuera por ") + "${kotlin.math.abs(m).toInt() / 60} h ${kotlin.math.abs(m).toInt() % 60} min",
                color = when { m >= 30 -> Paleta.verde; m >= 10 -> Paleta.ambar; else -> Paleta.rojo },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(Modifier.height(8.dp))
        Image(bmp, contentDescription = null, contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)))
    }
}

/**
 * «Carrera en directo» con una ruta propia: elegir la ruta y la salida, verla
 * y empezarla; en marcha, cómo va y terminarla. Espejo de
 * `PantallaCarreraEnDirecto` en iOS.
 */
@Composable
fun PantallaCarreraConTrazado(planes: List<PlanSummary>, onCerrar: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val estado by CarreraConTrazado.estado.collectAsState()
    val tramoBaliza by TrackingStore.tramo.collectAsState()
    var planId by remember { mutableStateOf(planes.firstOrNull()?.id) }
    var salidaMs by remember { mutableStateOf<Double?>(null) }   // null = ahora
    var preparando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var vista by remember { mutableStateOf<HojaDeTramos?>(null) }
    var kmVista by remember { mutableStateOf(0f) }
    val hora = { ms: Double -> SimpleDateFormat("HH:mm", Locale("es", "ES")).format(Date(ms.toLong())) }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Carrera en directo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = Paleta.slate100, modifier = Modifier.weight(1f))
            TextButton(onClick = onCerrar) { Text("Cerrar") }
        }
        Spacer(Modifier.height(12.dp))

        when {
            estado.enMarcha -> {
                Seccion(titulo = "En la notificación", icono = "📱") {
                    estado.tramo?.let { VistaDeTramo(it) } ?: Text("Buscando tu posición en la ruta…", color = Paleta.slate400)
                }
                Seccion(titulo = "En marcha", icono = "🏃",
                    pie = "Sigue tu posición con el GPS, sin baliza y sin compartirla con nadie. En meta se queda " +
                        "un rato con tu tiempo y se va sola.") {
                    Dato2("Ruta", estado.nombre)
                    Dato2("Posiciones del GPS", "${estado.posiciones}")
                    estado.ultimaMs?.let { Dato2("La última", hora(it) + (estado.errorM?.let { e -> " · ±${e.toInt()} m" } ?: "")) }
                    if (estado.fueraDeRuta) Dato2("En la ruta", "fuera de ella")
                    else estado.km?.let { Dato2("En la ruta", String.format(Locale("es", "ES"), "km %.1f", it)) }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { CarreraConTrazado.termina(context) }, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Paleta.rojo)) { Text("■ Terminar la tarjeta") }
                }
            }
            tramoBaliza != null -> Seccion {
                Text("📡 La tarjeta de una carrera va con su baliza: se termina al pararla. Para usar aquí una ruta tuya, para antes la baliza.",
                    color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
            }
            else -> {
                Seccion(titulo = "Ruta", icono = "🗺️",
                    pie = "Una de tus rutas, sin carrera. Los tramos van de punto a punto de la ruta; si tiene controles " +
                        "con hora de corte, también dice el margen. No hay vista de corredores: nadie más va por ella.") {
                    if (planes.isEmpty()) {
                        Text("No tienes rutas todavía. Créala en la web, o carga un GPX desde la baliza.",
                            color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
                    }
                    planes.forEach { p ->
                        Row(Modifier.fillMaxWidth().clickable { planId = p.id; vista = null }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = planId == p.id, onClick = { planId = p.id; vista = null })
                            Text(p.name ?: p.routeName ?: "Ruta", color = Paleta.slate100, modifier = Modifier.weight(1f))
                            p.distanceKm?.let { Text(String.format(Locale("es", "ES"), "%.1f km", it), color = Paleta.slate400) }
                        }
                    }
                }
                Seccion(titulo = "Salida", icono = "⏱️",
                    pie = "Con hora, la tarjeta cuenta hasta entonces. La previsión de paso sale del plan de la ruta.") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Boton2("Ahora", salidaMs == null, Modifier.weight(1f)) { salidaMs = null; vista = null }
                        Boton2(salidaMs?.let { "A las ${hora(it)}" } ?: "A una hora", salidaMs != null, Modifier.weight(1f)) {
                            val c = Calendar.getInstance().apply { add(Calendar.HOUR_OF_DAY, 1) }
                            TimePickerDialog(context, { _, h, m ->
                                val elegida = Calendar.getInstance().apply {
                                    set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0)
                                    if (timeInMillis < System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
                                }
                                salidaMs = elegida.timeInMillis.toDouble(); vista = null
                            }, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), true).show()
                        }
                    }
                }
                vista?.let { h ->
                    Seccion(titulo = "Cómo se verá", icono = "👀", pie = "Mueve la barra para recorrer la ruta.") {
                        val km = kmVista.toDouble()
                        val min = ReglasDeCarrera.previsto(km, h) ?: 0.0
                        ReglasDeCarrera.datos(km, h.salida + min * 60_000, emptyList(), h)?.let { VistaDeTramo(it) }
                        Slider(value = kmVista, onValueChange = { kmVista = it }, valueRange = 0f..h.totalKm.toFloat())
                    }
                }
                error?.let { Text(it, color = Paleta.ambar, style = MaterialTheme.typography.bodySmall) }
                Seccion {
                    val p = planes.firstOrNull { it.id == planId }
                    OutlinedButton(
                        onClick = {
                            val id = p?.id ?: return@OutlinedButton
                            preparando = true; error = null
                            scope.launch {
                                runCatching { CarreraConTrazado.hoja(context, id, salidaMs ?: System.currentTimeMillis().toDouble()).first }
                                    .onSuccess { vista = it; kmVista = 0f }
                                    .onFailure { error = it.message ?: "No se ha podido preparar la ruta." }
                                preparando = false
                            }
                        },
                        enabled = p != null && !preparando, modifier = Modifier.fillMaxWidth(),
                    ) { Text("👀 Ver cómo se verá") }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            val plan = p ?: return@Button
                            preparando = true; error = null
                            scope.launch {
                                runCatching {
                                    CarreraConTrazado.empieza(context, plan.id, plan.name ?: plan.routeName ?: "Ruta",
                                        salidaMs ?: System.currentTimeMillis().toDouble())
                                }.onFailure { error = it.message ?: "No se ha podido empezar." }
                                preparando = false
                            }
                        },
                        enabled = p != null && !preparando, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White),
                    ) {
                        if (preparando) { CircularProgressIndicator(Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp, color = Color.White); Spacer(Modifier.width(8.dp)) }
                        Text(if (preparando) "Preparando la ruta…" else "▶ Empezar", modifier = Modifier.padding(vertical = 6.dp))
                    }
                    Text("Hace falta cobertura para empezar (se baja la ruta); después, no.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Dato2(etiqueta: String, valor: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(etiqueta, color = Paleta.slate400, modifier = Modifier.weight(1f))
        Text(valor, color = Paleta.slate100)
    }
}

@Composable
private fun Boton2(texto: String, elegido: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Text(
        texto, color = if (elegido) Color.White else Paleta.slate400, fontWeight = FontWeight.SemiBold,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        modifier = modifier.clip(RoundedCornerShape(10.dp)).background(if (elegido) Paleta.sky600 else Paleta.slate800)
            .clickable(onClick = onClick).padding(vertical = 10.dp),
    )
}
