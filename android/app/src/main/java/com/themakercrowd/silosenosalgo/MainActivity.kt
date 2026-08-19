package com.themakercrowd.silosenosalgo

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Punto de entrada. Dos pantallas: entrar, y compartir la posición.
 *
 * De momento es deliberadamente sobria — el mapa en vivo, las notas de campo y
 * el visor incrustado llegan después. Lo que ya tiene que estar bien es el
 * camino de permisos: en Android es lo que decide si el seguimiento sobrevive
 * al bolsillo, y no se puede probar sin salir a la calle con el móvil.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TrackingStore.inicia(this)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // Desde Android 15 (y con targetSdk 35+) las apps se dibujan
                    // de borde a borde por defecto: sin descontar las barras del
                    // sistema, el título queda debajo del reloj y los botones de
                    // abajo, tapados por la barra de navegación.
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) { App() }
                }
            }
        }
    }
}

@Composable
private fun App() {
    val context = LocalContext.current
    val almacenToken = remember { TokenStore(context) }
    var token by remember { mutableStateOf(almacenToken.token) }

    if (token == null) {
        PantallaEntrar(
            onEntrado = { nuevo, usuario ->
                almacenToken.token = nuevo
                // El visor incrustado enseña quién transmite, igual que el que
                // se abre desde el enlace.
                ViewerData.ponUsuario(usuario)
                token = nuevo
            },
        )
    } else {
        PantallaSeguimiento(
            onSalir = {
                almacenToken.clear()
                token = null
            },
        )
    }
}

// ── Entrar ───────────────────────────────────────────────────────────────────

