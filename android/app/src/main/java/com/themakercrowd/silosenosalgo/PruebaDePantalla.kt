package com.themakercrowd.silosenosalgo

import android.content.Intent
import androidx.compose.ui.graphics.asImageBitmap

/**
 * La pantalla principal sin entrar, con carreras de muestra: solo en la de
 * depuración, para probarla en el emulador. Se pide con extras al abrir:
 * `adb shell am start -n …/.MainActivity --ez prueba true [--es carrera manana|rato]`.
 * Espejo de `PruebaDePantallaPrincipal` en iOS.
 */
object PruebaDePantalla {
    var pedida = false
        private set
    var nota = false
        private set
    private var carrera: String? = null
    /** Empezar sin ninguna carrera preparada de antes. */
    var sinPreparar = false
        private set
    /** «Añadir fotos» a una salida terminada, con un recorrido y fotos de muestra. */
    var fotos = false
        private set
    /** Con `fotos`: sin las de muestra, para probar «Buscar las fotos de la ruta». */
    var sinFotos = false
        private set
    /** La hora fija de la salida de muestra (`--el inicio <epoch ms>`), para que
     *  coincida con la de las fotos que se meten en el emulador. */
    private var inicioFotos: Long? = null
    /** Sin marca elegida: la inicial en el botón de la cuenta. */
    var sinMarca = false
        private set

    fun lee(intent: Intent?) {
        nota = intent?.getBooleanExtra("nota", false) == true
        fotos = intent?.getBooleanExtra("fotos", false) == true
        sinFotos = intent?.getBooleanExtra("sinFotos", false) == true
        inicioFotos = intent?.getLongExtra("inicio", 0L)?.takeIf { it > 0 }
        if (intent?.getBooleanExtra("prueba", false) == true) {
            pedida = true
            carrera = intent.getStringExtra("carrera")
            sinPreparar = intent.getBooleanExtra("sinPreparar", false)
            sinMarca = intent.getBooleanExtra("sinMarca", false)
        }
    }

    /** Un bucle de dos horas en el Montseny y seis fotos: cuatro con la hora
     *  de la salida, una con solo GPS y una sin nada (va a mano). La subida es
     *  de mentira. Espejo de `PruebaDeFotosEnRuta` en iOS. */
    fun fotosEnRuta(): FotosEnRutaEstado {
        val inicio = inicioFotos?.toDouble() ?: (System.currentTimeMillis() - 86_400_000.0)
        val sesion = TrackSessionSummary(
            id = "pruebafotos0001", title = "Vuelta al Montseny", status = "ended",
            startedAt = inicio, expiresAt = inicio + 30 * 86_400_000.0, endedAt = inicio + 7_200_000,
            pinned = false,
        )
        val e = FotosEnRutaEstado(sesion)
        e.ponTrazado((0..120).map { i ->
            val a = i / 120.0 * 2 * Math.PI
            TrailPoint(inicio + i * 60_000.0, 41.77 + 0.02 * kotlin.math.sin(a), 2.43 + 0.03 * (1 - kotlin.math.cos(a)), 5)
        })
        e.subidor = { _, _ -> kotlinx.coroutines.delay(300) }
        if (sinFotos) return e
        val colores = listOf(0xFF14B8A6, 0xFFF97316, 0xFF22C55E, 0xFFEC4899, 0xFF6366F1, 0xFFEAB308)
        val minutos = listOf(8.0, 31.0, 55.0, 94.0, null, null)
        colores.forEachIndexed { i, color ->
            val bmp = android.graphics.Bitmap.createBitmap(180, 180, android.graphics.Bitmap.Config.ARGB_8888)
            val c = android.graphics.Canvas(bmp)
            c.drawColor(color.toInt())
            c.drawText("${i + 1}", 65f, 115f, android.graphics.Paint().apply {
                this.color = android.graphics.Color.WHITE; textSize = 64f; isFakeBoldText = true
            })
            val jpeg = java.io.ByteArrayOutputStream().use {
                bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, it); it.toByteArray()
            }
            e.anade(FotoDeRuta(
                miniatura = bmp.asImageBitmap(), datos = jpeg,
                fecha = minutos[i]?.let { inicio + it * 60_000 },
                gps = if (i == 4) 41.757 to 2.475 else null, origen = null,
            ))
        }
        e.subidor = { _, _ -> kotlinx.coroutines.delay(300) }
        return e
    }

    fun siembra() {
        Cuenta.siembraDePrueba(if (sinMarca) PerfilDeCuenta() else PerfilDeCuenta("🦊", "orange"))
        val ahora = System.currentTimeMillis().toDouble()
        val dia = 86_400_000.0
        val manana = java.util.Calendar.getInstance().apply {
            add(java.util.Calendar.DAY_OF_YEAR, 1)
            set(java.util.Calendar.HOUR_OF_DAY, 7); set(java.util.Calendar.MINUTE, 24)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis.toDouble()
        val primera = when (carrera) {
            "manana" -> manana
            "rato", "armada" -> ahora + 47 * 60_000.0
            // El aviso de 1 h salta en minuto y medio: para probarlo de verdad.
            "aviso" -> ahora + 61.5 * 60_000.0
            else -> ahora + 9 * dia
        }
        TrackingStore.marcaCargaDePrueba(
            when (carrera) {
                "cargando" -> TrackingStore.CargaDeCarreras.CARGANDO
                "fallo" -> TrackingStore.CargaDeCarreras.FALLO
                else -> TrackingStore.CargaDeCarreras.CARGADAS
            },
        )
        if (carrera == "cargando" || carrera == "fallo") return
        if (carrera == "armada") {
            TrackingStore.armadaDePrueba("e1", ahora + 47 * 60_000.0)
        }
        TrackingStore.siembraDePrueba(
            eventos = listOf(
                EventSummary(id = "e1", name = "Matxicots 26", startsAt = primera, myEmoji = "🦊"),
                EventSummary(id = "e2", name = "Ultra Pirineu", startsAt = ahora + 40 * dia, myEmoji = "🦊"),
            ),
            pasadas = listOf(
                EventSummary(id = "e0", name = "Matxicots 25", startsAt = ahora - 340 * dia, endedAt = ahora - 339 * dia, myEmoji = "🦊"),
            ),
            planes = listOf(
                PlanSummary(id = "p1", name = "Vuelta al Montseny", distanceKm = 42.0),
                PlanSummary(id = "p2", name = "Tirada larga domingo", distanceKm = 21.1),
            ),
        )
    }
}
