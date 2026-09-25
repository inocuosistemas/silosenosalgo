package com.themakercrowd.silosenosalgo

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.hypot

/**
 * Añadir fotos a una salida YA TERMINADA, cada una en su sitio del recorrido.
 * Espejo de `PantallaFotosEnRuta` en iOS: buscar las del carrete hechas
 * durante la salida, elegir otras, repasarlas sobre el trazado y subirlas
 * como notas con foto. Cómo se decide el sitio: `ColocaFotos`.
 *
 * El repaso se dibuja sobre el propio trazado, sin mapa de fondo: lo que
 * orienta es la línea del recorrido, y colocar a mano se pega al punto de la
 * línea más cercano igualmente.
 */
class FotoDeRuta(
    val miniatura: ImageBitmap,
    /** El JPEG ya reducido, el que se sube. */
    val datos: ByteArray,
    val fecha: Double?,
    val gps: Pair<Double, Double>?,
    /** De dónde vino, para no añadir dos veces la misma. */
    val origen: String?,
) {
    val id: String = UUID.randomUUID().toString()
    /** Fijo desde el principio: reintentar la subida no duplica la nota. */
    val notaId: String = TrackingRules.generaId()
    var sitio by mutableStateOf<ColocaFotos.Sitio?>(null)
}

class FotosEnRutaEstado(val sesion: TrackSessionSummary) {
    enum class Fase { CARGANDO, SIN_TRAZADO, ELIGIENDO, REPASO, SUBIENDO, HECHO }

    var fase by mutableStateOf(Fase.CARGANDO)
    var motivo by mutableStateOf("")
    val fotos = mutableStateListOf<FotoDeRuta>()
    var seleccionada by mutableStateOf<String?>(null)
    /** Las del carrete de esas horas (null = aún no se ha buscado). */
    var halladas by mutableStateOf<List<Uri>?>(null)
    var sinPermiso by mutableStateOf(false)
    var preparando by mutableIntStateOf(0)
    val subidas = mutableStateListOf<String>()
    var error by mutableStateOf<String?>(null)
    var fijar by mutableStateOf(true)

    var traza: List<TrailPoint> = emptyList()
        private set
    private var acum = DoubleArray(0)
    /** Cómo se sube una foto; en la pantalla de prueba, de mentira. */
    var subidor: suspend (FotoDeRuta, ColocaFotos.Sitio) -> Unit = { f, s -> subeDeVerdad(f, s) }

    val colocadas get() = fotos.filter { it.sitio != null }
    val sinSitio get() = fotos.filter { it.sitio == null }

    fun ponTrazado(t: List<TrailPoint>) {
        if (t.size < 2) {
            motivo = "Esta salida no tiene recorrido guardado: no hay dónde poner las fotos."
            fase = Fase.SIN_TRAZADO
            return
        }
        traza = t.sortedBy { it.t }
        acum = ColocaFotos.acumulado(traza)
        fase = Fase.ELIGIENDO
    }

    fun anade(f: FotoDeRuta) {
        f.sitio = ColocaFotos.coloca(f.fecha, f.gps, traza, acum)
        fotos.add(f)
        fotos.sortBy { it.sitio?.distM ?: Double.MAX_VALUE }
    }

    /** Tocado junto al punto `i` del trazado: la seleccionada va ahí. */
    fun mueve(id: String, i: Int) {
        val f = fotos.firstOrNull { it.id == id } ?: return
        f.sitio = ColocaFotos.aMano(traza[i].lat, traza[i].lon, traza, acum)
        seleccionada = sinSitio.firstOrNull()?.id ?: id
    }

    fun quita(id: String) {
        fotos.removeAll { it.id == id }
        if (seleccionada == id) seleccionada = sinSitio.firstOrNull()?.id
    }

    suspend fun sube() {
        fase = Fase.SUBIENDO
        error = null
        var fallos = 0
        for (f in colocadas) {
            if (f.id in subidas) continue
            val s = f.sitio ?: continue
            runCatching { subidor(f, s) }
                .onSuccess { subidas.add(f.id) }
                .onFailure { fallos++; error = it.message }
        }
        if (fallos == 0) {
            if (fijar && !sesion.isPinned) runCatching { TrackingStore.fijaSesion(sesion.id, true) }
            fase = Fase.HECHO
        } else {
            error = "$fallos no se han podido subir. ${error ?: ""}"
            fase = Fase.REPASO
        }
    }

