@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
                // El fondo tiene que ser el MÁS oscuro de la paleta, no el de
                // las tarjetas: `Surface` sin color coge `colorScheme.surface`,
                // que aquí es el mismo `slate900` de las secciones, y entonces
                // no se distinguen — la pantalla entera se ve plana.
                Surface(modifier = Modifier.fillMaxSize(), color = Paleta.slate950) {
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
    var usuario by remember { mutableStateOf<String?>(null) }

    // Al volver a abrir la app con la sesión ya guardada no se pasa por el
    // login, así que el nombre no lo sabe nadie: se le pregunta al backend. Al
    // mejor esfuerzo — sin cobertura la pantalla funciona igual, solo que sin
    // nombre debajo del título.
    LaunchedEffect(token) {
        val t = token ?: return@LaunchedEffect
        if (usuario != null) return@LaunchedEffect
        runCatching { Api().me(t) }.getOrNull()?.username?.let {
            usuario = it
            ViewerData.ponUsuario(it)
        }
    }

    if (token == null) {
        PantallaEntrar(
            onEntrado = { nuevo, quien ->
                almacenToken.token = nuevo
                // El visor incrustado enseña quién transmite, igual que el que
                // se abre desde el enlace.
                ViewerData.ponUsuario(quien)
                usuario = quien
                token = nuevo
            },
        )
    } else {
        PantallaSeguimiento(
            usuario = usuario,
            onSalir = {
                almacenToken.clear()
                usuario = null
                token = null
            },
        )
    }
}

// ── Entrar ───────────────────────────────────────────────────────────────────

