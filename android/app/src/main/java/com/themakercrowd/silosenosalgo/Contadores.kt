package com.themakercrowd.silosenosalgo

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.util.Calendar
import java.util.UUID

/**
 * Una CUENTA ATRÁS del widget: la de una carrera (sale sola de «Mis
 * carreras», con su cartel) o una propia (un viaje, un cumpleaños). Espejo de
 * `Contador` en iOS, sin los encuadres por formato: aquí la foto se recorta al
 * pintar el widget, a su tamaño.
 */
@Serializable
data class Contador(
    val id: String = UUID.randomUUID().toString(),
    /** "carrera" o "propio". */
    val origen: String = "propio",
    val nombre: String,
    val fechaMs: Double,
    /** Sin hora se cuentan días enteros: «un viaje en abril» no tiene hora. */
    val conHora: Boolean = true,
    val color: String = "#8b5cf6",
    /** El segundo color, si el fondo va en degradado. */
    val color2: String? = null,
    val emoji: String? = null,
    /** La foto de fondo: la propia (en `contadores/`) o el cartel de la carrera. */
    val foto: String? = null,
    val anual: Boolean = false,
    /** Al pasar: "ocultar" o "contarArriba" (el tiempo que lleva corriendo). */
    val alPasar: String = "ocultar",
    val aviso: Boolean = false,
    val eventoId: String? = null,
    val usaCartel: Boolean = false,
    /** Si se ha tocado su aspecto: la sincronización respeta color y emoji. */
    val aspectoPropio: Boolean = false,
) {
    val deCarrera: Boolean get() = origen == "carrera"

    /** La fecha que cuenta AHORA: la suya, o la del año que viene si es anual. */
    fun fechaVigente(ahoraMs: Double = System.currentTimeMillis().toDouble()): Double {
        if (!anual || fechaMs >= ahoraMs) return fechaMs
        val c = Calendar.getInstance().apply { timeInMillis = fechaMs.toLong() }
        while (c.timeInMillis < ahoraMs) c.add(Calendar.YEAR, 1)
        return c.timeInMillis.toDouble()
    }

    /** Los días enteros que faltan, y el momento en que ese número baja: la
     *  misma hora, un día antes. El reloj del widget cuenta hasta ahí solo. */
    fun diasYCorte(ahoraMs: Double = System.currentTimeMillis().toDouble()): Pair<Int, Double> {
        val fecha = fechaVigente(ahoraMs)
        val faltan = fecha - ahoraMs
        if (faltan <= 0) return 0 to fecha
        val dias = (faltan / 86_400_000).toInt()
        return dias to fecha - dias * 86_400_000.0
    }

    /** Si todavía tiene algo que enseñar: no ha pasado, o cuenta hacia arriba. */
    fun vigente(ahoraMs: Double = System.currentTimeMillis().toDouble()): Boolean =
        alPasar == "contarArriba" || fechaVigente(ahoraMs) > ahoraMs
}

object Contadores {
    /** Los doce colores de los participantes (shared/eventColors.ts). */
    val PORSLUG = mapOf(
        "sky" to "#0ea5e9", "emerald" to "#10b981", "amber" to "#f59e0b", "rose" to "#f43f5e",
        "violet" to "#8b5cf6", "lime" to "#a3e635", "orange" to "#fb923c", "cyan" to "#22d3ee",
        "fuchsia" to "#e879f9", "teal" to "#2dd4bf", "indigo" to "#818cf8", "pink" to "#f472b6",
    )
    val COLORES = listOf("#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#22d3ee", "#a3e635", "#fb923c", "#e879f9", "#f472b6")

    private val json = Json { ignoreUnknownKeys = true }
    private val _lista = MutableStateFlow<List<Contador>>(emptyList())
    val lista: StateFlow<List<Contador>> = _lista.asStateFlow()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("contadores", Context.MODE_PRIVATE)
    fun dirFotos(ctx: Context) = File(ctx.filesDir, "contadores").apply { mkdirs() }

