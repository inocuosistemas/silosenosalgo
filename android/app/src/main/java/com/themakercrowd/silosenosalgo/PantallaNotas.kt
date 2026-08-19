@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.themakercrowd.silosenosalgo

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Las notas de campo: marcar una fuente, un cruce dudoso o un peligro sin dejar
 * de andar.
 *
 * Se llega a ellas **desde el mapa**, igual que en iOS ([PantallaMapaVivo]): es
 * donde se está mirando cuando surge algo que anotar, y obligar a salir al menú
 * para apuntar una fuente al pasar sería garantizar que nadie lo hace.
 *
 * El diseño da por hecho que se usa con una mano, en movimiento y a veces con
 * frío: el tipo se elige de una rejilla de emojis grandes y el texto es
 * OPCIONAL. Marcar "Agua" tiene que costar dos toques.
 */
@Composable
fun HojaAnadirNota(
    onGuardar: (texto: String, tipo: String, foto: ByteArray?, audio: ByteArray?) -> Unit,
    onCerrar: () -> Unit,
) {
    val context = LocalContext.current
    var tipo by remember { mutableStateOf(PoiTypes.DEFAULT_SLUG) }
    var texto by remember { mutableStateOf("") }
    var foto by remember { mutableStateOf<ByteArray?>(null) }
    var audio by remember { mutableStateOf<ByteArray?>(null) }
    var grabando by remember { mutableStateOf(false) }
    var eligiendoFoto by remember { mutableStateOf(false) }
    val grabadora = remember { GrabadoraAudio(context) }

    var uriCaptura by remember { mutableStateOf<Uri?>(null) }
    var ficheroCaptura by remember { mutableStateOf<File?>(null) }
    val camara = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = uriCaptura
        if (ok && uri != null) foto = MediosNota.preparaFoto(context, uri)
        // El original de la cámara se borra en cuanto se ha encogido: son varios
        // megas por foto y en una travesía larga llenarían la caché.
        runCatching { ficheroCaptura?.delete() }
        ficheroCaptura = null
        uriCaptura = null
    }

    val galeria = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) foto = MediosNota.preparaFoto(context, uri) }

    val pideMicrofono = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { concedido -> if (concedido) grabando = grabadora.empieza() }

    ModalBottomSheet(onDismissRequest = { grabadora.cancela(); onCerrar() }) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Añadir nota", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))

            Text("Tipo de punto", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                PoiTypes.all.forEach { poi ->
                    if (poi.slug == tipo) {
                        Button(onClick = { tipo = poi.slug }) { Text("${poi.emoji} ${poi.label}") }
                    } else {
                        OutlinedButton(onClick = { tipo = poi.slug }) { Text(poi.emoji) }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = texto,
                onValueChange = { texto = it },
                label = { Text("Escribe una nota (opcional)…") },
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(12.dp))
            Text("Voz y foto", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { eligiendoFoto = true }) {
                    Text(if (foto != null) "📷 ✓" else "📷 Foto")
                }
                OutlinedButton(onClick = {
                    if (grabando) {
                        audio = grabadora.para()
                        grabando = false
                    } else if (
                        ContextCompat.checkSelfPermission(
                            context, Manifest.permission.RECORD_AUDIO,
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        grabando = grabadora.empieza()
                    } else {
                        pideMicrofono.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }) {
                    Text(
                        when {
                            grabando -> "⏹ Parar"
                            audio != null -> "🎤 ✓"
                            else -> "🎤 Voz"
                        },
                    )
                }
                if (foto != null || audio != null) {
                    TextButton(onClick = { foto = null; audio = null }) { Text("Quitar") }
                }
            }
            if (grabando) Text("Grabando…", style = MaterialTheme.typography.bodySmall)

            Spacer(Modifier.height(12.dp))
            Text(
                "Se ancla a tu posición actual y se sube al recuperar cobertura. " +
                    "En el GPX de la guía será un POI.",
                style = MaterialTheme.typography.bodySmall,
            )

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        // Si se guarda con la grabación abierta, se cierra y se
                        // adjunta: perder la voz por no pulsar "Parar" sería absurdo.
                        val voz = if (grabando) grabadora.para().also { grabando = false } else audio
                        onGuardar(texto, tipo, foto, voz)
                        onCerrar()
                    },
                ) { Text("Guardar") }
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = { grabadora.cancela(); onCerrar() },
                ) { Text("Cancelar") }
            }
        }
    }

    if (eligiendoFoto) {
        AlertDialog(
            onDismissRequest = { eligiendoFoto = false },
            title = { Text("Foto de la nota") },
            text = { Text("¿De dónde sale la foto?") },
            confirmButton = {
                TextButton(onClick = {
                    eligiendoFoto = false
                    val destino = File.createTempFile("foto_", ".jpg", context.cacheDir)
                    ficheroCaptura = destino
                    val uri = FileProvider.getUriForFile(
                        context, "${context.packageName}.ficheros", destino,
                    )
                    uriCaptura = uri
                    runCatching { camara.launch(uri) }
                }) { Text("Hacer foto") }
            },
            dismissButton = {
                TextButton(onClick = {
                    eligiendoFoto = false
                    galeria.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                }) { Text("Elegir de la galería") }
            },
        )
    }
}

