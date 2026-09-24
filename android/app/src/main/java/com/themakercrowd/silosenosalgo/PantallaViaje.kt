package com.themakercrowd.silosenosalgo

import android.location.Geocoder
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Fondos oscuros que casan con la notificación, y un par de claros (como en iOS). */
private val FONDOS = listOf("#0f1729", "#000000", "#1e1b4b", "#052e16", "#450a0a", "#3b0764", "#f8fafc", "#fef3c7")
private val TRAYECTOS = listOf("#0284c7" to "#38bdf8", "#8b5cf6" to "#c084fc", "#f472b6" to "#f59e0b",
    "#10b981" to "#a3e635", "#ef4444" to "#f97316", "#eab308" to "#fde047")

/**
 * «Viaje en directo»: de un sitio a otro, avanzando con el GPS en la
 * notificación. Espejo de `PantallaViaje` en iOS (sin el mapa para afinar el
 * punto ni la ruta por carretera, que allí da Apple Maps).
 */
@Composable
fun PantallaViaje(onCerrar: () -> Unit) {
    val context = LocalContext.current
    val estado by ViajeEnDirecto.estado.collectAsState()
    val borrador = remember { ViajeEnDirecto.leeBorrador(context) }
    var titulo by remember { mutableStateOf(borrador?.titulo ?: "") }
    var origen by remember { mutableStateOf(borrador?.origen) }
    var destino by remember { mutableStateOf(borrador?.destino) }
    var transporte by remember { mutableStateOf(borrador?.transporte ?: TransporteDeViaje.AVION) }
    var colores by remember { mutableStateOf(borrador?.colores ?: ColoresDeViaje()) }
    var paradaMin by remember { mutableStateOf(borrador?.paradaMin ?: 5) }
    var simulado by remember { mutableStateOf(0.35f) }

    val viaje = if (origen != null && destino != null) {
        Viaje(titulo.ifBlank { null }, origen!!, destino!!, transporte, colores, paradaMin)
    } else null
    // Lo que se va eligiendo se guarda al momento, como en iOS.
    LaunchedEffect(viaje) { viaje?.let { ViajeEnDirecto.guardaBorrador(context, it) } }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Viaje en directo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = Paleta.slate100, modifier = Modifier.weight(1f))
            TextButton(onClick = onCerrar) { Text("Cerrar") }
        }
        Spacer(Modifier.height(10.dp))

        // La vista previa: lo de verdad en marcha, o lo que se configura.
        val muestra = when {
            estado.enMarcha -> estado
            viaje != null -> {
                val total = viaje.totalKm
                ViajeEnDirecto.Estado(enMarcha = true, viaje = viaje, restanteKm = total * (1 - simulado),
                    progreso = simulado.toDouble(), llegado = simulado >= 0.99f,
                    llegadaMs = System.currentTimeMillis() + 90 * 60_000.0 * (1 - simulado))
            }
            else -> null
        }
        Seccion(titulo = "En la notificación", icono = "📱") {
            if (muestra != null) {
                val bmp = remember(muestra) { NotificacionDeViaje.dibujo(muestra).asImageBitmap() }
                Image(bmp, null, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)))
                if (!estado.enMarcha) {
                    Slider(value = simulado, onValueChange = { simulado = it })
                    Text("Simulación del recorrido: no es tu posición. Los km son los reales desde ese punto.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
                }
            } else {
                Text("Elige origen y destino para verla.", color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
            }
        }

        if (estado.enMarcha) {
            val hora = { ms: Double -> SimpleDateFormat("HH:mm", Locale("es", "ES")).format(Date(ms.toLong())) }
            Seccion(titulo = "En marcha", icono = "🧭",
                pie = "Puedes cerrar la app: la notificación sigue avanzando con el GPS. Al llegar se marca sola y se quita al rato.") {
                Fila("Quedan", String.format(Locale("es", "ES"), "%.1f km", estado.restanteKm))
                Fila("Hecho", "${(estado.progreso * 100).toInt()} %")
                Fila("Posiciones del GPS", if (estado.descartadas > 0) "${estado.posiciones} buenas · ${estado.descartadas} con mucho error" else "${estado.posiciones}")
                estado.ultimaMs?.let { Fila("La última", hora(it) + (estado.errorM?.let { e -> " · ±${e.toInt()} m" } ?: "")) }
                estado.paradoDesdeMs?.let { Fila("Parado cerca del destino", "desde las ${hora(it)}") }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { ViajeEnDirecto.termina(context) }, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Paleta.rojo)) { Text("■ Terminar el viaje") }
            }
            return@Column
        }

        Seccion(titulo = "Título", icono = "🏷️") {
            OutlinedTextField(titulo, { titulo = it }, placeholder = { Text("Viaje a Japón") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        Seccion(titulo = "De dónde a dónde", icono = "📍",
            pie = "Busca una ciudad, un aeropuerto o una dirección. El código de tres letras es lo que sale en grande.") {
            CampoDeLugar("Origen", origen, permiteAqui = true) { origen = it }
            Spacer(Modifier.height(12.dp))
            CampoDeLugar("Destino", destino, permiteAqui = false) { destino = it }
        }
        Seccion(titulo = "Cómo", icono = "🚀") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                TransporteDeViaje.entries.forEach { t ->
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(10.dp))
                            .background(if (t == transporte) Paleta.sky600 else Paleta.slate800)
                            .clickable { transporte = t }.padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(t.emoji, fontSize = 20.sp) }
                }
            }
            Text(transporte.nombre + if (transporte == TransporteDeViaje.AVION) " · la tarjeta dibuja el vuelo en semicírculo" else "",
                color = Paleta.slate400, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
        }
        Seccion(titulo = "Colores", icono = "🎨",
            pie = "El texto se pone solo, claro u oscuro según el fondo.") {
            Text("Fondo", color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                FONDOS.forEach { f ->
                    Muestra(f, f == colores.fondo) { colores = colores.copy(fondo = f) }
                }
            }
            Text("Trayecto", color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                TRAYECTOS.forEach { (a, b) ->
                    Muestra(a, a == colores.trayecto, b) { colores = colores.copy(trayecto = a, trayecto2 = b) }
                }
            }
        }
        Seccion(titulo = "Al llegar", icono = "🏁",
            pie = "Con buena señal, se llega a 100 m del destino. Si aparcas o te bajas algo más lejos, estar parado este rato cerca también cuenta como llegado: se marca y se apaga el GPS.") {
            Text("Parado cerca del destino", color = Paleta.slate100)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                listOf(0, 2, 5, 10, 15, 30).forEach { m ->
                    Text(if (m == 0) "Nunca" else "$m min", textAlign = TextAlign.Center, fontSize = 13.sp,
                        color = if (m == paradaMin) Color.White else Paleta.slate400,
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(10.dp))
                            .background(if (m == paradaMin) Paleta.sky600 else Paleta.slate800)
                            .clickable { paradaMin = m }.padding(vertical = 10.dp))
                }
            }
        }
        Seccion {
            Button(
                onClick = { viaje?.let { ViajeEnDirecto.empieza(context, it) } },
                enabled = viaje != null, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White),
            ) { Text("▶ Empezar ahora", modifier = Modifier.padding(vertical = 6.dp)) }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Fila(etiqueta: String, valor: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(etiqueta, color = Paleta.slate400, modifier = Modifier.weight(1f))
        Text(valor, color = Paleta.slate100)
    }
}

