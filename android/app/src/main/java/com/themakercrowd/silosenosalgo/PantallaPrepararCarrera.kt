package com.themakercrowd.silosenosalgo

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * «Preparar la carrera», la noche antes: lo que hace falta para mañana, cada
 * cosa con su arreglo al lado, y dejarla LISTA (ver `PreparacionDeCarrera`). No
 * enciende el GPS ni arma nada: eso se hace por la mañana, al tocar el aviso.
 * Espejo de `PantallaPrepararCarrera` en iOS, con lo que Android pide de más:
 * la batería sin restricciones y las alarmas a su hora.
 */
@Composable
fun PantallaPrepararCarrera(
    ev: EventSummary,
    /** Pedir la ubicación (el mismo lanzador que la pantalla principal). */
    onPideUbicacion: () -> Unit,
    /** Ya es la hora del aviso: armarla ahora mismo. */
    onArmarYa: () -> Unit,
    onCerrar: () -> Unit,
) {
    val context = LocalContext.current
    val salidaMs = ev.startsAt?.takeIf { it > 0.0 }
    var preparada by remember { mutableStateOf(PreparacionDeCarrera.de(context, ev.id)) }
    var avisoMin by remember { mutableIntStateOf(preparada?.avisoMin ?: PreparacionDeCarrera.avisoElegido(context)) }

    // Lo que se comprueba; se repasa al volver de Ajustes.
    var revision by remember { mutableIntStateOf(0) }
    val ubicacion = remember(revision) { TrackingStore.gps.hayPermiso() }
    val siempre = remember(revision) { TrackingStore.gps.hayPermisoSegundoPlano() }
    val avisos = remember(revision) { NotificationManagerCompat.from(context).areNotificationsEnabled() }
    val exactas = remember(revision) { PreparacionDeCarrera.alarmasExactas(context) }
    val sinRestricciones = remember(revision) { sinRestriccionesDeBateria(context) }
    val (bateria, cargando) = remember(revision) { bateria(context) }
    var mapa by remember { mutableStateOf<Double?>(null) }
    var buscandoMapa by remember { mutableStateOf(true) }
    var descargandoMapa by remember { mutableStateOf(false) }

    val ciclo = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) {
        ciclo.repeatOnLifecycle(Lifecycle.State.RESUMED) { revision++ }
    }
    LaunchedEffect(ev.id, descargandoMapa) {
        if (descargandoMapa) return@LaunchedEffect
        buscandoMapa = true
        val ruta = TrackingStore.trazadoDeCarrera(ev)
        mapa = if (ruta == null) null else withContext(Dispatchers.Default) {
            // Hasta el 13: con eso ya se ve por dónde se va (se puede haber
            // bajado con más o menos detalle).
            val teselas = TileMath.teselasDelCorredor(ruta, 800.0, 12, OfmCache.ZOOM_MAX)
            if (teselas.isEmpty()) 0.0
            else OfmCache(context.applicationContext).cuantasHay(teselas).toDouble() / teselas.size
        }
        buscandoMapa = false
    }

    val pideAvisos = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { revision++ }
    var ahora by remember { mutableStateOf(System.currentTimeMillis().toDouble()) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); ahora = System.currentTimeMillis().toDouble() } }
    val tarde = salidaMs != null && salidaMs - avisoMin * 60_000.0 <= ahora

    if (descargandoMapa) {
        // El mismo «Preparar el mapa» de la baliza, con esta carrera elegida.
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("Preparar el mapa", style = MaterialTheme.typography.titleMedium, color = Paleta.slate100)
            Spacer(Modifier.height(10.dp))
            SeccionMapaOffline(planId = null, trazaActual = emptyList(), conEvento = true)
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = { descargandoMapa = false }, modifier = Modifier.fillMaxWidth()) { Text("Volver") }
        }
        return
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(ev.myEmoji ?: "🏁", fontSize = 32.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(ev.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Paleta.slate100)
                Text(cuandoSale(salidaMs), style = MaterialTheme.typography.bodyMedium, color = Paleta.slate400)
            }
            TextButton(onClick = onCerrar) { Text("Cerrar") }
        }
        Spacer(Modifier.height(16.dp))

        Seccion(titulo = "La noche antes", icono = "🌙",
            pie = "Lo que falta se arregla aquí mismo. Nada de esto enciende todavía el GPS.") {
            if (ev.planShareId != null) Item(Estado.HECHO, "Recorrido y cortes", "Los del evento")
            else Item(Estado.AVISO, "Recorrido", "La organización aún no lo ha publicado")
            when {
                buscandoMapa -> Item(Estado.BUSCANDO, "Mapa sin cobertura", "Comprobando…")
                mapa == null -> Item(Estado.AVISO, "Mapa sin cobertura", "Sin recorrido que descargar (o sin red para bajarlo)")
                mapa!! >= 0.95 -> Item(Estado.HECHO, "Mapa sin cobertura", "Descargado")
                else -> Item(Estado.FALTA, "Mapa sin cobertura",
                    if (mapa!! > 0) "Descargado un ${(mapa!! * 100).toInt()} %" else "Para verte en el mapa en la montaña",
                    boton = "Descargar") {
                    if (!TrackingStore.estado.value.compartiendo) TrackingStore.ajustaEvento(ev.id)
                    descargandoMapa = true
                }
            }
            when {
                siempre -> Item(Estado.HECHO, "Ubicación «Todo el tiempo»", "Para seguir con la pantalla apagada")
                !ubicacion -> Item(Estado.FALTA, "Ubicación «Todo el tiempo»", "Sin permiso de ubicación", boton = "Permitir", accion = onPideUbicacion)
                else -> Item(Estado.FALTA, "Ubicación «Todo el tiempo»", "Ahora: solo con la app abierta", boton = "Ajustes") { abreAjustes(context) }
            }
            if (sinRestricciones) Item(Estado.HECHO, "Batería sin restricciones", "El sistema no la duerme en carrera")
            else Item(Estado.FALTA, "Batería sin restricciones", "Si no, el sistema puede parar la baliza", boton = "Quitar") { pideSinRestricciones(context) }
            when {
                !avisos -> Item(Estado.FALTA, "Avisos", "Sin ellos no llega el aviso para armarla", boton = "Permitir") {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) pideAvisos.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else abreAjustes(context)
                }
                !exactas -> Item(Estado.AVISO, "Avisos a su hora", "Ahora pueden llegar con unos minutos de retraso", boton = "Ajustes") {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        runCatching {
                            context.startActivity(
                                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")),
                            )
                        }
                    }
                }
                else -> Item(Estado.HECHO, "Avisos", "El de la mañana y el de la salida")
            }
            when {
                bateria < 0 -> Item(Estado.HECHO, "Batería", "No se puede saber")
                cargando -> Item(Estado.HECHO, "Batería", "Cargando · $bateria %")
                bateria >= 80 -> Item(Estado.HECHO, "Batería", "$bateria %")
                else -> Item(Estado.AVISO, "Batería $bateria %", "Déjalo cargando esta noche")
            }
        }

        Seccion(titulo = "El día de la carrera", icono = "☀️",
            pie = "Te llega un aviso: al tocarlo, la baliza queda armada y sale sola a la hora. " +
                "Mejor así que dejarla armada toda la noche, que el sistema puede dormir la app.") {
            Text("Aviso para armarla", color = Paleta.slate100, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PreparacionDeCarrera.OPCIONES.forEach { m ->
                    val elegido = m == avisoMin
                    Text(
                        if (m % 60 == 0) "${m / 60} h" else if (m > 60) "${m / 60} h ${m % 60}" else "$m min",
                        color = if (elegido) Color.White else Paleta.slate400,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (elegido) Paleta.sky600 else Paleta.slate800)
                            .clickable(enabled = preparada == null) { avisoMin = m }
                            .padding(vertical = 10.dp),
                    )
                }
            }
        }

        Seccion {
            val p = preparada
            when {
                salidaMs == null -> Text(
                    "La carrera no tiene hora de salida todavía: cuando la organización la ponga, podrás prepararla.",
                    color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                )
                p != null -> {
                    Text("✅ Todo listo", color = Paleta.verde, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "A las ${hora(p.avisoMs)} te llega un aviso: tócalo y la baliza queda armada para salir " +
                            "sola a las ${hora(p.salidaMs)}. Si no lo tocas, te volvemos a avisar a las ${hora(p.recordatorioMs)}.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                    )
                    if (tarde) { Spacer(Modifier.height(10.dp)); BotonArmar(salidaMs, onArmarYa) }
                    TextButton(onClick = { PreparacionDeCarrera.olvida(context); preparada = null }) {
                        Text("Quitar la preparación", color = Paleta.rojo)
                    }
                }
                tarde -> BotonArmar(salidaMs) {
                    PreparacionDeCarrera.guarda(context, PreparacionDeCarrera(ev.id, ev.name, salidaMs, avisoMin))
                    onArmarYa()
                }
                else -> Button(
                    onClick = {
                        val nueva = PreparacionDeCarrera(ev.id, ev.name, salidaMs, avisoMin)
                        PreparacionDeCarrera.guarda(context, nueva)
                        preparada = nueva
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White),
                ) { Text("Dejar lista para las ${hora(salidaMs)}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 6.dp)) }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun BotonArmar(salidaMs: Double, onArmar: () -> Unit) {
    Button(
        onClick = onArmar,
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White),
    ) { Text("Armar ya · sale sola a las ${hora(salidaMs)}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 6.dp)) }
}

private enum class Estado { HECHO, FALTA, AVISO, BUSCANDO }

@Composable
private fun Item(e: Estado, titulo: String, detalle: String, boton: String? = null, accion: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        if (e == Estado.BUSCANDO) {
            CircularProgressIndicator(Modifier.width(22.dp).height(22.dp), strokeWidth = 2.dp)
        } else {
            Text(
                when (e) { Estado.HECHO -> "✅"; Estado.FALTA -> "⭕"; else -> "⚠️" },
                fontSize = 18.sp,
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(titulo, color = Paleta.slate100, style = MaterialTheme.typography.bodyLarge)
            Text(detalle, color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
        }
        if (boton != null && accion != null) {
            Button(
                onClick = accion,
                colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 4.dp),
            ) { Text(boton, fontSize = 14.sp) }
        }
    }
}

/**
 * La baliza ARMADA, en grande, arriba de la pestaña: que la mañana de la
 * carrera se vea de un vistazo que está lista, para qué carrera, cuánto falta y
 * con qué batería, y a mano «Salir ya». Espejo de `ListaParaSalir` en iOS.
 */
@Composable
fun ListaParaSalir(estado: TrackingStore.Estado, carrera: EventSummary?, onSalirYa: () -> Unit, onDesarmar: () -> Unit) {
    val context = LocalContext.current
    var ahora by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1_000); ahora = System.currentTimeMillis() } }
    val salida = estado.salidaMs.toLong()
    val falta = ((salida - ahora) / 1000).coerceAtLeast(0)
    val (bateria, _) = remember(ahora / 60_000) { bateria(context) }
    Seccion(pie = "Puedes guardar el móvil: sale sola a su hora, y 5 minutos antes te avisamos por si acaso.") {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("✅ Lista para salir", color = Paleta.verde, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            carrera?.let {
                Text(if (it.myEmoji != null) "${it.myEmoji} ${it.name}" else it.name,
                    color = Paleta.slate100, style = MaterialTheme.typography.titleMedium)
            }
            Text("Sale sola a las ${hora(estado.salidaMs)}", color = Paleta.slate400)
            Text(
                if (falta >= 3600) "%d:%02d:%02d".format(falta / 3600, falta % 3600 / 60, falta % 60)
                else "%02d:%02d".format(falta / 60, falta % 60),
                fontSize = 52.sp, fontWeight = FontWeight.Black, color = Paleta.slate100,
            )
            Text("para la salida" + if (bateria >= 0) " · 🔋 $bateria %" else "", color = Paleta.slate400,
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onSalirYa, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Paleta.sky600, contentColor = Color.White)) {
                Text("Salir ya", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 6.dp))
            }
            TextButton(onClick = onDesarmar) { Text("Desarmar", color = Paleta.slate400) }
        }
    }
}

