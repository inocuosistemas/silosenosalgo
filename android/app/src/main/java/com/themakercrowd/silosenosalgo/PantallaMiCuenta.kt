package com.themakercrowd.silosenosalgo

import android.content.Context
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/** Lo que se manda al cambiar la marca: un valor nuevo, o quitar el que hay. */
sealed class CambioDeMarca {
    data class Pon(val valor: String) : CambioDeMarca()
    data object Quitar : CambioDeMarca()

    fun json(): JsonElement = when (this) {
        is Pon -> JsonPrimitive(valor)
        Quitar -> JsonNull
    }
}

/**
 * La cuenta de quien usa la app: su marca (para el botón de arriba a la
 * derecha, guardada en el móvil para que se vea sin esperar a la red) y el
 * cambio de contraseña. Espejo de `AuthStore` en iOS.
 */
object Cuenta {
    private val json = Json { ignoreUnknownKeys = true }
    private val _perfil = MutableStateFlow(PerfilDeCuenta())
    val perfil: StateFlow<PerfilDeCuenta> = _perfil.asStateFlow()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("cuenta", Context.MODE_PRIVATE)

    fun lee(ctx: Context) {
        prefs(ctx).getString("perfil", null)?.let { s ->
            runCatching { json.decodeFromString(PerfilDeCuenta.serializer(), s) }.getOrNull()?.let { _perfil.value = it }
        }
    }

    /** La marca, del servidor. Sin red se queda la guardada. */
    suspend fun carga(ctx: Context) {
        val t = TokenStore(ctx).token ?: return
        runCatching { Api().perfil(t) }.getOrNull()?.let { pon(ctx, it) }
    }

    suspend fun guarda(ctx: Context, emoji: CambioDeMarca? = null, color: CambioDeMarca? = null) {
        val t = TokenStore(ctx).token ?: throw ApiException(401, "unauthorized")
        pon(ctx, Api().guardaPerfil(t, emoji, color))
    }

    /** Cambia la contraseña y se queda con la sesión nueva: la de antes deja de
     *  valer, en este móvil y en todos. La baliza lee el token del almacén en
     *  cada envío, así que sigue con la nueva sin más. */
    suspend fun cambiaContrasena(ctx: Context, actual: String, nueva: String) {
        val almacen = TokenStore(ctx)
        val t = almacen.token ?: throw ApiException(401, "unauthorized")
        val r = Api().cambiaContrasena(t, actual, nueva)
        almacen.token = r.token ?: throw ApiException(0, "network")
    }

    fun olvida(ctx: Context) {
        prefs(ctx).edit().remove("perfil").apply()
        _perfil.value = PerfilDeCuenta()
    }

    /** Para la pantalla de prueba (solo en depuración). */
    fun siembraDePrueba(p: PerfilDeCuenta) { _perfil.value = p }

    private fun pon(ctx: Context, p: PerfilDeCuenta) {
        _perfil.value = p
        prefs(ctx).edit().putString("perfil", json.encodeToString(PerfilDeCuenta.serializer(), p)).apply()
    }

    /** Los mismos sesenta de la web (`EMOJI_POOL` en shared/emoji.ts). */
    val EMOJIS = listOf(
        "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵",
        "🦉", "🦅", "🦆", "🐢", "🐬", "🐙", "🦖", "🦄", "🐝", "🦋",
        "🍎", "🍌", "🍉", "🍇", "🍒", "🥑", "🌽", "🍄", "🌵", "🌻",
        "⚽", "🏀", "🎾", "🏈", "🥏", "🎿", "🛹", "🚀", "⛵", "🚂",
        "🎸", "🥁", "🎺", "🎨", "📷", "🔦", "🧭", "⏰", "💡", "🔑",
        "⭐", "🌈", "🔥", "❄️", "🌙", "☂️", "🍀", "🎩", "👑", "🧊",
    )

    /** Los doce de la paleta de los eventos (shared/eventColors.ts), en su orden. */
    val COLORES = listOf(
        "sky" to "Azul", "emerald" to "Verde", "amber" to "Ámbar", "rose" to "Rojo",
        "violet" to "Violeta", "lime" to "Lima", "orange" to "Naranja", "cyan" to "Cian",
        "fuchsia" to "Fucsia", "teal" to "Turquesa", "indigo" to "Índigo", "pink" to "Rosa",
    )

    const val MINIMO = 8
}

/**
 * El botón de la cuenta, arriba a la derecha: la marca de quien usa la app.
 * Sin marca elegida, la inicial del usuario en un aro gris.
 */
