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
        gps.onLectura = { CarreraConTrazado.llega(it) }
        scope.launch {
            CarreraConTrazado.estado.collectLatest { e ->
                if (e.enMarcha) notifica(construye(e))
                // En meta: la tarjeta se queda un rato enseñándolo y se va. Una vez.
                if (e.tramo?.enMeta == true && !metaProgramada) {
                    metaProgramada = true
                    handler.postDelayed({ CarreraConTrazado.termina(this@EnDirectoService) }, 30 * 60_000L)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACCION_TERMINAR) {
            CarreraConTrazado.termina(this)
            return START_NOT_STICKY
        }
        // Tras una muerte del proceso, el sistema lo vuelve a arrancar: se
        // retoma lo guardado; si no hay nada, fuera.
        if (!CarreraConTrazado.reanuda(this)) {
            arrancaEnPrimerPlano(NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(R.drawable.ic_notificacion).setContentTitle("Carrera en directo").build())
            paraTodo()
            return START_NOT_STICKY
        }
        arrancaEnPrimerPlano(construye(CarreraConTrazado.estado.value))
        gps.aplica(TrackingRules.AjusteGps(TrackingRules.Proveedor.GPS, 5_000L, 10f))
        handler.removeCallbacks(tic)
        handler.postDelayed(tic, 30_000)
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tic)
        gps.para()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun construye(e: CarreraConTrazado.Estado): Notification {
        val abrir = PendingIntent.getActivity(
            this, 20,
            Intent(this, MainActivity::class.java)
                .putExtra(EXTRA_ABRIR_EN_DIRECTO, true)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
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

    private fun arrancaEnPrimerPlano(n: Notification) {
        runCatching { startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) }
            .onFailure { paraTodo() }
    }

    private fun paraTodo() {
        handler.removeCallbacks(tic)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notifica(n: Notification) {
        runCatching { ContextCompat.getSystemService(this, NotificationManager::class.java)?.notify(ID, n) }
    }

    private fun creaCanal() {
        ContextCompat.getSystemService(this, NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CANAL, "En directo", NotificationManager.IMPORTANCE_LOW).apply {
                description = "La tarjeta de la carrera con tu ruta, mientras la sigues."
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val CANAL = "en-directo"
        private const val ID = 30
        const val ACCION_TERMINAR = "com.themakercrowd.silosenosalgo.EN_DIRECTO_TERMINAR"
        const val EXTRA_ABRIR_EN_DIRECTO = "abrir_en_directo"

        fun arranca(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, EnDirectoService::class.java))
        }

        fun para(ctx: Context) {
            ctx.stopService(Intent(ctx, EnDirectoService::class.java))
        }
    }
}