@Composable
private fun Muestra(hex: String, elegida: Boolean, hex2: String? = null, onClick: () -> Unit) {
    val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.Gray)
    val c2 = hex2?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }
    Box(
        Modifier.size(32.dp).clip(CircleShape)
            .background(if (c2 != null) androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(c, c2)) else androidx.compose.ui.graphics.SolidColor(c))
            .border(if (elegida) 3.dp else 1.dp, if (elegida) Color.White else Paleta.slate700, CircleShape)
            .clickable(onClick = onClick),
    )
}

/**
 * Un extremo del viaje: buscar el sitio (con el geocodificador del sistema),
 * o, para el origen, «aquí» con la última posición conocida. Luego el nombre y
 * el código se pueden cambiar a mano.
 */
@Composable
private fun CampoDeLugar(etiqueta: String, lugar: LugarDeViaje?, permiteAqui: Boolean, onElige: (LugarDeViaje?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busqueda by remember { mutableStateOf("") }
    var resultados by remember { mutableStateOf<List<LugarDeViaje>>(emptyList()) }
    var buscando by remember { mutableStateOf(false) }

    Text(etiqueta.uppercase(), color = Paleta.slate400, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    if (lugar != null) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            OutlinedTextField(lugar.abreviatura, { onElige(lugar.copy(abreviatura = it.uppercase().take(4))) },
                singleLine = true, modifier = Modifier.width(96.dp))
            Spacer(Modifier.width(8.dp))
            OutlinedTextField(lugar.nombre, { onElige(lugar.copy(nombre = it)) }, singleLine = true, modifier = Modifier.weight(1f))
        }
        TextButton(onClick = { onElige(null) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Cambiar") }
        return
    }
    OutlinedTextField(busqueda, { busqueda = it }, placeholder = { Text("Buscar…") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
    LaunchedEffect(busqueda) {
        if (busqueda.length < 3) { resultados = emptyList(); return@LaunchedEffect }
        delay(400)
        buscando = true
        resultados = withContext(Dispatchers.IO) {
            runCatching {
                @Suppress("DEPRECATION")
                Geocoder(context, Locale("es", "ES")).getFromLocationName(busqueda, 5).orEmpty().map { a ->
                    val nombre = a.featureName?.takeIf { it.any(Char::isLetter) } ?: a.locality ?: busqueda
                    LugarDeViaje(nombre, abreviatura(nombre), a.latitude, a.longitude)
                }
            }.getOrDefault(emptyList())
        }
        buscando = false
    }
    if (buscando) Text("Buscando…", color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
    resultados.forEach { r ->
        Text("${r.nombre}  ·  ${String.format(Locale.US, "%.3f, %.3f", r.lat, r.lon)}", color = Paleta.sky500,
            modifier = Modifier.fillMaxWidth().clickable { onElige(r); busqueda = "" }.padding(vertical = 8.dp))
    }
    if (permiteAqui) {
        TextButton(onClick = {
            scope.launch {
                val loc = TrackingStore.gps.ultimaConocida()
                if (loc != null) onElige(LugarDeViaje("Aquí", "AQU", loc.latitude, loc.longitude))
            }
        }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("📍 Desde donde estoy") }
    }
}

/** Tres letras del nombre, en mayúsculas y sin acentos: «Barcelona» → BAR. */
private fun abreviatura(nombre: String): String =
    java.text.Normalizer.normalize(nombre, java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{M}"), "").filter { it.isLetter() }.take(3).uppercase()
