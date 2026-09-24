package com.themakercrowd.silosenosalgo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * El GPS de las tarjetas EN DIRECTO que no son la baliza: la carrera con una
 * ruta propia (ver [CarreraConTrazado]). Un servicio en primer plano aparte
 * del de la baliza: no comparte nada con nadie, y sin él Android congela el GPS
 * a los pocos minutos de apagar la pantalla. Su notificación ES la tarjeta.
 */
class EnDirectoService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var gps: LocationEngine
    private val handler = Handler(Looper.getMainLooper())
    private var metaProgramada = false
    private var llegadaProgramada = false
    /** Qué notificación sostiene el servicio en primer plano. */
    private var enPrimerPlano: Int? = null
    private val tic = object : Runnable {
        override fun run() {
            CarreraConTrazado.tic()
            handler.postDelayed(this, 30_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        TrackingStore.inicia(this)
        creaCanal()
        gps = LocationEngine(this)
        gps.onLectura = {
            CarreraConTrazado.llega(it)
            ViajeEnDirecto.llega(it)
        }
        scope.launch {
            kotlinx.coroutines.flow.combine(CarreraConTrazado.estado, ViajeEnDirecto.estado) { c, v -> c to v }
                .collectLatest { (c, v) ->
                    refresca(c, v)
                    // En meta, o llegado: se queda un rato enseñándolo y se va. Una vez.
                    if (c.tramo?.enMeta == true && !metaProgramada) {
                        metaProgramada = true
                        handler.postDelayed({ CarreraConTrazado.termina(this@EnDirectoService) }, 30 * 60_000L)
                    }
                    if (v.llegado && !llegadaProgramada) {
                        llegadaProgramada = true
                        handler.postDelayed({ ViajeEnDirecto.termina(this@EnDirectoService) }, 30 * 60_000L)
                    }
                }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACCION_TERMINAR -> CarreraConTrazado.termina(this)
            ACCION_TERMINAR_VIAJE -> ViajeEnDirecto.termina(this)
        }
        // Tras una muerte del proceso, el sistema lo vuelve a arrancar: se
        // retoma lo guardado; si no queda nada, fuera.
        val carrera = CarreraConTrazado.reanuda(this)
        val viaje = ViajeEnDirecto.reanuda(this)
        if (!carrera && !viaje) {
            arrancaEnPrimerPlano(ID_CARRERA, NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(R.drawable.ic_notificacion).setContentTitle("En directo").build())
            paraTodo()
            return START_NOT_STICKY
        }
        refresca(CarreraConTrazado.estado.value, ViajeEnDirecto.estado.value)
        gps.aplica(TrackingRules.AjusteGps(TrackingRules.Proveedor.GPS, 5_000L, 10f))
        handler.removeCallbacks(tic)
        handler.postDelayed(tic, 30_000)
        return START_STICKY
    }

    /** Las dos tarjetas, cada una con su notificación; y el servicio, colgado
     *  de la que siga. Sin ninguna, se para (y con él, el GPS). */
    private fun refresca(c: CarreraConTrazado.Estado, v: ViajeEnDirecto.Estado) {
        val nm = ContextCompat.getSystemService(this, NotificationManager::class.java)
        val carrera = if (c.enMarcha) construye(c) else null
        val viaje = if (v.enMarcha && v.viaje != null) construyeViaje(v) else null
        if (carrera == null) nm?.cancel(ID_CARRERA)
        if (viaje == null) nm?.cancel(ID_VIAJE)
        when {
            carrera == null && viaje == null -> paraTodo()
            else -> {
                val (id, n) = if (carrera != null) ID_CARRERA to carrera else ID_VIAJE to viaje!!
                if (enPrimerPlano != id) arrancaEnPrimerPlano(id, n)
                carrera?.let { notifica(ID_CARRERA, it) }
                viaje?.let { notifica(ID_VIAJE, it) }
            }
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        gps.para()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun abrirApp(): PendingIntent = PendingIntent.getActivity(
        this, 20,
        Intent(this, MainActivity::class.java)
            .putExtra(EXTRA_ABRIR_EN_DIRECTO, true)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun construyeViaje(v: ViajeEnDirecto.Estado): Notification {
        val abrir = PendingIntent.getActivity(
            this, 22,
            Intent(this, MainActivity::class.java)
                .putExtra(EXTRA_ABRIR_VIAJE, true)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val terminar = PendingIntent.getService(
            this, 23, Intent(this, EnDirectoService::class.java).setAction(ACCION_TERMINAR_VIAJE), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificacionDeViaje.construye(this, CANAL, v, abrir, terminar)
    }

    private fun construye(e: CarreraConTrazado.Estado): Notification {
        val abrir = abrirApp()
        val terminar = PendingIntent.getService(
            this, 21,
            Intent(this, EnDirectoService::class.java).setAction(ACCION_TERMINAR),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val t = e.tramo
        if (t != null) {
            return NotificacionDeTramo.construye(this, CANAL, t, e.nombre, abrir to terminar, "Terminar")
        }
        return NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(e.nombre.ifBlank { "Carrera en directo" })
            .setContentText("Buscando tu posición en la ruta…")
            .setContentIntent(abrir)
            .addAction(0, "Terminar", terminar)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun arrancaEnPrimerPlano(id: Int, n: Notification) {
        runCatching {
            startForeground(id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            enPrimerPlano = id
        }.onFailure { paraTodo() }
    }

    private fun paraTodo() {
        handler.removeCallbacksAndMessages(null)
        enPrimerPlano = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notifica(id: Int, n: Notification) {
        runCatching { ContextCompat.getSystemService(this, NotificationManager::class.java)?.notify(id, n) }
    }

    private fun creaCanal() {
        ContextCompat.getSystemService(this, NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CANAL, "En directo", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Las tarjetas del viaje y de la carrera con tu ruta, mientras los sigues."
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val CANAL = "en-directo"
        private const val ID_CARRERA = 30
        private const val ID_VIAJE = 31
        const val ACCION_TERMINAR = "com.themakercrowd.silosenosalgo.EN_DIRECTO_TERMINAR"
        const val ACCION_TERMINAR_VIAJE = "com.themakercrowd.silosenosalgo.VIAJE_TERMINAR"
        const val EXTRA_ABRIR_EN_DIRECTO = "abrir_en_directo"
        const val EXTRA_ABRIR_VIAJE = "abrir_viaje"

        fun arranca(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, EnDirectoService::class.java))
        }

        /** Algo ha terminado: que el servicio vuelva a mirar qué queda. */
        fun refresca(ctx: Context) = arranca(ctx)

        fun para(ctx: Context) = refresca(ctx)
    }
}