@Composable
private fun PantallaEntrar(onEntrado: (String, String?) -> Unit) {
    val context = LocalContext.current
    val api = remember { Api() }
    val scope = rememberCoroutineScope()
    var usuario by remember { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var trabajando by remember { mutableStateOf(false) }

    fun intenta() {
        if (usuario.isBlank() || clave.isBlank()) return
        trabajando = true
        error = null
        scope.launch {
            runCatching {
                api.login(usuario.trim(), clave)
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
            onClick = { intenta() },
            enabled = !trabajando,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (trabajando) CircularProgressIndicator(Modifier.height(18.dp))
            else Text("Entrar")
        }

        // Aquí había un botón de "Crear cuenta" que NO podía funcionar: el alta
        // es solo por invitación y el backend rechaza cualquier registro sin un
        // código válido (400 antes de mirar nada más). Prometer una cuenta y dar
        // un error sin explicación es peor que no ofrecerla, sobre todo cuando
        // el que lo intenta acaba de instalar la app y no sabe si el fallo es
        // suyo, de la contraseña o de la red.
        Spacer(Modifier.height(20.dp))
        Text(
            "Las cuentas se crean por invitación, y solo desde la web: quien " +
                "administra genera un enlace y con él se elige usuario y contraseña. " +
                "Aquí solo se entra con una cuenta que ya exista.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(
            onClick = {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Config.PUBLIC_URL)))
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Abrir la web") }
    }
}

// ── Seguimiento ──────────────────────────────────────────────────────────────

@Composable
private fun PantallaSeguimiento(usuario: String?, onSalir: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val estado by TrackingStore.estado.collectAsState()
    val sesiones by TrackingStore.sesiones.collectAsState()
    val planes by TrackingStore.planes.collectAsState()
    val eventos by TrackingStore.eventos.collectAsState()
    val notas by TrackingStore.notas.collectAsState()
    val portapapeles = LocalClipboardManager.current

    var permisoUbicacion by remember { mutableStateOf(TrackingStore.gps.hayPermiso()) }
    var permisoFondo by remember { mutableStateOf(TrackingStore.gps.hayPermisoSegundoPlano()) }
    var titulo by remember { mutableStateOf("") }
    var arrancando by remember { mutableStateOf(false) }
    /** La otra baliza viva de esta cuenta, mientras se pregunta si relevarla. */
    var relevo by remember { mutableStateOf<TrackSessionSummary?>(null) }
    val hayRed by Conectividad.online.collectAsState()
    LaunchedEffect(Unit) { Conectividad.inicia(context) }
    /** La nota que quedó si a ESTE móvil le quitaron la baliza. */
    val notaRelevo by TrackingStore.notaRelevo0.collectAsState()
    var viendoMapa by remember { mutableStateOf(false) }
    var descargandoMapa by remember { mutableStateOf(false) }
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
        TrackingStore.cargaEventos()
        TrackingStore.refrescaAlmacenamiento()
        TrackingStore.cargaGuias()
    }

    val desplazamiento = rememberScrollState()
    var refrescando by remember { mutableStateOf(false) }
    var confirmandoSalida by remember { mutableStateOf(false) }

    // Arrastrar hacia abajo refresca, como en iOS: recoge lo hecho en otro
    // sitio (una previsión recién creada en la web) sin salir de la pantalla.
    PullToRefreshBox(
        isRefreshing = refrescando,
        onRefresh = {
            refrescando = true
            scope.launch {
                TrackingStore.cargaPlanes()
                TrackingStore.cargaEventos()
                TrackingStore.cargaSesiones()
                TrackingStore.refrescaAlmacenamiento()
                refrescando = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(desplazamiento).padding(20.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Baliza", style = MaterialTheme.typography.headlineSmall)
                // El usuario debajo, no en el título: en iOS el título ES el
                // nombre, y saber de quién es la baliza importa —el enlace que
                // se comparte lleva ese nombre— pero no es el asunto de la
                // pantalla.
                usuario?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
                }
            }
            // Se pregunta antes de salir, como en iOS: al lado del título es
            // fácil rozarlo, y en marcha además hay que detener la baliza.
            TextButton(onClick = { confirmandoSalida = true }) { Text("Salir") }
        }

        Spacer(Modifier.height(20.dp))

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

        // El orden de aquí abajo es el de `ios/Sources/TrackingView.swift`, y no
        // por copiar: allí lo primero es SI está transmitiendo, no los números.
        // Al abrir la app en marcha lo que se busca saber es "¿sigue?", y el
        // enlace y las estadísticas solo se miran cuando ya se sabe que sí.
        // TODO lo del directo va junto y arriba: si está transmitiendo, las
        // cifras, el enlace y el mapa. Aquí nos separamos de iOS a propósito
        // —allí el enlace y las cifras viven al final—, porque en marcha esta
        // pantalla se abre para mirar cómo va, y repartir esa información entre
        // el principio y el final obliga a recorrerla entera cada vez.
        // Si hay red o no. Va ARRIBA porque explica media pantalla: las
        // previsiones, los eventos y los seguimientos viven en el servidor, asi
        // que sin cobertura salen vacios y sin este aviso parece que no tienes
        // nada. Solo aparece cuando falta.
        if (!hayRed) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Paleta.ambar.copy(alpha = 0.12f))
                    .padding(10.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text("📵", modifier = Modifier.padding(end = 8.dp))
                Text(
                    "Sin conexión. Lo que ves es lo guardado en el móvil: las listas del servidor no se " +
                        "pueden consultar. La baliza SÍ funciona — las posiciones se guardan y se envían al " +
                        "recuperar cobertura.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paleta.ambar,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
        }

        // Meta. No se para la baliza sola —hay quien sigue andando hasta el
        // coche, y cortarle la traza seria decidir por el— pero se dice y se
        // ofrece el boton, que es lo que se busca al cruzar el arco.
        if (estado.compartiendo && estado.enMeta) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Paleta.verde.copy(alpha = 0.12f))
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🏁", modifier = Modifier.padding(end = 8.dp))
                Text(
                    "Has llegado al final del recorrido.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paleta.verde,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { TrackingService.para(context) }) { Text("Terminar") }
            }
            Spacer(Modifier.height(8.dp))
        }

        // Con qué se está emitiendo. Un aviso, no un error: la baliza funciona,
        // pero con treinta metros de error y sin velocidad, y por fuera no se
        // nota. Quien lo lee puede encender el GPS y arreglarlo en diez
        // segundos; sin el aviso se entera al ver la traza al día siguiente.
        if (estado.compartiendo && (estado.porRed || estado.sinPrecision)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Paleta.ambar.copy(alpha = 0.12f))
                    .padding(10.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text("📡", modifier = Modifier.padding(end = 8.dp))
                Text(
                    if (estado.sinPrecision) {
                        "Esta app solo tiene ubicación APROXIMADA: las posiciones salen con cientos de " +
                            "metros de error. Dale permiso de ubicación precisa en los ajustes del sistema."
                    } else {
                        "Emitiendo por red y no por GPS: las posiciones traen ~30 m de error y sin " +
                            "velocidad. Enciende la ubicación por GPS (o el modo de alta precisión)."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = Paleta.ambar,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
        }

        // Por qué esta baliza dejó de emitir, si fue otro móvil el que se la
        // llevó. Con su botón de descartar: quien coge este teléfono más tarde
        // se encuentra la baliza apagada y lo primero que necesita es la razón.
        notaRelevo?.let { nota ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Paleta.ambar.copy(alpha = 0.12f))
                    .padding(10.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text("🔀", modifier = Modifier.padding(end = 8.dp))
                Text(nota, style = MaterialTheme.typography.bodySmall, color = Paleta.ambar, modifier = Modifier.weight(1f))
                TextButton(onClick = { TrackingStore.descartaNotaRelevo() }) { Text("✕") }
            }
            Spacer(Modifier.height(8.dp))
        }

        // Otra baliza de la misma cuenta está viva: se pregunta antes de
        // quitársela. Solo puede haber una por cuenta —una persona está en un
        // sitio— pero el relevo tiene que ser una decisión, no una sorpresa.
        relevo?.let { otra ->
            AlertDialog(
                onDismissRequest = { relevo = null },
                title = { Text("Ya tienes una baliza en marcha") },
                text = {
                    Text(
                        "«${TrackingStore.nombreDeSesion(otra)}» está emitiendo desde otro " +
                            "dispositivo. Solo puede haber una baliza por cuenta: si sigues, esa se desarma " +
                            "y esta toma el relevo.",
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        val elegida = otra
                        relevo = null
                        arrancando = true
                        scope.launch {
                            TrackingStore.empieza(titulo.ifBlank { null }, actividad = estado.actividad)
                            arrancando = false
                            if (TrackingStore.estado.value.compartiendo) TrackingService.arranca(context)
                            // `elegida` solo se usa para el texto; el servidor ya
                            // cierra la anterior al crear esta.
                            check(elegida.id.isNotEmpty())
                        }
                    }) { Text("Pasarla a este móvil") }
                },
                dismissButton = { TextButton(onClick = { relevo = null }) { Text("Cancelar") } },
            )
        }

        EstadoCompacto(
            estado = estado,
            arrancando = arrancando,
            hayPermiso = permisoUbicacion,
            onParar = { TrackingService.para(context) },
            onEmpezar = {
                arrancando = true
                scope.launch {
                    // ¿Hay otra baliza viva en esta cuenta? Se pregunta antes de
                    // quitársela: el servidor cierra la anterior sin avisar, y
                    // "acabo de dejar mudo el otro móvil" no se deshace con un
                    // botón de atrás.
                    val otra = TrackingStore.otraBalizaViva()
                    if (otra != null) {
                        relevo = otra
                        arrancando = false
                        return@launch
                    }
                    TrackingStore.empieza(titulo.ifBlank { null }, actividad = estado.actividad)
                    arrancando = false
                    // El servicio se arranca DESPUÉS de que exista la sesión:
                    // así su notificación nace con el enlace y el estado reales,
                    // y nunca queda una notificación vacía si la creación falla
                    // por falta de cobertura.
                    if (TrackingStore.estado.value.compartiendo) TrackingService.arranca(context)
                }
            },
        )

        if (estado.compartiendo) {
            Seccion(titulo = "En directo") { DatosDeLaSesion(estado) }
        }

        if (estado.compartiendo) {
            estado.enlace?.let { enlace ->
                Seccion(titulo = "Enlace para compartir") {
                    Text(enlace, style = MaterialTheme.typography.bodySmall, color = Paleta.slate400)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { portapapeles.setText(AnnotatedString(enlace)) }) {
                            Text("Copiar")
                        }
                        Button(onClick = { comparteEnlace(context, enlace) }) { Text("Compartir") }
                    }
                }
            }

            // El botón va suelto, sin tarjeta: una tarjeta que solo contiene un
            // botón no separa nada de nada, y le quitaba peso a la acción
            // principal de la pantalla mientras se transmite.
            Button(
                onClick = { viendoMapa = true },
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Ver mi ruta en el mapa (offline)") }
            Spacer(Modifier.height(7.dp))
            Text(
                if (estado.notas > 0) {
                    "${estado.notas} ${if (estado.notas == 1) "nota anclada" else "notas ancladas"} " +
                        "en esta ruta. Se exportan como POIs en el GPX de la guía."
                } else {
                    "Marca puntos (agua, cruce, peligro…) anclados a tu posición. Tu " +
                        "previsión y tu mapa funcionan sin cobertura."
                },
                style = MaterialTheme.typography.bodySmall,
                color = Paleta.slate400,
                modifier = Modifier.padding(horizontal = 6.dp),
            )
            Spacer(Modifier.height(22.dp))
        }

        // Las decisiones, agrupadas por NATURALEZA y plegadas: cada sección
        // enseña lo que hay elegido y se abre para cambiarlo. Antes estaban
        // todas desplegadas a la vez —evento, actividad, ruta, perfil, mandos,
        // retención, hora— y eso es un muro de mandos donde cuesta encontrar el
        // que se busca y, peor, cuesta ver de un vistazo QUÉ está puesto.
        //
        // Son dos preguntas distintas y por eso son dos secciones: "qué salida
        // es esta" (el evento, la ruta, el nombre, la hora) y "cómo se registra"
        // (la actividad, el ritmo, cuánto se conserva).
        SeccionPlegable(
            titulo = "Qué salida es esta",
            resumen = resumenSalida(estado, eventos, planes),
            // Sin decidir todavía, abierta: es la única sección que hay que
            // mirar antes de la primera salida.
            abiertaPorDefecto = !estado.compartiendo && estado.planId == null && estado.eventoId == null,
        ) {
            if (eventos.isNotEmpty()) {
                SelectorEvento(eventos, estado.eventoId) { TrackingStore.ajustaEvento(it) }
                Spacer(Modifier.height(14.dp))
            }
            if (!estado.compartiendo) {
                // La ruta y la hora se ocultan en marcha: la sesión ya está
                // creada en el backend con las suyas.
                SelectorPlan(planes, estado.planId, estado.eventoId) { TrackingStore.eligePlan(it) }
                if (estado.planId != null || estado.eventoId != null) {
                    Spacer(Modifier.height(10.dp))
                    // El mapa sin cobertura cuelga de la ruta: sin recorrido no
                    // hay corredor que preparar, solo lo ya andado.
                    OutlinedButton(
                        onClick = { descargandoMapa = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Descargar mapa offline") }
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = titulo,
                    onValueChange = { titulo = it },
                    label = { Text("Nombre (opcional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(14.dp))
                SelectorSalida(estado.salidaMs, estado.salidaTocada) {
                    TrackingStore.ajustaSalida(it)
                }
            }
        }

        // La actividad y el ritmo se ajustan TAMBIÉN en marcha, como en iOS. No
        // es un extra: el perfil que se elige antes de salir es una apuesta, y a
        // mitad de ruta es cuando de verdad se sabe si sobra precisión o falta
        // batería. Obligar a parar el seguimiento para cambiarlo sería obligar a
        // partir la traza en dos.
        SeccionPlegable(
            titulo = "Cómo se registra",
            resumen = resumenRegistro(estado),
            pie = if (estado.compartiendo) {
                "Se puede cambiar sobre la marcha: el ritmo nuevo se aplica al " +
                    "momento, sin cortar la traza."
            } else {
                "El gasto lo manda el GPS, no la frecuencia de envío: por eso " +
                    "ahorrar es pedirle menos al GPS, y parado no gasta."
            },
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
            Spacer(Modifier.height(14.dp))
            SelectorPerfil(estado.perfil) { TrackingStore.eligePerfil(it) }
            Spacer(Modifier.height(12.dp))
            MandosAvanzados(estado.ritmo) { TrackingStore.ajustaRitmo(it) }
            Spacer(Modifier.height(12.dp))
            SelectorRetencion(estado.retenerHoras) { TrackingStore.ajustaRetencion(it) }
        }

        estado.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(12.dp))
        }
        avisoGuia?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(12.dp))
        }

        // Y abajo del todo, lo GUARDADO: guías y seguimientos pasados. No es lo
        // que se viene a mirar mientras se anda, y arriba solo estorbaba.
        Spacer(Modifier.height(28.dp))

        Seccion(titulo = "Guías offline") {
            SeccionGuias(
                guias = guias,
                onImportar = { abreGuia.launch(arrayOf("*/*")) },
                onVer = { guia ->
                    ViewerData.abreConsulta(guia.id)
                    guiaEnMapa = guia.id
                },
                onBorrar = { TrackingStore.borraGuia(it.id) },
            )
        }

        Seccion(titulo = "Mis seguimientos") {
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
            onVerMapa = { sesion, enLocal ->
                if (enLocal) {
                    // Con traza en el móvil se abre el visor incrustado: se ve
                    // entera, con sus notas y sus fotos, y sin cobertura.
                    ViewerData.abreConsulta(sesion.id)
                    guiaEnMapa = sesion.id
                } else {
                    // Sin datos locales solo queda el enlace público, que existe
                    // mientras la ruta no haya caducado en el servidor.
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(TrackingStore.enlaceDe(sesion.id))),
                        )
                    }
                }
            },
            onChincheta = { id, fijada -> scope.launch { TrackingStore.fijaSesion(id, fijada) } },
            onRenombrar = { id, titulo -> scope.launch { TrackingStore.renombraSesion(id, titulo) } },
            onBorrar = { id -> scope.launch { TrackingStore.borraSesion(id) } },
            )
        }

        Spacer(Modifier.height(24.dp))
    }
    }

    if (confirmandoSalida) {
        AlertDialog(
            onDismissRequest = { confirmandoSalida = false },
            title = { Text("Salir de la cuenta") },
            text = {
                Text(
                    if (estado.compartiendo) {
                        "Estás compartiendo tu ubicación. Al salir se detiene el " +
                            "seguimiento y se cierra la sesión."
                    } else {
                        "Se cerrará tu sesión en este dispositivo."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmandoSalida = false
                    scope.launch {
                        // Primero se para la baliza (con el token aún vivo, para
                        // que el `end` llegue al backend) y luego se despide el
                        // servicio; el logout del servidor es cortesía — la
                        // sesión local se borra igual aunque no haya cobertura.
                        if (TrackingStore.estado.value.compartiendo) {
                            TrackingStore.para()
                            TrackingService.para(context)
                        }
                        runCatching {
                            TokenStore(context).token?.let { Api().logout(it) }
                        }
                        onSalir()
                    }
                }) { Text(if (estado.compartiendo) "Detener y salir" else "Salir") }
            },
            dismissButton = {
                TextButton(onClick = { confirmandoSalida = false }) { Text("Cancelar") }
            },
        )
    }

    // La pantalla de preparar el mapa se abre desde la ruta elegida, igual que
    // en iOS: no es una sección más del portal, es algo que se hace una vez.
    if (descargandoMapa) {
        ModalBottomSheet(onDismissRequest = { descargandoMapa = false }) {
            Column(
                Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Text("Preparar el mapa", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                SeccionMapaOffline(
                    planId = estado.planId,
                    trazaActual = TrackingStore.trazaActual(),
                    conEvento = estado.eventoId != null,
                )
            }
        }
    }
}

