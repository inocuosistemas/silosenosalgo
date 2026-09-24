package com.themakercrowd.silosenosalgo

import android.content.Intent

/**
 * La pantalla principal sin entrar, con carreras de muestra: solo en la de
 * depuración, para probarla en el emulador. Se pide con extras al abrir:
 * `adb shell am start -n …/.MainActivity --ez prueba true [--es carrera manana|rato]`.
 * Espejo de `PruebaDePantallaPrincipal` en iOS.
 */
object PruebaDePantalla {
    var pedida = false
        private set
    private var carrera: String? = null
    /** Empezar sin ninguna carrera preparada de antes. */
    var sinPreparar = false
        private set

    fun lee(intent: Intent?) {
        if (intent?.getBooleanExtra("prueba", false) == true) {
            pedida = true
            carrera = intent.getStringExtra("carrera")
            sinPreparar = intent.getBooleanExtra("sinPreparar", false)
        }
    }

    fun siembra() {
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