    private suspend fun subeDeVerdad(f: FotoDeRuta, s: ColocaFotos.Sitio) {
        // En orden con el resto de la salida: la hora de la foto si es la que
        // la puso ahí; si no, la del trazado en ese punto.
        val cuando = if (s.modo == ColocaFotos.Modo.POR_HORA) f.fecha ?: s.t else s.t
        val nota = Note(
            id = f.notaId, createdAt = cuando, lat = s.lat, lon = s.lon,
            distM = s.distM, poiType = PoiTypes.DEFAULT_SLUG,
        )
        TrackingStore.subeFotoASalida(sesion.id, nota, f.datos)
    }

    companion object {
        const val TOPE = 50
    }
}

// ── Leer las fotos ───────────────────────────────────────────────────────────

private object FotosDelMovil {
    /** Las del carrete hechas durante la salida (con el margen). */
    fun deLasHoras(ctx: Context, desde: Double, hasta: Double): List<Uri> {
        val col = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val sel = "${MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${MediaStore.Images.Media.DATE_TAKEN} <= ?"
        val args = arrayOf(desde.toLong().toString(), hasta.toLong().toString())
        val lista = mutableListOf<Uri>()
        runCatching {
            ctx.contentResolver.query(col, arrayOf(MediaStore.Images.Media._ID), sel, args,
                "${MediaStore.Images.Media.DATE_TAKEN} ASC")?.use { c ->
                val iId = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                while (c.moveToNext()) lista.add(ContentUris.withAppendedId(col, c.getLong(iId)))
            }
        }
        return lista
    }

    /** Hora y GPS: de MediaStore la hora (fiable), del EXIF el GPS (solo llega
     *  con ACCESS_MEDIA_LOCATION y del original); las del selector, del EXIF. */
    fun lee(ctx: Context, uri: Uri): FotoDeRuta? {
        val datos = MediosNota.preparaFoto(ctx, uri) ?: return null
        val tomada = runCatching {
            ctx.contentResolver.query(uri, arrayOf(MediaStore.Images.Media.DATE_TAKEN), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0).toDouble().takeIf { it > 0 } else null
            }
        }.getOrNull()
        var fecha: Double? = tomada
        var gps: Pair<Double, Double>? = null
        val original = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && tienePermisoDeUbicacion(ctx) &&
            uri.authority == MediaStore.AUTHORITY) {
            runCatching { MediaStore.setRequireOriginal(uri) }.getOrDefault(uri)
        } else uri
        runCatching {
            ctx.contentResolver.openInputStream(original)?.use { e ->
                val exif = ExifInterface(e)
                exif.latLong?.let { gps = it[0] to it[1] }
                if (fecha == null) {
                    exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)?.let {
                        fecha = ColocaFotos.fechaExif(it, exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL))
                    }
                }
            }
        }
        val mini = BitmapFactory.decodeByteArray(datos, 0, datos.size, BitmapFactory.Options().apply { inSampleSize = 8 })
            ?: return null
        return FotoDeRuta(mini.asImageBitmap(), datos, fecha, gps, uri.toString())
    }

    fun permisosDeLectura(): Array<String> = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.READ_MEDIA_IMAGES)
        else add(Manifest.permission.READ_EXTERNAL_STORAGE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACCESS_MEDIA_LOCATION)
    }.toTypedArray()

    fun puedeLeer(ctx: Context): Boolean {
        val permisos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            listOf(Manifest.permission.READ_MEDIA_IMAGES)
        } else listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        return permisos.any { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    }

    private fun tienePermisoDeUbicacion(ctx: Context) =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ctx.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED
}

private fun hora(ms: Double?): String =
    ms?.let { SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it.toLong())) } ?: "?"

private fun tamano(bytes: Int): String =
    if (bytes < 1_048_576) "${(bytes + 1023) / 1024} KB"
    else String.format(Locale.getDefault(), "%.1f MB", bytes / 1_048_576.0)