private fun bateria(context: Context): Pair<Int, Boolean> {
    val bm = context.getSystemService(BatteryManager::class.java) ?: return -1 to false
    val nivel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return (if (nivel in 0..100) nivel else -1) to bm.isCharging
}

private fun abreAjustes(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
        )
    }
}

private fun cuandoSale(ms: Double?): String {
    ms ?: return "Sin hora de salida todavía"
    val cal = java.util.Calendar.getInstance()
    val hoy = cal.get(java.util.Calendar.DAY_OF_YEAR) to cal.get(java.util.Calendar.YEAR)
    cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
    val manana = cal.get(java.util.Calendar.DAY_OF_YEAR) to cal.get(java.util.Calendar.YEAR)
    val c = java.util.Calendar.getInstance().apply { timeInMillis = ms.toLong() }
    val dia = c.get(java.util.Calendar.DAY_OF_YEAR) to c.get(java.util.Calendar.YEAR)
    val cuando = when (dia) {
        hoy -> "hoy"
        manana -> "mañana"
        else -> java.text.SimpleDateFormat("EEE d MMM", java.util.Locale("es", "ES")).format(java.util.Date(ms.toLong()))
    }
    return "$cuando · salida ${hora(ms)}"
}

private fun hora(ms: Double): String =
    java.text.SimpleDateFormat("HH:mm", java.util.Locale("es", "ES")).format(java.util.Date(ms.toLong()))