@Composable
fun BotonDeCuenta(usuario: String?, onClick: () -> Unit) {
    val perfil by Cuenta.perfil.collectAsState()
    Box(
        Modifier
            .clip(CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Mi cuenta" },
    ) {
        MarcaEvento(perfil.favEmoji ?: usuario?.firstOrNull()?.uppercase() ?: "·", perfil.favColor, tam = 40.dp)
    }
}

/**
 * «Mi cuenta»: lo que es de la persona y no de una salida ni de una carrera.
 * La marca con la que se entra a cualquier evento (la misma que en la web), la
 * contraseña (con la actual delante) y salir de la cuenta. Espejo de
 * `PantallaMiCuenta` en iOS.
 */
@Composable
fun PantallaMiCuenta(usuario: String?, onCerrar: () -> Unit, onSalir: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val perfil by Cuenta.perfil.collectAsState()
    BackHandler(onBack = onCerrar)

    var emojiAbierto by remember { mutableStateOf(perfil.favEmoji == null) }
    var colorAbierto by remember { mutableStateOf(perfil.favColor == null) }
    var otroEmoji by remember { mutableStateOf("") }
    var guardando by remember { mutableStateOf(false) }
    var errorMarca by remember { mutableStateOf<String?>(null) }
    var guardado by remember { mutableStateOf(false) }

    var actual by remember { mutableStateOf("") }
    var nueva by remember { mutableStateOf("") }
    var repetida by remember { mutableStateOf("") }
    var cambiando by remember { mutableStateOf(false) }
    var errorClave by remember { mutableStateOf<String?>(null) }
    var claveCambiada by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { Cuenta.carga(context) }

    fun guarda(emoji: CambioDeMarca? = null, color: CambioDeMarca? = null, alAcabar: () -> Unit = {}) {
        guardando = true
        errorMarca = null
        scope.launch {
            runCatching { Cuenta.guarda(context, emoji, color) }
                .onSuccess {
                    alAcabar()
                    guardado = true
                    guardando = false
                    delay(1500)
                    guardado = false
                }
                .onFailure { errorMarca = it.message; guardando = false }
        }
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Mi cuenta", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = Paleta.slate100, modifier = Modifier.weight(1f))
            TextButton(onClick = onCerrar) { Text("Cerrar") }
        }
        Spacer(Modifier.height(10.dp))

        Seccion(titulo = "Tu marca", icono = "🙂") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                MarcaEvento(perfil.favEmoji ?: "?", perfil.favColor, tam = 56.dp)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(usuario ?: "", color = Paleta.slate100, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Así te verán en el mapa de los eventos. Si al entrar en uno tu emoji ya lo lleva otro, entrarás con otro.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Plegable("Mi emoji", perfil.favEmoji ?: "sin elegir", emojiAbierto) { emojiAbierto = !emojiAbierto }
            if (emojiAbierto) {
                Cuenta.EMOJIS.chunked(6).forEach { fila ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        fila.forEach { e ->
                            val elegido = e == perfil.favEmoji
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(46.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (elegido) Paleta.sky500.copy(alpha = 0.25f) else Paleta.slate900)
                                    .border(2.dp, if (elegido) Paleta.sky500 else Paleta.slate900, RoundedCornerShape(10.dp))
                                    .clickable(enabled = !guardando) { guarda(emoji = CambioDeMarca.Pon(e)) },
                                contentAlignment = Alignment.Center,
                            ) { Text(e, fontSize = 24.sp) }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                }
                // Cualquier emoji vale, no solo los sesenta.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = otroEmoji,
                        onValueChange = { otroEmoji = it },
                        label = { Text("Otro: escríbelo aquí") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    if (otroEmoji.isNotBlank()) {
                        TextButton(enabled = !guardando, onClick = {
                            guarda(emoji = CambioDeMarca.Pon(otroEmoji.trim())) { otroEmoji = "" }
                        }) { Text("Usar") }
                    }
                }
                if (perfil.favEmoji != null) {
                    TextButton(enabled = !guardando, onClick = { guarda(emoji = CambioDeMarca.Quitar) }) {
                        Text("Quitar mi emoji", color = Paleta.rojo)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Plegable(
                "Mi color",
                Cuenta.COLORES.firstOrNull { it.first == perfil.favColor }?.second ?: "sin elegir",
                colorAbierto,
                punto = perfil.favColor,
            ) { colorAbierto = !colorAbierto }
            if (colorAbierto) {
                Cuenta.COLORES.chunked(4).forEach { fila ->
                    Row(Modifier.fillMaxWidth()) {
                        fila.forEach { (slug, nombre) ->
                            val elegido = slug == perfil.favColor
                            Column(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable(enabled = !guardando) { guarda(color = CambioDeMarca.Pon(slug)) }
                                    .padding(vertical = 8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(
                                    Modifier
                                        .size(40.dp)
                                        .border(3.dp, if (elegido) Paleta.slate100 else Paleta.slate950, CircleShape)
                                        .padding(4.dp)
                                        .clip(CircleShape)
                                        .background(Paleta.colorEvento(slug)),
                                    contentAlignment = Alignment.Center,
                                ) { if (elegido) Text("✓", color = Paleta.slate950, fontWeight = FontWeight.Bold) }
                                Text(nombre, fontSize = 11.sp, color = if (elegido) Paleta.slate100 else Paleta.slate400)
                            }
                        }
                    }
                }
                if (perfil.favColor != null) {
                    TextButton(enabled = !guardando, onClick = { guarda(color = CambioDeMarca.Quitar) }) {
                        Text("Quitar mi color", color = Paleta.rojo)
                    }
                }
            }
            errorMarca?.let { Text(it, color = Paleta.rojo, style = MaterialTheme.typography.bodySmall) }
                ?: if (guardado) Text("Guardado ✓", color = Paleta.verde, style = MaterialTheme.typography.bodySmall) else Unit
        }

        val noCoinciden = repetida.isNotEmpty() && nueva != repetida
        val puedeCambiar = actual.isNotEmpty() && nueva.length >= Cuenta.MINIMO && nueva == repetida && !cambiando
        Seccion(
            titulo = "Contraseña", icono = "🔑",
            pie = "Al cambiarla se cierra la sesión en la web y en los demás móviles; en este sigues dentro.",
        ) {
            CampoDeClave(actual, { actual = it }, "Contraseña actual")
            CampoDeClave(nueva, { nueva = it }, "Nueva (mínimo ${Cuenta.MINIMO} caracteres)")
            CampoDeClave(repetida, { repetida = it }, "Repite la nueva", error = noCoinciden)
            if (noCoinciden) Text("No coinciden.", color = Paleta.rojo, style = MaterialTheme.typography.bodySmall)
            errorClave?.let { Text(it, color = Paleta.rojo, style = MaterialTheme.typography.bodySmall) }
            if (claveCambiada && errorClave == null) {
                Text("Contraseña cambiada ✓", color = Paleta.verde, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            Button(
                enabled = puedeCambiar,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    cambiando = true
                    errorClave = null
                    claveCambiada = false
                    scope.launch {
                        runCatching { Cuenta.cambiaContrasena(context, actual, nueva) }
                            .onSuccess {
                                actual = ""; nueva = ""; repetida = ""
                                claveCambiada = true
                            }
                            .onFailure { e ->
                                errorClave = if ((e as? ApiException)?.code == "invalid_credentials") {
                                    "La contraseña actual no es esa."
                                } else e.message
                            }
                        cambiando = false
                    }
                },
            ) {
                if (cambiando) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (cambiando) "Cambiando…" else "Cambiar la contraseña")
            }
        }

        // En rojo apagado, como estaba al final de «Archivo»: es una salida, no
        // una alarma. Se sigue preguntando antes (ver `PantallaSeguimiento`).
        OutlinedButton(
            onClick = onSalir,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Paleta.rojo.copy(alpha = 0.85f)),
        ) { Text("Salir de la cuenta") }
        Spacer(Modifier.height(20.dp))
        Text(
            "SiLoSeNoSalgo ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            style = MaterialTheme.typography.bodySmall,
            color = Paleta.slate400,
            modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun Plegable(titulo: String, valor: String, abierto: Boolean, punto: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(titulo, color = Paleta.slate100, modifier = Modifier.weight(1f))
        punto?.let {
            Box(Modifier.size(12.dp).clip(CircleShape).background(Paleta.colorEvento(it)))
            Spacer(Modifier.width(6.dp))
        }
        Text(valor, color = Paleta.slate400)
        Spacer(Modifier.width(8.dp))
        Text(if (abierto) "▾" else "▸", color = Paleta.slate400)
    }
}

@Composable
private fun CampoDeClave(valor: String, onCambia: (String) -> Unit, etiqueta: String, error: Boolean = false) {
    OutlinedTextField(
        value = valor,
        onValueChange = onCambia,
        label = { Text(etiqueta) },
        singleLine = true,
        isError = error,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
    )
}