@Composable
private fun PantallaEntrar(onEntrado: (String, String?) -> Unit) {
    val api = remember { Api() }
    val scope = rememberCoroutineScope()
    var usuario by remember { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var trabajando by remember { mutableStateOf(false) }

    /** Entrar y registrarse comparten todo salvo la llamada: el backend
     *  devuelve el mismo tipo y los mismos códigos de error en ambos casos. */
    fun intenta(registrar: Boolean) {
        if (usuario.isBlank() || clave.isBlank()) return
        trabajando = true
        error = null
        scope.launch {
            runCatching {
                if (registrar) api.register(usuario.trim(), clave)
                else api.login(usuario.trim(), clave)
            }.onSuccess { res ->
                trabajando = false
                val t = res.token
                if (t == null) error = "El servidor no devolvió sesión."
                else onEntrado(t, res.user.username)
            }.onFailure { e ->
                trabajando = false
                error = (e as? ApiException)?.message ?: "No se pudo conectar con el servidor."
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("SiLoSeNoSalgo", style = MaterialTheme.typography.headlineMedium)
        Text("Seguimiento · Android", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = usuario,
            onValueChange = { usuario = it },
            label = { Text("Usuario") },
            singleLine = true,
            enabled = !trabajando,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = clave,
            onValueChange = { clave = it },
            label = { Text("Contraseña") },
            singleLine = true,
            enabled = !trabajando,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { intenta(registrar = false) },
            enabled = !trabajando,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (trabajando) CircularProgressIndicator(Modifier.height(18.dp))
            else Text("Entrar")
        }
        TextButton(
            onClick = { intenta(registrar = true) },
            enabled = !trabajando,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Crear cuenta") }
    }
}

// ── Seguimiento ──────────────────────────────────────────────────────────────

@Composable
private fun PantallaSeguimiento(onSalir: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val estado by TrackingStore.estado.collectAsState()
    val sesiones by TrackingStore.sesiones.collectAsState()
    val planes by TrackingStore.planes.collectAsState()
    val notas by TrackingStore.notas.collectAsState()

    var permisoUbicacion by remember { mutableStateOf(TrackingStore.gps.hayPermiso()) }
    var permisoFondo by remember { mutableStateOf(TrackingStore.gps.hayPermisoSegundoPlano()) }
    var titulo by remember { mutableStateOf("") }
    var arrancando by remember { mutableStateOf(false) }
    var viendoMapa by remember { mutableStateOf(false) }

    // El visor a pantalla completa: es un mapa, y en un mapa el espacio es lo
    // único que de verdad importa.
    if (viendoMapa && estado.sessionId != null) {
        Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Mapa en vivo", style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { viendoMapa = false }) { Text("Cerrar") }
            }
            VisorIncrustado(
                sessionId = estado.sessionId!!,
                estado = estado,
                notas = notas,
                modifier = Modifier.fillMaxSize(),
            )
        }
        return
    }

    // El de segundo plano se pide en una SEGUNDA petición, después de conceder
    // el de primer plano. Pedirlos juntos hace que Android rechace la petición
    // en silencio: no sale ningún diálogo y el permiso se queda sin dar.
    val pideFondo = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { permisoFondo = TrackingStore.gps.hayPermisoSegundoPlano() }

    val pideUbicacion = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        permisoUbicacion = TrackingStore.gps.hayPermiso()
        if (permisoUbicacion && !permisoFondo) {
            pideFondo.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    val pideNotificaciones = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    // Sin permiso de notificaciones (Android 13+) el servicio arranca igual,
    // pero su notificación no se ve: el usuario pierde el único indicador de que
    // sigue transmitiendo. Se pide al abrir, no al empezar a compartir.
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pideNotificaciones.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // Si quedó una sesión a medias (el sistema mató la app, se reinstaló, o
        // se reinició el móvil), se retoma al abrir en vez de aparecer como si
        // no se estuviera compartiendo nada mientras el enlace sigue vivo.
        if (!TrackingStore.estado.value.compartiendo && TrackingStore.haySesionGuardada()) {
            TrackingStore.reanudaDesdeDisco()
            if (TrackingStore.gps.hayPermiso()) TrackingService.arranca(context)
        }
        TrackingStore.cargaSesiones()
        TrackingStore.cargaPlanes()
        // El visor se actualiza solo, en segundo plano y al mejor esfuerzo: si
        // no hay build nuevo o falla la red, no pasa nada y se sigue con el que
        // haya (OTA activa, o el empaquetado en el APK).
        runCatching { WebOtaUpdater(context).actualiza() }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Compartir posición", style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = onSalir, enabled = !estado.compartiendo) { Text("Salir") }
        }

        Spacer(Modifier.height(12.dp))

        if (!permisoUbicacion) {
            TarjetaAviso(
                titulo = "Falta el permiso de ubicación",
                cuerpo = "Sin él no se puede seguir la ruta.",
                accion = "Conceder",
                onAccion = {
                    pideUbicacion.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ),
                    )
                },
            )
        } else if (!permisoFondo) {
            TarjetaAviso(
                titulo = "Permitir siempre",
                cuerpo = "Con el permiso solo \"mientras se usa\", el seguimiento se corta " +
                    "al bloquear la pantalla. Hay que elegir \"Permitir siempre\".",
                accion = "Ajustar",
                onAccion = { pideFondo.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
            )
        }

        if (!TrackingStore.gps.ubicacionActivada()) {
            TarjetaAviso(
                titulo = "La ubicación del móvil está apagada",
                cuerpo = "Con el permiso dado pero el GPS apagado no llega ni una posición.",
                accion = "Abrir ajustes",
                onAccion = {
                    context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                },
            )
        }

        if (!sinRestriccionesDeBateria(context)) {
            TarjetaAviso(
                titulo = "Batería sin restricciones",
                cuerpo = "En Samsung (One UI) el sistema mata el seguimiento a las pocas horas " +
                    "si la app sigue optimizada. Es el motivo número uno de trazas cortadas.",
                accion = "Quitar restricción",
                onAccion = { pideSinRestricciones(context) },
            )
        }

        Spacer(Modifier.height(8.dp))

        if (estado.compartiendo) {
            TarjetaEnMarcha(estado)
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { viendoMapa = true },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Ver el mapa") }
            Spacer(Modifier.height(20.dp))
            SeccionNotas(
                notas = notas,
                onAnadir = { texto, tipo, foto, audio ->
                    TrackingStore.anadeNota(texto, tipo, foto, audio)
                },
                onBorrar = { TrackingStore.borraNota(it) },
            )
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { TrackingService.para(context) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Dejar de compartir") }
        } else {
            OutlinedTextField(
                value = titulo,
                onValueChange = { titulo = it },
                label = { Text("Nombre de la ruta (opcional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            SelectorPlan(planes, estado.planId) { TrackingStore.eligePlan(it) }
            Spacer(Modifier.height(16.dp))
            SelectorPerfil(estado.perfil) { TrackingStore.eligePerfil(it) }
            Spacer(Modifier.height(16.dp))
            MandosAvanzados(estado.ritmo) { TrackingStore.ajustaRitmo(it) }
            Spacer(Modifier.height(16.dp))
            SelectorActividad(estado.actividad) { TrackingStore.ajustaActividad(it) }
            Spacer(Modifier.height(16.dp))
            SelectorRetencion(estado.retenerHoras) { TrackingStore.ajustaRetencion(it) }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    arrancando = true
                    scope.launch {
                        TrackingStore.empieza(titulo.ifBlank { null }, actividad = estado.actividad)
                        arrancando = false
                        // El servicio se arranca DESPUÉS de que exista la sesión:
                        // así su notificación ya nace con el enlace y el estado
                        // reales, y nunca se queda una notificación vacía si la
                        // creación falla por falta de cobertura.
                        if (TrackingStore.estado.value.compartiendo) {
                            TrackingService.arranca(context)
                        }
                    }
                },
                enabled = permisoUbicacion && !arrancando,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (arrancando) CircularProgressIndicator(Modifier.height(18.dp))
                else Text("Empezar a compartir")
            }
        }

        estado.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))
        SeccionMapaOffline(
            planId = estado.planId,
            trazaActual = TrackingStore.trazaActual(),
        )

        Spacer(Modifier.height(24.dp))
        SeccionSesiones(
            sesiones = sesiones,
            idActual = estado.sessionId,
            onContinuar = { id ->
                TrackingStore.continuaSesion(id)
                TrackingService.arranca(context)
            },
            onReanudar = { id ->
                scope.launch {
                    TrackingStore.reabreSesion(id)
                    if (TrackingStore.estado.value.compartiendo) TrackingService.arranca(context)
                }
            },
            onCompartir = { id -> comparteEnlace(context, TrackingStore.enlaceDe(id)) },
            onChincheta = { id, fijada -> scope.launch { TrackingStore.fijaSesion(id, fijada) } },
            onRenombrar = { id, titulo -> scope.launch { TrackingStore.renombraSesion(id, titulo) } },
            onBorrar = { id -> scope.launch { TrackingStore.borraSesion(id) } },
        )
    }
}