// ── La pantalla ──────────────────────────────────────────────────────────────

@Composable
fun PantallaFotosEnRuta(estado: FotosEnRutaEstado, onCerrar: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    BackHandler {
        when (estado.fase) {
            FotosEnRutaEstado.Fase.REPASO -> estado.fase = FotosEnRutaEstado.Fase.ELIGIENDO
            FotosEnRutaEstado.Fase.SUBIENDO -> Unit
            else -> onCerrar()
        }
    }

    LaunchedEffect(Unit) {
        if (estado.fase == FotosEnRutaEstado.Fase.CARGANDO) {
            runCatching { TrackingStore.trazaDeSalida(estado.sesion.id) }
                .onSuccess { estado.ponTrazado(it) }
                .onFailure {
                    estado.motivo = "No se ha podido traer el recorrido de esta salida. Comprueba la conexión."
                    estado.fase = FotosEnRutaEstado.Fase.SIN_TRAZADO
                }
        }
    }

    fun anadeUris(uris: List<Uri>) {
        scope.launch {
            for (uri in uris) {
                if (estado.fotos.size >= FotosEnRutaEstado.TOPE) break
                if (estado.fotos.any { it.origen == uri.toString() }) continue
                estado.preparando++
                withContext(Dispatchers.IO) { FotosDelMovil.lee(context, uri) }?.let { estado.anade(it) }
                estado.preparando--
            }
        }
    }

    fun busca() {
        val t = estado.traza
        if (t.isEmpty()) return
        scope.launch {
            val lista = withContext(Dispatchers.IO) {
                FotosDelMovil.deLasHoras(context, t.first().t - ColocaFotos.MARGEN_MS, t.last().t + ColocaFotos.MARGEN_MS)
            }
            estado.halladas = lista.filter { u -> estado.fotos.none { it.origen == u.toString() } }
        }
    }

    val pidePermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (FotosDelMovil.puedeLeer(context)) busca() else estado.sinPermiso = true
    }
    val selector = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(FotosEnRutaEstado.TOPE),
    ) { uris -> if (uris.isNotEmpty()) anadeUris(uris) }

    Column(Modifier.fillMaxSize().background(Paleta.slate950)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (estado.fase == FotosEnRutaEstado.Fase.REPASO || estado.fase == FotosEnRutaEstado.Fase.SUBIENDO)
                    "Repasa dónde va cada una" else "Añadir fotos",
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = Paleta.slate100, modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
            when (estado.fase) {
                FotosEnRutaEstado.Fase.REPASO ->
                    TextButton(onClick = { estado.fase = FotosEnRutaEstado.Fase.ELIGIENDO }) { Text("Atrás") }
                FotosEnRutaEstado.Fase.SUBIENDO -> Unit
                FotosEnRutaEstado.Fase.HECHO -> TextButton(onClick = onCerrar) { Text("Hecho") }
                else -> TextButton(onClick = onCerrar) { Text("Cancelar") }
            }
        }
        when (estado.fase) {
            FotosEnRutaEstado.Fase.CARGANDO -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            FotosEnRutaEstado.Fase.SIN_TRAZADO -> Box(Modifier.fillMaxSize().padding(30.dp), contentAlignment = Alignment.Center) {
                Text(estado.motivo, color = Paleta.slate400)
            }
            FotosEnRutaEstado.Fase.ELIGIENDO -> Eligiendo(
                estado,
                onBuscar = {
                    if (FotosDelMovil.puedeLeer(context)) busca()
                    else pidePermiso.launch(FotosDelMovil.permisosDeLectura())
                },
                onAnadirHalladas = {
                    val l = estado.halladas.orEmpty()
                    estado.halladas = emptyList()
                    anadeUris(l)
                },
                onElegir = {
                    selector.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
            )
            FotosEnRutaEstado.Fase.REPASO, FotosEnRutaEstado.Fase.SUBIENDO -> Repaso(estado) {
                scope.launch { estado.sube() }
            }
            FotosEnRutaEstado.Fase.HECHO -> Column(
                Modifier.fillMaxSize().padding(30.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("✅", fontSize = 48.sp)
                Spacer(Modifier.height(10.dp))
                Text(
                    if (estado.subidas.size == 1) "Foto añadida" else "${estado.subidas.size} fotos añadidas",
                    style = MaterialTheme.typography.titleMedium, color = Paleta.slate100,
                )
                Text("Se ven en el mapa de la salida, cada una en su sitio del recorrido.",
                    color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Eligiendo(
    estado: FotosEnRutaEstado,
    onBuscar: () -> Unit,
    onAnadirHalladas: () -> Unit,
    onElegir: () -> Unit,
) {
    val t = estado.traza
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Text(estado.sesion.title ?: "Sin nombre", color = Paleta.slate100, fontWeight = FontWeight.SemiBold)
            Text("De ${hora(t.firstOrNull()?.t)} a ${hora(t.lastOrNull()?.t)}", color = Paleta.slate400,
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(14.dp))
            Seccion(titulo = "Las de la ruta", icono = "🕒") {
                val halladas = estado.halladas
                when {
                    estado.sinPermiso -> Text(
                        "Sin permiso para ver la galería no se pueden buscar. Elígelas abajo, o dale permiso en Ajustes.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                    )
                    halladas == null -> {
                        Text("Busca en tu galería las que hiciste entre la salida y la llegada, y las pone donde estabas a esa hora.",
                            color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = onBuscar, modifier = Modifier.fillMaxWidth()) { Text("Buscar las fotos de la ruta") }
                    }
                    halladas.isEmpty() -> Text(
                        if (estado.fotos.isNotEmpty()) "Ya están todas las de esas horas."
                        else "En tu galería no hay fotos de esas horas. Si las hizo otra cámara, elígelas abajo.",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                    )
                    else -> {
                        Text(
                            if (halladas.size == 1) "Hay una foto hecha durante la salida."
                            else "Hay ${halladas.size} fotos hechas durante la salida.",
                            color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = onAnadirHalladas, modifier = Modifier.fillMaxWidth()) {
                            Text(if (halladas.size == 1) "Añadirla" else "Añadir las ${halladas.size}")
                        }
                    }
                }
            }
            OutlinedButton(onClick = onElegir, modifier = Modifier.fillMaxWidth()) { Text("Elegir otras de la galería") }
            if (estado.preparando > 0) {
                Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(if (estado.preparando == 1) "Preparando una foto…" else "Preparando ${estado.preparando} fotos…",
                        color = Paleta.slate400, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (estado.fotos.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Text(
                    "${estado.fotos.size} ${if (estado.fotos.size == 1) "foto" else "fotos"}" +
                        if (estado.sinSitio.isEmpty()) "" else " · ${estado.sinSitio.size} sin sitio (se ponen en el mapa)",
                    color = Paleta.slate400, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(6.dp))
                estado.fotos.chunked(3).forEach { fila ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        fila.forEach { f -> Celda(f, Modifier.weight(1f)) { estado.quita(f.id) } }
                        repeat(3 - fila.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
            Spacer(Modifier.height(12.dp))
        }
        if (estado.fotos.isNotEmpty()) {
            Button(
                onClick = {
                    estado.seleccionada = estado.sinSitio.firstOrNull()?.id
                    estado.fase = FotosEnRutaEstado.Fase.REPASO
                },
                enabled = estado.preparando == 0,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text("Ver en el mapa (${estado.fotos.size})", fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
private fun Celda(f: FotoDeRuta, modifier: Modifier, onQuitar: () -> Unit) {
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(8.dp))) {
        Image(f.miniatura, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        val (texto, fondo) = when (f.sitio?.modo) {
            ColocaFotos.Modo.POR_HORA -> "🕒 ${hora(f.fecha)}" to Color.Black.copy(alpha = 0.6f)
            ColocaFotos.Modo.POR_GPS -> "📍 GPS" to Color.Black.copy(alpha = 0.6f)
            ColocaFotos.Modo.A_MANO -> "✋ a mano" to Color.Black.copy(alpha = 0.6f)
            null -> "? sin sitio" to Color(0xE6F59E0B)
        }
        Text(
            texto, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.BottomStart).padding(5.dp)
                .clip(RoundedCornerShape(50)).background(fondo).padding(horizontal = 6.dp, vertical = 2.dp),
        )
        Box(
            Modifier.align(Alignment.TopEnd).padding(4.dp).size(24.dp).clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.6f)).clickable(onClick = onQuitar),
            contentAlignment = Alignment.Center,
        ) { Text("✕", color = Color.White, fontSize = 12.sp) }
    }
}

@Composable
private fun Repaso(estado: FotosEnRutaEstado, onSubir: () -> Unit) {
    val traza = estado.traza
    val densidad = LocalDensity.current
    val proyectada = remember(traza) { traza.map { TileMath.proyecta(it.lat, it.lon) } }
    Column(Modifier.fillMaxSize()) {
        // El trazado, encajado con la misma escala en los dos ejes.
        var tam by remember { mutableStateOf(IntSize.Zero) }
        Box(Modifier.weight(1f).fillMaxWidth().background(Color(0xFF0B1324)).onSizeChanged { tam = it }) {
            fun encaje(): (Pair<Double, Double>) -> Offset {
                val xs = proyectada.map { it.first }
                val ys = proyectada.map { it.second }
                val x0 = xs.min(); val x1 = xs.max(); val y0 = ys.min(); val y1 = ys.max()
                val margen = with(densidad) { 40.dp.toPx() }
                val escala = minOf(
                    (tam.width - 2 * margen) / (x1 - x0).coerceAtLeast(1e-12),
                    (tam.height - 2 * margen) / (y1 - y0).coerceAtLeast(1e-12),
                )
                val dx = (tam.width - (x1 - x0) * escala) / 2
                val dy = (tam.height - (y1 - y0) * escala) / 2
                return { (x, y) -> Offset((dx + (x - x0) * escala).toFloat(), (dy + (y - y0) * escala).toFloat()) }
            }
            Canvas(
                Modifier.fillMaxSize()
                    .pointerInput(traza, estado.fase) {
                        detectTapGestures { toque ->
                            if (estado.fase != FotosEnRutaEstado.Fase.REPASO || traza.isEmpty()) return@detectTapGestures
                            val aPantalla = encaje()
                            // Tocar una foto la elige; tocar en otro sitio mueve ahí la elegida.
                            val radio = with(densidad) { 24.dp.toPx() }
                            val tocada = estado.colocadas.firstOrNull { f ->
                                val s = f.sitio ?: return@firstOrNull false
                                val p = aPantalla(TileMath.proyecta(s.lat, s.lon))
                                f.id != estado.seleccionada && hypot(p.x - toque.x, p.y - toque.y) < radio
                            }
                            if (tocada != null) { estado.seleccionada = tocada.id; return@detectTapGestures }
                            val id = estado.seleccionada ?: return@detectTapGestures
                            var mejor = 0
                            var dMin = Float.MAX_VALUE
                            proyectada.forEachIndexed { i, p ->
                                val q = aPantalla(p)
                                val d = hypot(q.x - toque.x, q.y - toque.y)
                                if (d < dMin) { dMin = d; mejor = i }
                            }
                            estado.mueve(id, mejor)
                        }
                    },
            ) {
                if (tam == IntSize.Zero || proyectada.isEmpty()) return@Canvas
                val aPantalla = encaje()
                val camino = Path()
                proyectada.forEachIndexed { i, p ->
                    val o = aPantalla(p)
                    if (i == 0) camino.moveTo(o.x, o.y) else camino.lineTo(o.x, o.y)
                }
                drawPath(camino, Paleta.sky500, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawCircle(Paleta.verde, 6.dp.toPx(), aPantalla(proyectada.first()))
                drawCircle(Paleta.rojo, 6.dp.toPx(), aPantalla(proyectada.last()))
                val lado = 40.dp.toPx().toInt()
                // La elegida, encima de todas.
                val orden = estado.colocadas.sortedBy { it.id == estado.seleccionada }
                orden.forEach { f ->
                    val s = f.sitio ?: return@forEach
                    val o = aPantalla(TileMath.proyecta(s.lat, s.lon))
                    val elegida = f.id == estado.seleccionada
                    val borde = if (elegida) 3.dp.toPx() else 2.dp.toPx()
                    drawRect(if (elegida) Paleta.sky500 else Color.White,
                        topLeft = Offset(o.x - lado / 2 - borde, o.y - lado / 2 - borde),
                        size = androidx.compose.ui.geometry.Size(lado + 2 * borde, lado + 2 * borde))
                    drawImage(f.miniatura, dstOffset = IntOffset((o.x - lado / 2).toInt(), (o.y - lado / 2).toInt()),
                        dstSize = IntSize(lado, lado))
                }
            }
        }
        PanelDeRepaso(estado, onSubir)
    }
}

@Composable
private fun PanelDeRepaso(estado: FotosEnRutaEstado, onSubir: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Paleta.slate900).padding(vertical = 12.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            estado.fotos.forEach { f ->
                val elegida = f.id == estado.seleccionada
                Box(
                    Modifier.size(58.dp).clip(RoundedCornerShape(8.dp))
                        .border(3.dp, if (elegida) Paleta.sky500 else Color.Transparent, RoundedCornerShape(8.dp))
                        .clickable { estado.seleccionada = f.id },
                ) {
                    Image(f.miniatura, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    val marca = when {
                        f.sitio == null -> "?" to Paleta.ambar
                        f.id in estado.subidas -> "✓" to Paleta.verde
                        else -> null
                    }
                    marca?.let { (t, c) ->
                        Box(Modifier.align(Alignment.BottomEnd).padding(3.dp).size(16.dp).clip(CircleShape).background(c),
                            contentAlignment = Alignment.Center) { Text(t, color = Color.White, fontSize = 10.sp) }
                    }
                }
            }
        }
        Column(Modifier.padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(8.dp))
            val f = estado.fotos.firstOrNull { it.id == estado.seleccionada }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    f?.let { descripcion(it) } ?: "Toca una foto y luego el mapa para cambiarla de sitio.",
                    color = Paleta.slate400, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f),
                )
                if (f != null && estado.fase == FotosEnRutaEstado.Fase.REPASO) {
                    TextButton(onClick = { estado.quita(f.id) }) { Text("Quitar", color = Paleta.rojo) }
                }
            }
            if (!estado.sesion.isPinned) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Fijar la salida para que no caduque", color = Paleta.slate100,
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    Switch(checked = estado.fijar, onCheckedChange = { estado.fijar = it })
                }
            }
            estado.error?.let { Text(it, color = Paleta.rojo, style = MaterialTheme.typography.bodySmall) }
            val colocadas = estado.colocadas
            if (estado.fase == FotosEnRutaEstado.Fase.SUBIENDO) {
                Text("Subiendo ${minOf(estado.subidas.size + 1, colocadas.size)} de ${colocadas.size}…",
                    color = Paleta.slate100, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { estado.subidas.size / colocadas.size.coerceAtLeast(1).toFloat() },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                val n = colocadas.count { it.id !in estado.subidas }
                Button(onClick = onSubir, enabled = n > 0, modifier = Modifier.fillMaxWidth()) {
                    Text("Subir ${if (n == 1) "1 foto" else "$n fotos"} · ${tamano(colocadas.sumOf { it.datos.size })}",
                        fontWeight = FontWeight.SemiBold)
                }
                val sin = estado.sinSitio.size
                if (sin > 0) {
                    Text("$sin sin sitio: toca en el mapa dónde va, o no se subirá${if (sin == 1) "" else "n"}.",
                        color = Paleta.ambar, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

private fun descripcion(f: FotoDeRuta): String {
    val s = f.sitio ?: return "Sin sitio: toca el mapa donde la hiciste."
    val km = String.format(Locale.getDefault(), "%.1f", s.distM / 1000)
    return when (s.modo) {
        ColocaFotos.Modo.POR_HORA -> "${hora(f.fecha)} · km $km · por la hora"
        ColocaFotos.Modo.POR_GPS -> "km $km · por el GPS de la foto"
        ColocaFotos.Modo.A_MANO -> "km $km · puesta a mano"
    }
}