    fun lee(ctx: Context): List<Contador> {
        val s = prefs(ctx).getString("lista", null) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(Contador.serializer()), s) }.getOrDefault(emptyList())
            .also { _lista.value = it }
    }

    fun guarda(ctx: Context, lista: List<Contador>) {
        prefs(ctx).edit().putString("lista", json.encodeToString(ListSerializer(Contador.serializer()), lista)).apply()
        _lista.value = lista
        WidgetCuentaAtras.refresca(ctx)
        AvisosDeContadores.reprograma(ctx, lista)
    }

    fun guardaUno(ctx: Context, c: Contador) {
        val todos = lee(ctx)
        guarda(ctx, if (todos.any { it.id == c.id }) todos.map { if (it.id == c.id) c else it } else todos + c)
    }

    fun borra(ctx: Context, id: String) {
        guarda(ctx, lee(ctx).filterNot { it.id == id })
    }

    /**
     * La SIGUIENTE que vence: la más cercana de las que todavía no han llegado
     * (el widget en automático; al vencer una, pasa a la siguiente). No vale la
     * primera de [ordenados], que pone delante las que ya pasaron y siguen
     * contando hacia arriba. Si no queda ninguna por llegar, la que siga
     * contando. Espejo de `AlmacenContadores.siguiente` en iOS.
     */
    fun siguiente(lista: List<Contador>, ahoraMs: Double = System.currentTimeMillis().toDouble()): Contador? {
        val todas = ordenados(lista, ahoraMs)
        return todas.firstOrNull { it.fechaVigente(ahoraMs) > ahoraMs } ?: todas.lastOrNull()
    }

    /** Lo que se enseña, en orden: el más cercano primero. */
    fun ordenados(lista: List<Contador>, ahoraMs: Double = System.currentTimeMillis().toDouble()): List<Contador> =
        lista.filter { it.vigente(ahoraMs) }.sortedBy { it.fechaVigente(ahoraMs) }

    /**
     * Las de carrera, al día con «Mis carreras»: las que tienen salida por
     * delante, con su cartel si lo tienen. Lo que se haya tocado a mano (el
     * color, el emoji, que cuente hacia arriba, el aviso) se respeta.
     */
    fun sincroniza(ctx: Context, eventos: List<EventSummary>) {
        val antes = lee(ctx)
        val porEvento = antes.filter { it.eventoId != null }.associateBy { it.eventoId!! }
        val deCarrera = eventos.filter { !it.isOver && it.startsAt != null }.map { ev ->
            val previo = porEvento[ev.id]
            val conCartel = previo?.usaCartel ?: (ev.hasPhoto == true)
            Contador(
                id = previo?.id ?: "carrera-${ev.id}",
                origen = "carrera",
                nombre = ev.name,
                fechaMs = ev.startsAt!!,
                conHora = true,
                color = if (previo?.aspectoPropio == true) previo.color else PORSLUG[ev.myColor] ?: "#8b5cf6",
                color2 = if (previo?.aspectoPropio == true) previo.color2 else null,
                emoji = if (previo?.aspectoPropio == true) previo.emoji else ev.myEmoji,
                foto = if (conCartel) cartel(ctx, ev) else previo?.foto,
                // El día de la carrera no desaparece: cuenta lo que llevas corriendo.
                alPasar = previo?.alPasar ?: "contarArriba",
                aviso = previo?.aviso ?: false,
                eventoId = ev.id,
                usaCartel = conCartel,
                aspectoPropio = previo?.aspectoPropio ?: false,
            )
        }
        guarda(ctx, deCarrera + antes.filter { !it.deCarrera })
    }

    /** El cartel de la carrera, si ya está en el móvil (lo guarda «Mis carreras»). */
    private fun cartel(ctx: Context, ev: EventSummary): String? {
        val dir = File(ctx.filesDir, "fotos-carreras")
        return dir.listFiles { f -> f.name.startsWith("${ev.id}-") }?.maxByOrNull { it.lastModified() }?.path
    }
}

/**
 * El aviso de cuando llega la fecha (si se pidió), con el despertador del
 * sistema. Se reprograman todos al guardar, y tras reiniciar el móvil.
 */
object AvisosDeContadores {
    private const val CANAL = "contadores"

    fun reprograma(ctx: Context, lista: List<Contador>) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val ahora = System.currentTimeMillis().toDouble()
        // Se quitan los de antes (uno por contador conocido) y se ponen los que toquen.
        lista.forEach { am.cancel(intencion(ctx, it.id)) }
        lista.filter { it.aviso }.forEach { c ->
            val cuando = c.fechaVigente(ahora)
            if (cuando <= ahora) return@forEach
            if (PreparacionDeCarrera.alarmasExactas(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando.toLong(), intencion(ctx, c.id))
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando.toLong(), intencion(ctx, c.id))
        }
    }

    private fun intencion(ctx: Context, id: String): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, id.hashCode(),
            Intent(ctx, AvisoDeContador::class.java).putExtra("id", id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    internal fun avisa(ctx: Context, id: String) {
        val c = Contadores.lee(ctx).firstOrNull { it.id == id } ?: return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Cuentas atrás", NotificationManager.IMPORTANCE_HIGH))
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("${c.emoji ?: "⏳"} ¡Ya es el día!")
            .setContentText(c.nombre)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(id.hashCode(), n) }
        // Los anuales vuelven a empezar.
        reprograma(ctx, Contadores.lee(ctx))
    }
}

class AvisoDeContador : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            AvisosDeContadores.reprograma(context, Contadores.lee(context))
            WidgetCuentaAtras.refresca(context)
            return
        }
        intent.getStringExtra("id")?.let { AvisosDeContadores.avisa(context, it) }
        WidgetCuentaAtras.refresca(context)
    }
}