@Composable
private fun TarjetaEnMarcha(estado: TrackingStore.Estado) {
    val context = LocalContext.current
    val portapapeles = LocalClipboardManager.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(
                if (estado.enEspera) "Preparado, aún sin transmitir" else "Transmitiendo",
                style = MaterialTheme.typography.titleMedium,
            )
            estado.enlace?.let { enlace ->
                Spacer(Modifier.height(4.dp))
                Text(enlace, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { portapapeles.setText(AnnotatedString(enlace)) }) {
                        Text("Copiar")
                    }
                    Button(onClick = { comparteEnlace(context, enlace) }) {
                        Text("Compartir")
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))

            Dato("Enviadas", "${estado.subidas}")
            Dato("En cola", "${estado.pendientes}")
            estado.seguidores?.let { Dato("Siguiendo ahora", "$it") }
            Dato("Puntos de traza", "${estado.puntosTraza}")
            if (estado.notas > 0) Dato("Notas", "${estado.notas}")
            Dato("Recorrido", TrackingRules.formateaDistancia(estado.metrosRecorridos))
            estado.huecoMetros?.let {
                Dato("Retraso de los seguidores", TrackingRules.formateaDistancia(it))
            }
            estado.ultimoEnvioMs?.let { Dato("Último envío", hora(it)) }
            // Gasto MEDIDO, no teórico: es lo que deja decidir en marcha si el
            // perfil elegido llega al final o hay que bajar a "Ahorro".
            estado.gastoBateriaPorHora?.let {
                Dato("Gasto de batería", String.format(Locale.getDefault(), "%.1f %%/h", it))
            }
            estado.horasRestantes?.let {
                Dato("Autonomía estimada", TrackingRules.formateaHoras(it))
            }
            estado.actividadEfectiva?.let {
                Dato(
                    "Movimiento",
                    "${it.emoji} ${it.label}" + if (estado.actividad == null) " (deducido)" else "",
                )
            }
        }
    }
}