/** La lista de notas de la sesión. Tocar una abre su detalle. */
@Composable
fun HojaListaNotas(
    notas: List<Note>,
    sessionId: String?,
    onBorrar: (Note) -> Unit,
    onCerrar: () -> Unit,
) {
    var abierta by remember { mutableStateOf<Note?>(null) }

    ModalBottomSheet(onDismissRequest = onCerrar) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)
                .heightIn(max = 600.dp).verticalScroll(rememberScrollState()),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Notas", style = MaterialTheme.typography.titleMedium)
                Text("${notas.size}", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(8.dp))
            if (notas.isEmpty()) {
                Text("Todavía no hay notas", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Las notas que añadas desde el mapa aparecerán aquí.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            notas.forEach { nota -> FilaNota(nota) { abierta = nota } }
        }
    }

    abierta?.let { nota ->
        HojaDetalleNota(
            nota = nota,
            sessionId = sessionId,
            onBorrar = { onBorrar(nota); abierta = null },
            onCerrar = { abierta = null },
        )
    }
}

@Composable
private fun FilaNota(nota: Note, onAbrir: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).clickable { onAbrir() },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.padding(end = 8.dp)) {
                Text(
                    "${PoiTypes.emoji(nota.poiType)} ${PoiTypes.label(nota.poiType)}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                nota.body?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text(detalleNota(nota), style = MaterialTheme.typography.labelSmall)
            }
            val adjuntos = listOfNotNull(
                nota.photoKey?.let { "📷" },
                nota.audioKey?.let { "🎤" },
            )
            if (adjuntos.isNotEmpty()) Text(adjuntos.joinToString(" "))
        }
    }
}

/**
 * El detalle de una nota: la foto a tamaño completo y la voz reproducible.
 *
 * Los medios se leen del disco del móvil, no del servidor: la nota puede estar
 * aún sin subir —tomada sin cobertura— y aun así hay que poder verla y oírla.
 */
@Composable
private fun HojaDetalleNota(
    nota: Note,
    sessionId: String?,
    onBorrar: () -> Unit,
    onCerrar: () -> Unit,
) {
    val context = LocalContext.current
    var confirmandoBorrado by remember { mutableStateOf(false) }

    val foto = remember(nota.id) {
        if (nota.photoKey == null || sessionId == null) null
        else TrackingStore.medioDeNota(sessionId, nota.id, "photo")
            ?.let { bytes -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
    }
    val ficheroAudio = remember(nota.id) {
        if (nota.audioKey == null || sessionId == null) null
        else TrackingStore.ficheroDeMedio(sessionId, nota.id, "audio")
    }

    ModalBottomSheet(onDismissRequest = onCerrar) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp)
                .heightIn(max = 640.dp).verticalScroll(rememberScrollState()),
        ) {
            Text(
                "${PoiTypes.emoji(nota.poiType)} ${nota.title ?: PoiTypes.label(nota.poiType)}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(detalleNota(nota), style = MaterialTheme.typography.labelSmall)

            nota.body?.let {
                Spacer(Modifier.height(12.dp))
                Text("Nota", style = MaterialTheme.typography.titleSmall)
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }

            foto?.let {
                Spacer(Modifier.height(12.dp))
                Text("Foto", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Image(
                    bitmap = it,
                    contentDescription = "Foto de la nota",
                    modifier = Modifier.fillMaxWidth(),
                    contentScale = ContentScale.FillWidth,
                )
            }

            ficheroAudio?.let { fichero ->
                Spacer(Modifier.height(12.dp))
                Text("Nota de voz", style = MaterialTheme.typography.titleSmall)
                ReproductorDeVoz(fichero)
            }

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = { confirmandoBorrado = true },
                ) { Text("Eliminar") }
                Button(modifier = Modifier.weight(1f), onClick = onCerrar) { Text("Cerrar") }
            }
        }
    }

    if (confirmandoBorrado) {
        AlertDialog(
            onDismissRequest = { confirmandoBorrado = false },
            title = { Text("¿Eliminar la nota?") },
            // El aviso es literal el de iOS: quien borra una nota casi nunca
            // piensa en que se lleva por delante la foto y la voz.
            text = { Text("Se eliminarán también la foto y la nota de voz vinculadas.") },
            confirmButton = {
                TextButton(onClick = { confirmandoBorrado = false; onBorrar() }) {
                    Text("Eliminar")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmandoBorrado = false }) { Text("Cancelar") }
            },
        )
    }
}

/** Reproductor mínimo para la nota de voz: reproducir y parar. */
@Composable
private fun ReproductorDeVoz(fichero: File) {
    var sonando by remember { mutableStateOf(false) }
    val reproductor = remember { MediaPlayer() }

    // Soltar el reproductor al salir es obligatorio: MediaPlayer retiene un
    // decodificador del sistema, y dejarlo abierto los agota para toda la app.
    DisposableEffect(Unit) {
        onDispose { runCatching { reproductor.release() } }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = {
            if (sonando) {
                runCatching { reproductor.stop(); reproductor.reset() }
                sonando = false
            } else {
                runCatching {
                    reproductor.reset()
                    reproductor.setDataSource(fichero.absolutePath)
                    reproductor.setOnCompletionListener { sonando = false }
                    reproductor.prepare()
                    reproductor.start()
                    sonando = true
                }
            }
        }) { Text(if (sonando) "⏹ Parar" else "▶ Escuchar") }
    }
}

/** La hora y el punto kilométrico: lo que sirve para situarla luego en el mapa. */
private fun detalleNota(nota: Note): String {
    val hora = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(nota.createdAt.toLong()))
    val km = nota.distM?.let { " · km ${String.format(Locale.getDefault(), "%.2f", it / 1000)}" } ?: ""
    return hora + km
}

private fun resumenNota(nota: Note): String =
    PoiTypes.label(nota.poiType) + (nota.body?.let { ": $it" } ?: "")
