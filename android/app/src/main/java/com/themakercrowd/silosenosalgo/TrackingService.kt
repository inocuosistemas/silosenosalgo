package com.themakercrowd.silosenosalgo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * El servicio en primer plano que mantiene vivo el seguimiento.
 *
 * En iOS basta con el modo de fondo `location` y que la sesión esté activa; en
 * Android hace falta esto: un servicio declarado de tipo `location`, con una
 * notificación permanente visible. Sin él, el sistema deja de entregar
 * posiciones a los pocos minutos de apagarse la pantalla — y no avisa: las
 * lecturas simplemente dejan de llegar, que es el fallo más difícil de
 * diagnosticar de toda la app.
 *
 * En Android 14+ el tipo `location` exige que el permiso de ubicación esté YA
 * concedido en el momento de llamar a `startForeground`; si no, el sistema
 * lanza una excepción y mata el servicio. Por eso la pantalla pide los permisos
 * antes de arrancarlo y nunca al revés.
 */
class TrackingService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())

    /** El reintento periódico: vacía el atasco cuando vuelve la cobertura
     *  aunque quien camina esté parado, y dispara el latido de modo distancia. */
    private val tic = object : Runnable {
        override fun run() {
            TrackingStore.tic()
            handler.postDelayed(this, (TrackingRules.TICK_SEGUNDOS * 1000).toLong())
        }
    }

    /**
     * Se coge SIEMPRE con plazo, nunca indefinidamente: un bloqueo de CPU que se
     * quedase colgado por un fallo se comería la batería durante toda la
     * travesía, que es justo el desastre que esta app no se puede permitir.
     * Sin conteo de referencias, así que volver a cogerlo solo amplía el plazo.
     */
    private val bloqueoCpu: PowerManager.WakeLock? by lazy {
        ContextCompat.getSystemService(this, PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "slsns:seguimiento")
            ?.apply { setReferenceCounted(false) }
    }

    override fun onCreate() {
        super.onCreate()
        TrackingStore.inicia(this)
        TrackingStore.despertador = { ms -> runCatching { bloqueoCpu?.acquire(ms) } }
        TrackingStore.lectorBateria = ::leeBateria
        TrackingStore.avisadorDeAnimos = ::avisaDeAnimo
        creaCanal()
        // La notificación se mantiene al día con el estado: posiciones subidas,
        // atasco pendiente y hueco con los seguidores. Es la única ventana al
        // seguimiento cuando el móvil va en el bolsillo.
        scope.launch {
            TrackingStore.estado.collectLatest { estado ->
                if (estado.compartiendo) notifica(construyeNotificacion(estado))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Lo PRIMERO, pase lo que pase después: quien nos arranca usa
        // `startForegroundService`, y eso obliga a llamar a `startForeground` en
        // menos de 5 s o el sistema mata la app con una excepción. Vale también
        // cuando lo que toca es parar: se entra en primer plano y se sale
        // inmediatamente, que es feo pero es el contrato.
        arrancaEnPrimerPlano(construyeNotificacion(TrackingStore.estado.value))

        if (intent?.action == ACCION_PARAR) {
            scope.launch {
                TrackingStore.para()
                paraTodo()
            }
            return START_NOT_STICKY
        }

        // Arranque tras una muerte del proceso: el sistema nos revive sin intent
        // y sin interfaz. Si había una sesión en disco, se reanuda sola.
        if (!TrackingStore.estado.value.compartiendo && TrackingStore.haySesionGuardada()) {
            TrackingStore.reanudaDesdeDisco()
        }

        val estado = TrackingStore.estado.value
        if (!estado.compartiendo) {
            // Nada que seguir: no dejamos un servicio en primer plano huérfano
            // con una notificación que no significa nada.
            paraTodo()
            return START_NOT_STICKY
        }

        notifica(construyeNotificacion(estado))
        handler.removeCallbacks(tic)
        handler.postDelayed(tic, (TrackingRules.TICK_SEGUNDOS * 1000).toLong())

        // STICKY: si el sistema nos mata por memoria, que nos vuelva a arrancar.
        // Es la red de seguridad de las travesías largas; la reanudación real la
        // hace `reanudaDesdeDisco` con lo que quedó persistido.
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tic)
        TrackingStore.despertador = null
        TrackingStore.lectorBateria = null
        TrackingStore.avisadorDeAnimos = null
        runCatching { if (bloqueoCpu?.isHeld == true) bloqueoCpu?.release() }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun paraTodo() {
        handler.removeCallbacks(tic)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun arrancaEnPrimerPlano(notificacion: Notification) {
        runCatching {
            startForeground(
                ID_NOTIFICACION,
                notificacion,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        }.onFailure {
            // Sin permiso de ubicación el sistema rechaza un servicio de tipo
            // `location`. Se para en vez de quedarse a medias: un servicio vivo
            // que no puede leer el GPS solo gastaría batería mintiendo.
            paraTodo()
        }
    }

    /**
     * Nivel de batería (0…1) y si está cargando. Se lee del `Intent` pegajoso de
     * `ACTION_BATTERY_CHANGED` en vez de registrar un receptor permanente: es
     * una lectura instantánea, gratis, y no deja nada enganchado que haya que
     * acordarse de soltar.
     */
    private fun leeBateria(): Pair<Double, Boolean> {
        val intent = runCatching {
            registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        }.getOrNull() ?: return -1.0 to false

        val nivel = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val escala = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val estado = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val cargando = estado == BatteryManager.BATTERY_STATUS_CHARGING ||
            estado == BatteryManager.BATTERY_STATUS_FULL
        val fraccion = if (nivel >= 0 && escala > 0) nivel.toDouble() / escala else -1.0
        return fraccion to cargando
    }

    /**
     * Un ánimo nuevo, avisando de verdad.
     *
     * Va en su PROPIO canal y con importancia normal, al revés que la
     * notificación del seguimiento: aquella es una pastilla de estado que no
     * debe molestar, y esta es justo lo contrario — alguien se ha molestado en
     * escribirte mientras andas, y el móvil va en el bolsillo. Si no suena, no
     * se entera nadie.
     */
    private fun avisaDeAnimo(nick: String?, texto: String, cuantos: Int) {
        val titulo = when {
            cuantos > 1 -> "💬 $cuantos ánimos nuevos"
            !nick.isNullOrBlank() -> "💬 $nick te anima"
            else -> "💬 Un ánimo nuevo"
        }
        val abrir = PendingIntent.getActivity(
            this, 2,
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val aviso = NotificationCompat.Builder(this, CANAL_ANIMOS)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        val nm = ContextCompat.getSystemService(this, NotificationManager::class.java)
        runCatching { nm?.notify(ID_ANIMO, aviso) }
    }

    private fun notifica(n: Notification) {
        val nm = ContextCompat.getSystemService(this, NotificationManager::class.java)
        runCatching { nm?.notify(ID_NOTIFICACION, n) }
    }

    private fun creaCanal() {
        val canal = NotificationChannel(
            CANAL,
            "Seguimiento en vivo",
            // Baja a propósito: es una notificación permanente de estado, no un
            // aviso. Sin sonido ni vibración, pero no se puede ocultar mientras
            // el servicio viva — eso lo impone el sistema, y está bien que así sea.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Mantiene el seguimiento activo mientras compartes tu posición."
            setShowBadge(false)
        }
        val canalAnimos = NotificationChannel(
            CANAL_ANIMOS,
            "Ánimos",
            // Normal, no baja: esto SÍ tiene que interrumpir. La notificación
            // del seguimiento es una pastilla de estado; un ánimo es alguien
            // hablándote mientras andas con el móvil en el bolsillo.
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Mensajes de quienes siguen tu ruta."
        }
        ContextCompat.getSystemService(this, NotificationManager::class.java)?.apply {
            createNotificationChannel(canal)
            createNotificationChannel(canalAnimos)
        }
    }

    /**
     * El texto dice lo que de verdad importa mirar de un vistazo: si está
     * transmitiendo, cuánto lleva sin llegar al servidor y cuánto se ha quedado
     * atrás lo que ven los seguidores.
     */
    private fun construyeNotificacion(estado: TrackingStore.Estado): Notification {
        val titulo = when {
            estado.enEspera -> "Preparado · aún sin transmitir"
            estado.pendientes > 0 -> "Sin cobertura · ${estado.pendientes} en cola"
            else -> "Compartiendo tu posición"
        }
        val detalle = buildString {
            if (estado.enEspera) {
                append("Empezará a la hora prevista.")
            } else {
                append("${estado.subidas} posiciones enviadas")
                estado.seguidores?.let { append(" · $it siguiendo") }
                estado.huecoMetros?.takeIf { it > 50 }?.let {
                    append(" · ${TrackingRules.formateaDistancia(it)} por detrás")
                }
            }
        }

        val abrir = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val parar = PendingIntent.getService(
            this, 1,
            Intent(this, TrackingService::class.java).setAction(ACCION_PARAR),
            PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CANAL)
            .setContentTitle(titulo)
            .setContentText(detalle)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentIntent(abrir)
            .addAction(0, "Dejar de compartir", parar)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val CANAL = "seguimiento"
        private const val CANAL_ANIMOS = "animos"
        private const val ID_NOTIFICACION = 1
        private const val ID_ANIMO = 2
        const val ACCION_PARAR = "com.themakercrowd.silosenosalgo.PARAR"

        /** Arranca el servicio. Se llama SIEMPRE desde la pantalla y con los
         *  permisos ya concedidos: Android 14+ no deja arrancar un servicio de
         *  tipo `location` desde segundo plano ni sin el permiso dado. */
        fun arranca(context: Context) {
            val intent = Intent(context, TrackingService::class.java)
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }

        fun para(context: Context) {
            val intent = Intent(context, TrackingService::class.java).setAction(ACCION_PARAR)
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }
    }
}
