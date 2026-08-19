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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
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

    /**
     * El visor se actualiza solo, y se comprueba en CADA vuelta a la app.
     *
     * No basta con mirarlo al crear la pantalla: en una travesía la app se queda
     * abierta días, y con una comprobación única nunca se enteraría de que hay
     * un visor nuevo. Al mejor esfuerzo — si no hay build nuevo o falla la red,
     * se sigue con el que haya (la copia OTA activa, o la del APK).
     */
    override fun onResume() {
        super.onResume()
        lifecycleScope.launch {
            runCatching { WebOtaUpdater(this@MainActivity).actualiza() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TrackingStore.inicia(this)
        setContent {
            TemaSlsns {
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
    val portapapeles = LocalClipboardManager.current

    var permisoUbicacion by remember { mutableStateOf(TrackingStore.gps.hayPermiso()) }
    var permisoFondo by remember { mutableStateOf(TrackingStore.gps.hayPermisoSegundoPlano()) }
    var titulo by remember { mutableStateOf("") }
    var arrancando by remember { mutableStateOf(false) }
    var viendoMapa by remember { mutableStateOf(false) }
    val guias by TrackingStore.guias.collectAsState()
    var guiaEnMapa by remember { mutableStateOf<String?>(null) }
    var avisoGuia by remember { mutableStateOf<String?>(null) }

    // Se acepta cualquier tipo: los `.slsnsguide` no tienen un MIME registrado,
    // así que filtrar por tipo los escondería del selector de archivos.
    val abreGuia = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        avisoGuia = when (val r = TrackingStore.importaGuia(context, uri)) {
            is GuidePackage.Resultado.Bien -> null
            is GuidePackage.Resultado.Mal -> r.rechazo.motivo
        }
    }

    // Una guía se ve en el mismo visor que una ruta propia, pero sin poder
    // anotar sobre ella: es de otra persona y ya está terminada.
    guiaEnMapa?.let { id ->
        PantallaMapaVivo(
            sessionId = id,
            estado = estado,
            notas = emptyList(),
            permiteEditar = false,
            onCerrar = { guiaEnMapa = null; ViewerData.abreGuia(null) },
        )
        return
    }

    // El mapa a pantalla completa, con las notas y la descarga colgando de él
    // (misma navegación que iOS).
    if (viendoMapa && estado.sessionId != null) {
        PantallaMapaVivo(
            sessionId = estado.sessionId!!,
            estado = estado,
            notas = notas,
            onCerrar = { viendoMapa = false },
        )
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
        TrackingStore.refrescaAlmacenamiento()
        TrackingStore.cargaGuias()
    }

    val desplazamiento = rememberScrollState()

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(desplazamiento).padding(20.dp),
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
            Button(
                onClick = { TrackingService.para(context) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Dejar de compartir") }
        } else {
            Seccion(
                titulo = "Actividad",
                pie = "Define cómo ven tu velocidad quienes te siguen y ayuda a " +
                    "descartar saltos de GPS imposibles.",
            ) {
                SelectorActividad(estado.actividad) { TrackingStore.ajustaActividad(it) }
                estado.actividadEfectiva?.takeIf { estado.actividad == null }?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Detectado: ${it.emoji} ${it.label}. Se ajusta según tu velocidad.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Paleta.slate400,
                    )
                }
            }

            Seccion(titulo = "Ruta") {
                OutlinedTextField(
                    value = titulo,
                    onValueChange = { titulo = it },
                    label = { Text("Nombre (opcional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                SelectorPlan(planes, estado.planId) { TrackingStore.eligePlan(it) }
            }

            Seccion(
                titulo = "Modo de seguimiento",
                pie = "El gasto lo manda el GPS, no la frecuencia de envío: por eso " +
                    "ahorrar es pedirle menos al GPS, y parado no gasta.",
            ) {
                SelectorPerfil(estado.perfil) { TrackingStore.eligePerfil(it) }
                Spacer(Modifier.height(12.dp))
                MandosAvanzados(estado.ritmo) { TrackingStore.ajustaRitmo(it) }
            }

            Seccion(
                titulo = "Al finalizar",
                pie = "Cuánto tiempo se podrá consultar la ruta después de terminar " +
                    "(o para siempre si la fijas con la chincheta).",
            ) {
                SelectorRetencion(estado.retenerHoras) { TrackingStore.ajustaRetencion(it) }
            }

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
                            // Al empezar, el formulario desaparece y arriba
                            // queda lo que hace falta: la confirmación de que
                            // está transmitiendo, el enlace y el mapa. Botón de
                            // empezar suele quedar a media pantalla, así que sin
                            // subir se sigue viendo el hueco del formulario y no
                            // se sabe si ha arrancado.
                            desplazamiento.animateScrollTo(0)
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
        avisoGuia?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        // El mapa (y con él las notas y la descarga) solo se ofrece cuando hay
        // sesión: sin ella no hay nada que enseñar ni dónde anclar una nota.
        if (!estado.compartiendo) {
            Spacer(Modifier.height(24.dp))
            SeccionMapaOffline(
                planId = estado.planId,
                trazaActual = TrackingStore.trazaActual(),
            )
        }

        Spacer(Modifier.height(24.dp))
        SeccionGuias(
            guias = guias,
            onImportar = { abreGuia.launch(arrayOf("*/*")) },
            onVer = { guia ->
                ViewerData.abreGuia(guia.id)
                guiaEnMapa = guia.id
            },
            onBorrar = { TrackingStore.borraGuia(it.id) },
        )

        Spacer(Modifier.height(24.dp))
        MedidorAlmacenamiento(estado)

        Spacer(Modifier.height(24.dp))
        SeccionSesiones(
            sesiones = sesiones,
            idActual = estado.sessionId,
            // Continuar y reanudar se pulsan desde la lista, que está al final de
            // la pantalla. Sin subir, la sesión arranca pero se sigue mirando el
            // listado y no hay forma de saber que ha pasado algo.
            onContinuar = { id ->
                TrackingStore.continuaSesion(id)
                TrackingService.arranca(context)
                scope.launch { desplazamiento.animateScrollTo(0) }
            },
            onReanudar = { id ->
                scope.launch {
                    TrackingStore.reabreSesion(id)
                    if (TrackingStore.estado.value.compartiendo) {
                        TrackingService.arranca(context)
                        desplazamiento.animateScrollTo(0)
                    }
                }
            },
            onCompartir = { id -> comparteEnlace(context, TrackingStore.enlaceDe(id)) },
            onCopiar = { id -> portapapeles.setText(AnnotatedString(TrackingStore.enlaceDe(id))) },
            onExportar = { sesion ->
                val fichero = TrackingStore.exportaGuia(context, sesion)
                avisoGuia = if (fichero == null) {
                    "Este seguimiento no tiene traza guardada en este móvil, " +
                        "así que no hay guía que exportar."
                } else {
                    comparteFichero(context, fichero)
                    null
                }
            },
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
    FilaPerfil(
        TrackingRules.Perfil.EQUILIBRADO, actual, onElige,
        "Equilibrado", "Por distancia (~100 m). Buena precisión y batería.",
        "Buena autonomía", Paleta.verde, recomendado = true,
    )
    FilaPerfil(
        TrackingRules.Perfil.AHORRO, actual, onElige,
        "Ahorro · ultra", "Por distancia (~500 m). Parado no gasta batería.",
        "Máxima autonomía", Paleta.verde,
    )
    FilaPerfil(
        TrackingRules.Perfil.PRECISION, actual, onElige,
        "Alta precisión", "Por tiempo (cada 10 s). Máximo detalle.",
        "Menor autonomía", Paleta.ambar,
    )
}

@Composable
private fun FilaPerfil(
    perfil: TrackingRules.Perfil,
    actual: TrackingRules.Perfil,
    onElige: (TrackingRules.Perfil) -> Unit,
    titulo: String,
    detalle: String,
    autonomia: String,
    colorAutonomia: Color,
    recomendado: Boolean = false,
) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onElige(perfil) }.padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = actual == perfil, onClick = { onElige(perfil) })
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(titulo, style = MaterialTheme.typography.bodyLarge, color = Paleta.slate100)
                if (recomendado) {
                    Spacer(Modifier.width(6.dp))
                    // La misma pastilla que iOS: sin ella, tres opciones sin
                    // jerarquía obligan a leérselas todas para empezar a andar.
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(Paleta.sky600.copy(alpha = 0.25f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text(
                            "Recomendado",
                            style = MaterialTheme.typography.labelSmall,
                            color = Paleta.sky500,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            Text(detalle, style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
            Text(autonomia, style = MaterialTheme.typography.labelSmall, color = colorAutonomia)
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
 * Comparte un fichero (la guía `.slsnsguide` recién exportada) por donde sea.
 * Va por el mismo FileProvider que las fotos: pasar un `file://` daría
 * FileUriExposedException desde Android 7.
 */
private fun comparteFichero(context: Context, fichero: java.io.File) {
    runCatching {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.ficheros", fichero)
        val envio = Intent(Intent.ACTION_SEND).apply {
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(envio, "Compartir guía"))
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
