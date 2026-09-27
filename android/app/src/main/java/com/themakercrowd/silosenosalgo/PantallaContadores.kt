package com.themakercrowd.silosenosalgo

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private fun colorDe(hex: String) = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF8B5CF6))

private fun cuandoEs(c: Contador): String {
    val f = SimpleDateFormat(if (c.conHora) "EEE d MMM yyyy · HH:mm" else "EEE d MMM yyyy", Locale("es", "ES"))
    return f.format(Date(c.fechaVigente().toLong())) + if (c.anual) " · cada año" else ""
}

/** Una cuenta atrás como sale en el widget, en pequeño: para las listas. */
@Composable
fun MiniaturaContador(c: Contador, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val foto = remember(c.foto) {
        c.foto?.let { f ->
            val fichero = if (f.startsWith("/")) File(f) else File(Contadores.dirFotos(context), f)
            runCatching { BitmapFactory.decodeFile(fichero.path, BitmapFactory.Options().apply { inSampleSize = 4 })?.asImageBitmap() }.getOrNull()
        }
    }
    val (dias, _) = c.diasYCorte()
    Box(modifier.size(64.dp).clip(RoundedCornerShape(14.dp))
        .background(Brush.linearGradient(listOf(colorDe(c.color), c.color2?.let { colorDe(it) } ?: colorDe(c.color).copy(alpha = 0.5f))))) {
        foto?.let { Image(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        Text(if (c.fechaVigente() > System.currentTimeMillis()) "$dias" else "¡Ya!", color = Color.White, fontWeight = FontWeight.Black,
            fontSize = 22.sp, modifier = Modifier.align(Alignment.Center))
    }
}

/**
 * «Cuenta atrás y widget»: las de tus carreras (salen solas) y las tuyas, para
 * añadir, cambiar o quitar. Espejo de `ContadoresView` en iOS.
 */
@Composable
fun PantallaContadores(onCerrar: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { Contadores.lee(context) }
    val lista by Contadores.lista.collectAsState()
    var editando by remember { mutableStateOf<Contador?>(null) }

    editando?.let { c ->
        EditorDeContador(c, onCerrar = { editando = null })
        return
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cuenta atrás", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = Paleta.slate100, modifier = Modifier.weight(1f))
            TextButton(onClick = onCerrar) { Text("Cerrar") }
        }
        Spacer(Modifier.height(10.dp))
        Seccion(titulo = "En la pantalla de inicio", icono = "📲",
            pie = "Mantén pulsada la pantalla de inicio ▸ Widgets ▸ SiLoSeNoSalgo. Enseña la próxima cuenta atrás, " +
                "o la que elijas al ponerlo. Puedes poner varios, cada uno con la suya.") {
            Text("El widget cuenta solo, con el reloj corriendo, y va pasando a la siguiente cuando una llega.",
                color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
        }
        val deCarrera = lista.filter { it.deCarrera }
        if (deCarrera.isNotEmpty()) {
            Seccion(titulo = "Tus carreras", icono = "🏁",
                pie = "La fecha y el nombre los pone la carrera: si la organización mueve la salida, la cuenta atrás se mueve con ella. Aquí eliges cómo se ve.") {
                deCarrera.sortedBy { it.fechaMs }.forEach { c -> FilaContador(c) { editando = c } }
            }
        }
        Seccion(titulo = "Las tuyas", icono = "⏳") {
            lista.filter { !it.deCarrera }.sortedBy { it.fechaVigente() }.forEach { c -> FilaContador(c) { editando = c } }
            TextButton(onClick = {
                editando = Contador(nombre = "", fechaMs = System.currentTimeMillis() + 30 * 86_400_000.0, conHora = false,
                    color = Contadores.COLORES.random())
            }) { Text("➕ Añadir una cuenta atrás") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun FilaContador(c: Contador, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        MiniaturaContador(c)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(listOfNotNull(c.emoji, c.nombre.ifBlank { "Sin nombre" }).joinToString(" "), color = Paleta.slate100, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(cuandoEs(c), color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
        }
        Text("›", color = Paleta.slate400, fontSize = 22.sp)
    }
}

@Composable
private fun EditorDeContador(original: Contador, onCerrar: () -> Unit) {
    val context = LocalContext.current
    var c by remember { mutableStateOf(original) }
    val nuevo = remember { Contadores.lee(context).none { it.id == original.id } }
    val eligeFoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        // Se guarda reducida: el widget la recorta a su tamaño al pintarse.
        val nombre = "${c.id}-${System.currentTimeMillis()}.jpg"
        runCatching {
            val bmp = Imagen.deUri(context, uri, 1400) ?: return@runCatching
            val escala = minOf(1f, 1400f / maxOf(bmp.width, bmp.height))
            val red = android.graphics.Bitmap.createScaledBitmap(bmp, (bmp.width * escala).toInt(), (bmp.height * escala).toInt(), true)
            File(Contadores.dirFotos(context), nombre).outputStream().use { red.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, it) }
            c = c.copy(foto = nombre, usaCartel = false, aspectoPropio = true)
        }
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onCerrar) { Text("Cancelar") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { Contadores.guardaUno(context, c); onCerrar() }, enabled = c.nombre.isNotBlank()) { Text("Guardar") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { MiniaturaContador(c, Modifier.size(120.dp)) }
        Spacer(Modifier.height(12.dp))
        Seccion(titulo = "Qué", icono = "✏️") {
            if (c.deCarrera) Text(c.nombre, color = Paleta.slate100, fontWeight = FontWeight.SemiBold)
            else OutlinedTextField(c.nombre, { c = c.copy(nombre = it) }, placeholder = { Text("Viaje a Japón") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(c.emoji ?: "", { c = c.copy(emoji = it.take(4).ifBlank { null }, aspectoPropio = true) },
                label = { Text("Emoji") }, singleLine = true, modifier = Modifier.width(120.dp))
        }
        if (!c.deCarrera) {
            Seccion(titulo = "Cuándo", icono = "📅") {
                Text(cuandoEs(c), color = Paleta.slate100)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                    OutlinedButton(onClick = {
                        val cal = Calendar.getInstance().apply { timeInMillis = c.fechaMs.toLong() }
                        DatePickerDialog(context, { _, y, m, d ->
                            cal.set(y, m, d); c = c.copy(fechaMs = cal.timeInMillis.toDouble())
                        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
                    }) { Text("Día") }
                    if (c.conHora) OutlinedButton(onClick = {
                        val cal = Calendar.getInstance().apply { timeInMillis = c.fechaMs.toLong() }
                        TimePickerDialog(context, { _, h, mi ->
                            cal.set(Calendar.HOUR_OF_DAY, h); cal.set(Calendar.MINUTE, mi); cal.set(Calendar.SECOND, 0)
                            c = c.copy(fechaMs = cal.timeInMillis.toDouble())
                        }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).show()
                    }) { Text("Hora") }
                }
                Interruptor("Con hora", c.conHora) {
                    val cal = Calendar.getInstance().apply { timeInMillis = c.fechaMs.toLong(); if (!it) { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0) } }
                    c = c.copy(conHora = it, fechaMs = cal.timeInMillis.toDouble())
                }
                Interruptor("Cada año", c.anual) { c = c.copy(anual = it) }
            }
        }
        Seccion(titulo = "Cómo se ve", icono = "🎨") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Contadores.COLORES.take(8).forEach { hex ->
                    Box(Modifier.size(30.dp).clip(CircleShape).background(colorDe(hex))
                        .border(if (hex == c.color) 3.dp else 0.dp, Color.White, CircleShape)
                        .clickable { c = c.copy(color = hex, color2 = null, aspectoPropio = true) })
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { eligeFoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Text(if (c.foto != null && !c.usaCartel) "Cambiar la foto" else "Poner una foto")
                }
                if (c.foto != null) TextButton(onClick = { c = c.copy(foto = null, usaCartel = false, aspectoPropio = true) }) { Text("Sin foto") }
            }
            if (c.deCarrera && c.usaCartel) Text("De fondo va el cartel de la carrera.", color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
        }
        Seccion(titulo = "Al llegar", icono = "🏁") {
            Interruptor("Seguir contando hacia arriba", c.alPasar == "contarArriba") { c = c.copy(alPasar = if (it) "contarArriba" else "ocultar") }
            Interruptor("Avisarme ese día", c.aviso) { c = c.copy(aviso = it) }
        }
        if (!nuevo && !c.deCarrera) {
            OutlinedButton(onClick = { Contadores.borra(context, c.id); onCerrar() }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Paleta.rojo)) { Text("Borrar esta cuenta atrás") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Interruptor(texto: String, valor: Boolean, onCambia: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(texto, color = Paleta.slate100, modifier = Modifier.weight(1f))
        Switch(valor, onCambia)
    }
}

/**
 * Al poner el widget (o al volver a configurarlo): cuál enseña, la próxima o
 * una en concreto.
 */
class ConfiguraWidgetActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        val lista = Contadores.ordenados(Contadores.lee(this))
        enableEdgeToEdge()
        setContent {
            TemaSlsns {
                Surface(Modifier.fillMaxSize(), color = Paleta.slate950) {
                    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp)) {
                        Text("¿Qué cuenta atrás enseña?", style = MaterialTheme.typography.titleLarge, color = Paleta.slate100, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(16.dp))
                        Opcion("⏭️  La siguiente que venza", "Cuando vence, pasa sola a la siguiente") { elige(widgetId, WidgetCuentaAtras.LA_PROXIMA) }
                        lista.forEach { c ->
                            Opcion(listOfNotNull(c.emoji, c.nombre).joinToString("  "), cuandoEs(c)) { elige(widgetId, c.id) }
                        }
                        if (lista.isEmpty()) {
                            Text("Aún no hay cuentas atrás: las de tus carreras salen solas, y las tuyas se añaden en la app (En directo ▸ Cuenta atrás).",
                                color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }

    private fun elige(widgetId: Int, contadorId: String) {
        WidgetCuentaAtras.elige(this, widgetId, contadorId)
        WidgetCuentaAtras.pinta(this, AppWidgetManager.getInstance(this), widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    @Composable
    private fun Opcion(titulo: String, detalle: String, onClick: () -> Unit) {
        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(Paleta.slate900)
            .clickable(onClick = onClick).padding(14.dp)) {
            Text(titulo, color = Paleta.slate100, fontWeight = FontWeight.SemiBold)
            Text(detalle, color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
        }
    }
}
