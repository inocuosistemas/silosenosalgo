@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.themakercrowd.silosenosalgo

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
 * El diseño da por hecho que se usa con una mano, en movimiento y a veces con
 * frío: por eso el tipo se elige de una rejilla de emojis grandes y el texto es
 * OPCIONAL. Marcar "Agua" al pasar tiene que costar dos toques; si además se
 * quiere escribir algo, se escribe.
 */
@Composable
fun SeccionNotas(
    notas: List<Note>,
    onAnadir: (String, String, ByteArray?, ByteArray?) -> Unit,
    onBorrar: (Note) -> Unit,
) {
    val context = LocalContext.current
    var tipo by remember { mutableStateOf(PoiTypes.DEFAULT_SLUG) }
    var texto by remember { mutableStateOf("") }
    var borrando by remember { mutableStateOf<Note?>(null) }
    var foto by remember { mutableStateOf<ByteArray?>(null) }
    var audio by remember { mutableStateOf<ByteArray?>(null) }
    var grabando by remember { mutableStateOf(false) }
    val grabadora = remember { GrabadoraAudio(context) }

    // La cámara escribe en un fichero de la caché que le pasamos por URI; al
    // volver se lee, se endereza y se encoge antes de guardarla en la nota.
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

    val pideMicrofono = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { concedido ->
        if (concedido) grabando = grabadora.empieza()
    }

    Text("Notas de campo", style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(6.dp))

    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        PoiTypes.all.forEach { poi ->
            if (poi.slug == tipo) {
                Button(onClick = { tipo = poi.slug }) { Text("${poi.emoji} ${poi.label}") }
            } else {
                OutlinedButton(onClick = { tipo = poi.slug }) { Text(poi.emoji) }
            }
        }
    }

    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = texto,
        onValueChange = { texto = it },
        label = { Text("Texto (opcional)") },
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = {
            val destino = File.createTempFile("foto_", ".jpg", context.cacheDir)
            val uri = FileProvider.getUriForFile(
                context, "${context.packageName}.ficheros", destino,
            )
            uriCaptura = uri
            runCatching { camara.launch(uri) }
        }) { Text(if (foto != null) "📷 ✓" else "📷 Foto") }

        OutlinedButton(onClick = {
            if (grabando) {
                audio = grabadora.para()
                grabando = false
            } else if (
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
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

    if (grabando) {
        Text("Grabando…", style = MaterialTheme.typography.bodySmall)
    }

    Spacer(Modifier.height(8.dp))
    Button(
        onClick = {
            // Si se le da a anotar con la grabación abierta, se cierra y se
            // adjunta: perder la voz porque no se pulsó "Parar" sería absurdo.
            val vozFinal = if (grabando) grabadora.para().also { grabando = false } else audio
            onAnadir(texto, tipo, foto, vozFinal)
            texto = ""
            tipo = PoiTypes.DEFAULT_SLUG
            foto = null
            audio = null
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Anotar aquí") }

    if (notas.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        notas.forEach { nota ->
            FilaNota(nota) { borrando = nota }
        }
    }

    borrando?.let { nota ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { borrando = null },
            title = { Text("¿Borrar la nota?") },
            text = { Text(resumenNota(nota)) },
            confirmButton = {
                TextButton(onClick = { onBorrar(nota); borrando = null }) { Text("Borrar") }
            },
            dismissButton = {
                TextButton(onClick = { borrando = null }) { Text("Cancelar") }
            },
        )
    }
}

@Composable
private fun FilaNota(nota: Note, onBorrar: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
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
                val adjuntos = listOfNotNull(
                    nota.photoKey?.let { "📷" },
                    nota.audioKey?.let { "🎤" },
                )
                if (adjuntos.isNotEmpty()) {
                    Text(adjuntos.joinToString(" "), style = MaterialTheme.typography.labelSmall)
                }
            }
            TextButton(onClick = onBorrar) { Text("Borrar") }
        }
    }
}

/** La hora y el punto kilométrico: lo que sirve para situarla luego en el mapa. */
private fun detalleNota(nota: Note): String {
    val hora = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(nota.createdAt.toLong()))
    val km = nota.distM?.let { " · km ${String.format(Locale.getDefault(), "%.2f", it / 1000)}" } ?: ""
    return hora + km
}

private fun resumenNota(nota: Note): String =
    "${PoiTypes.label(nota.poiType)}" + (nota.body?.let { ": $it" } ?: "")