@Composable
private fun Dato(etiqueta: String, valor: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(etiqueta, style = MaterialTheme.typography.bodyMedium)
        Text(valor, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SelectorPerfil(actual: TrackingRules.Perfil, onElige: (TrackingRules.Perfil) -> Unit) {
    Text("Ritmo de envío", style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(4.dp))
    FilaPerfil(
        TrackingRules.Perfil.EQUILIBRADO, actual, onElige,
        "Equilibrado", "Por distancia (~100 m). Buena precisión y batería.",
    )
    FilaPerfil(
        TrackingRules.Perfil.AHORRO, actual, onElige,
        "Ahorro · ultra", "Por distancia (~500 m). Parado no gasta batería.",
    )
    FilaPerfil(
        TrackingRules.Perfil.PRECISION, actual, onElige,
        "Alta precisión", "Por tiempo (cada 10 s). Máximo detalle, menos autonomía.",
    )
}

@Composable
private fun FilaPerfil(
    perfil: TrackingRules.Perfil,
    actual: TrackingRules.Perfil,
    onElige: (TrackingRules.Perfil) -> Unit,
    titulo: String,
    detalle: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = actual == perfil, onClick = { onElige(perfil) })
        Column {
            Text(titulo, style = MaterialTheme.typography.bodyLarge)
            Text(detalle, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SelectorActividad(actual: BeaconActivity?, onElige: (BeaconActivity?) -> Unit) {
    Text("Tipo de movimiento", style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(4.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        BotonActividad("Auto", actual == null) { onElige(null) }
        BeaconActivity.entries.forEach { act ->
            BotonActividad(act.emoji, actual == act) { onElige(act) }
        }
    }
}

@Composable
private fun BotonActividad(texto: String, elegido: Boolean, onClick: () -> Unit) {
    if (elegido) Button(onClick = onClick) { Text(texto) }
    else OutlinedButton(onClick = onClick) { Text(texto) }
}

@Composable
private fun TarjetaAviso(titulo: String, cuerpo: String, accion: String, onAccion: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(titulo, style = MaterialTheme.typography.titleSmall)
            Text(cuerpo, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = onAccion) { Text(accion) }
        }
    }
}

/**
 * Abre el selector del sistema para mandar el enlace por donde sea (WhatsApp,
 * Telegram, correo...). Es lo que de verdad se usa: la URL lleva un token largo
 * y nadie la va a teclear. "Copiar" se queda al lado para cuando hay que
 * pegarla en algo que no sale en el selector.
 */
private fun comparteEnlace(context: Context, enlace: String) {
    val envio = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, enlace)
    }
    runCatching { context.startActivity(Intent.createChooser(envio, "Compartir seguimiento")) }
}

// ── Batería ──────────────────────────────────────────────────────────────────

/** ¿Está la app fuera de la optimización de batería? Es lo que en One UI evita
 *  que el sistema mate el seguimiento en una travesía larga. */
private fun sinRestriccionesDeBateria(context: Context): Boolean {
    val pm = ContextCompat.getSystemService(context, PowerManager::class.java) ?: return true
    return pm.isIgnoringBatteryOptimizations(context.packageName)
}

private fun pideSinRestricciones(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:${context.packageName}")),
        )
    }.onFailure {
        // Algunos fabricantes no exponen el diálogo directo; se cae a la lista
        // general, que sí existe siempre.
        runCatching {
            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}

private fun hora(epochMs: Double): String =
    SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(epochMs.toLong()))