/**
 * Lo primero de la pantalla: **si está transmitiendo**, no cuánto.
 *
 * Espejo de `statusContent` en `ios/Sources/TrackingView.swift`. Al abrir la app
 * a mitad de ruta, lo que se busca saber es "¿sigue?"; el enlace y las cifras se
 * miran después, y por eso viven abajo.
 */
@Composable
private fun EstadoCompacto(
    estado: TrackingStore.Estado,
    arrancando: Boolean,
    hayPermiso: Boolean,
    onEmpezar: () -> Unit,
    onParar: () -> Unit,
) {
    Seccion {
        val (texto, color) = when {
            estado.enEspera -> "🌙 Armado · ahorrando batería" to Paleta.ambar
            estado.compartiendo -> "● Compartiendo en directo" to Paleta.verde
            else -> "⏸ Detenido" to Paleta.slate400
        }
        Text(texto, style = MaterialTheme.typography.titleSmall, color = color)

        if (estado.enEspera) {
            Text(
                "Empieza solo a la hora prevista. Deja la app abierta en segundo " +
                    "plano (no la cierres).",
                style = MaterialTheme.typography.bodySmall,
                color = Paleta.slate400,
            )
        }
        if (estado.compartiendo) {
            Text(
                estado.titulo?.takeIf { it.isNotBlank() } ?: "Sin ruta · trazado en vivo",
                style = MaterialTheme.typography.bodyMedium,
                color = if (estado.titulo.isNullOrBlank()) Paleta.slate400 else Paleta.slate100,
            )
            // En qué carrera se está emitiendo: al abrir la app a mitad de ruta,
            // saber que la baliza cuenta para el evento importa tanto como
            // saber que sigue transmitiendo.
            TrackingStore.eventoActual()?.let {
                Text(
                    "🏁 ${it.name}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Paleta.sky500,
                )
            }
            estado.actividadEfectiva?.let {
                Text(
                    "${it.emoji} ${it.label}" + if (estado.actividad == null) " · auto" else "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Paleta.slate100,
                )
            }
            estado.gastoBateriaPorHora?.let { gasto ->
                val restante = estado.horasRestantes
                Text(
                    "🔋 ${String.format(Locale.getDefault(), "%.1f", gasto)} %/h" +
                        (restante?.let { " · quedan ${TrackingRules.formateaHoras(it)}" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = if ((restante ?: 99.0) < 3) Paleta.rojo else Paleta.slate400,
                )
            }
        }

        // La acción va JUNTO al estado y no al final de la pantalla: es LA
        // acción, y donde se lee "detenido" es donde se busca cómo dejar de
        // estarlo. Además deja la misma posición que iOS, que antes no
        // coincidía —allí estaba al final y aquí en medio— y obligaba a
        // explicar la app dos veces.
        Spacer(Modifier.height(14.dp))
        if (estado.compartiendo) {
            // En rojo, no en el azul de todo lo demás: es la única acción que
            // DESHACE algo, y pulsarla por error corta la traza.
            Button(
                onClick = onParar,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Paleta.rojo,
                    contentColor = Paleta.slate950,
                ),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Dejar de compartir") }
        } else {
            Button(
                onClick = onEmpezar,
                enabled = hayPermiso && !arrancando,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (arrancando) CircularProgressIndicator(Modifier.height(18.dp))
                else Text("Empezar a compartir")
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Al iniciar uno nuevo, el seguimiento anterior se conserva para " +
                    "poder consultarlo (o para siempre si lo fijas con la chincheta).",
                style = MaterialTheme.typography.bodySmall,
                color = Paleta.slate400,
            )
        }
    }
}

@Composable
private fun DatosDeLaSesion(estado: TrackingStore.Estado) {
    Column {
            estado.seguidores?.let {
                Dato("Seguidores activos", "$it")
            }
            Dato("Posiciones enviadas", "${estado.subidas}")
            Dato("En cola", "${estado.pendientes}")
            Dato("Puntos de traza", "${estado.puntosTraza}")
            // Cuántas lecturas no superaron el ruido. Si andando salen muchas,
            // el umbral está demasiado alto y hay que bajarlo.
            if (estado.retenidas > 0) Dato("Lecturas descartadas", "${estado.retenidas}")
            if (estado.notas > 0) Dato("Notas", "${estado.notas}")
            Dato("Recorrido", TrackingRules.formateaDistancia(estado.metrosRecorridos))
            estado.huecoMetros?.let {
                Dato("Retraso de los seguidores", TrackingRules.formateaDistancia(it))
            }
            estado.ultimoEnvioMs?.let { Dato("Último envío", hora(it)) }
    }
}

@Composable
private fun Dato(etiqueta: String, valor: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        // La etiqueta apagada y el valor encendido: en una lista de ocho cifras
        // con los dos al mismo tono, la vista no encuentra el numero que busca.
        Text(etiqueta, style = MaterialTheme.typography.bodyMedium, color = Paleta.slate400)
        Text(
            valor,
            style = MaterialTheme.typography.bodyMedium,
            color = Paleta.slate100,
            fontWeight = FontWeight.Medium,
        )
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

/**
 * Lo que se lee sin desplegar "Qué salida es esta".
 *
 * Es la razón de ser de una sección plegada: si el resumen no dice lo que hay
 * elegido, plegarla solo esconde información. Se nombra el evento, el
 * recorrido y la hora, en ese orden, porque es el orden en que se decide.
 */
private fun resumenSalida(
    estado: TrackingStore.Estado,
    eventos: List<EventSummary>,
    planes: List<PlanSummary>,
): String {
    val partes = buildList {
        eventos.firstOrNull { it.id == estado.eventoId }?.let {
            // Con la marca por delante cuando la hay: plegado, esta línea es lo
            // último que se lee antes de salir, y "voy de 🦊 en Canfranc" es
            // justo lo que se quiere confirmar ahí.
            add(if (it.myEmoji != null) "${it.myEmoji} ${it.name}" else "🏁 ${it.name}")
        }
        val plan = planes.firstOrNull { it.id == estado.planId }
        add(
            when {
                plan != null -> plan.name ?: plan.routeName ?: "Ruta guardada"
                estado.eventoId != null -> "Recorrido del evento"
                else -> "Sin ruta · trazado en vivo"
            },
        )
        if (estado.salidaTocada && estado.salidaMs > 0) add(salidaCorta(estado.salidaMs))
    }
    return partes.joinToString(" · ")
}

/** Lo que se lee sin desplegar "Cómo se registra". */
private fun resumenRegistro(estado: TrackingStore.Estado): String {
    val actividad = estado.actividadEfectiva?.let {
        "${it.emoji} ${it.label}" + if (estado.actividad == null) " · auto" else ""
    } ?: "🤖 Automático"
    val ritmo = when (estado.perfil) {
        TrackingRules.Perfil.EQUILIBRADO -> "Equilibrado"
        TrackingRules.Perfil.AHORRO -> "Ahorro"
        TrackingRules.Perfil.PRECISION -> "Alta precisión"
        TrackingRules.Perfil.PERSONALIZADO -> if (estado.ritmo.modo == TrackingRules.Modo.DISTANCIA) {
            "Cada ${TrackingRules.etiquetaDistancia(estado.ritmo.distanciaMetros)}"
        } else {
            "Cada ${TrackingRules.etiquetaIntervalo(estado.ritmo.intervaloSegundos)}"
        }
    }
    return "$actividad · $ritmo · ${TrackingRules.etiquetaRetencion(estado.retenerHoras)}"
}

/** La hora de salida en el resumen: día y hora, sin segundos —que ahí no
 *  significan nada— al contrario que en "último envío". */
private fun salidaCorta(epochMs: Double): String =
    SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date(epochMs.toLong()))

private fun hora(epochMs: Double): String =
    SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(epochMs.toLong()))

