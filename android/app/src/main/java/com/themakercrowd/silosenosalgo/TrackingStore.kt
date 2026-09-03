package com.themakercrowd.silosenosalgo

import android.content.Context
import android.location.Location
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/**
 * La sesión de seguimiento en vivo: la crea en el backend y va subiendo la
 * última posición al ritmo elegido. Espejo de `ios/Sources/TrackingStore.swift`.
 *
 * Es un singleton de aplicación a propósito. En Android el proceso puede morir y
 * revivir por su cuenta —lo revive el propio servicio en primer plano al
 * reiniciarse—, y cuando eso pasa no hay ninguna pantalla creada todavía: quien
 * reanuda la sesión no es la interfaz, es esto.
 *
 * El orden de las operaciones es el que importa y es el mismo que en iOS:
 * **registrar en local, persistir, y solo entonces intentar subir**. Cualquier
 * fallo de red deja el atasco intacto para el siguiente intento.
 */
object TrackingStore {

    /** Todo lo que la interfaz necesita saber, en un solo sitio. */
    data class Estado(
        val compartiendo: Boolean = false,
        /** Armada pero en silencio: la sesión existe y cuenta atrás, pero no se
         *  transmite hasta que llega la hora de salida. */
        val enEspera: Boolean = false,
        val sessionId: String? = null,
        val titulo: String? = null,
        val perfil: TrackingRules.Perfil = TrackingRules.Perfil.EQUILIBRADO,
        val ritmo: TrackingRules.Ritmo = TrackingRules.Ritmo(),
        val actividad: BeaconActivity? = null,
        /** Ruta planificada asociada, si se eligió una antes de empezar. */
        val planId: String? = null,
        /** Evento al que se atribuye esta salida. null = baliza suelta, que es
         *  lo normal: los eventos son la excepción, no el modo por defecto. */
        val eventoId: String? = null,
        val salidaMs: Double = 0.0,
        /** Si la salida la fijó alguien (el plan, o la mano). Sin tocar, la
         *  salida es EL MOMENTO DE PULSAR "Empezar", no el de abrir la
         *  pantalla: espejo de `startAtTouched` en iOS. */
        val salidaTocada: Boolean = false,
        val retenerHoras: Double = 48.0,
        /**
         * Emitiendo por RED en vez de por GPS. Pasa cuando el GPS está apagado
         * o el móvil en modo de ubicación de ahorro: la app se cae al respaldo
         * para no quedarse sin nada, pero las posiciones traen treinta metros de
         * error y ninguna velocidad. Hay que decirlo, porque por fuera parece
         * que todo va bien.
         */
        val porRed: Boolean = false,
        /** Sin permiso de ubicación PRECISA, Android da posiciones de kilómetros. */
        val sinPrecision: Boolean = false,
        /**
         * Ha llegado al final del recorrido. No para la baliza sola —hay quien
         * sigue andando hasta el coche, y cortar la traza por su cuenta seria
         * decidir por el— pero lo dice y ofrece dejar de compartir.
         */
        val enMeta: Boolean = false,
        /** Posiciones registradas y aún sin subir (atasco sin cobertura). */
        val pendientes: Int = 0,
        /** Posiciones efectivamente subidas en esta sesión. */
        val subidas: Int = 0,
        val ultimoEnvioMs: Double? = null,
        val seguidores: Int? = null,
        val error: String? = null,
        val ultimaLectura: Fix? = null,
        val ultimaReportada: Fix? = null,
        val puntosTraza: Int = 0,
        val metrosRecorridos: Double = 0.0,
        /** Notas de campo ancladas en esta sesión. */
        val notas: Int = 0,
        /** Lecturas que no superaron el ruido y se registraron manteniendo la
         *  posición. Se enseña para poder juzgar el umbral con datos: si son
         *  muchas andando, es que está demasiado alto. */
        val retenidas: Int = 0,
        /** Nivel de batería 0…1, negativo si no se sabe. */
        val nivelBateria: Double = -1.0,
        val cargando: Boolean = false,
        /** Gasto MEDIDO (% por hora) y autonomía estimada a ese ritmo. Nulos
         *  hasta que ha pasado el tiempo suficiente para que signifiquen algo. */
        val gastoBateriaPorHora: Double? = null,
        val horasRestantes: Double? = null,
        /** Uso de medios en el servidor frente a la cuota del usuario. Nulos
         *  hasta la primera consulta (o sin cobertura). */
        val usadoBytes: Long? = null,
        val cuotaBytes: Long? = null,
    ) {
        /** Cuánto se ha quedado atrás lo que ven los seguidores. Crece en las
         *  zonas sin cobertura y se desploma al vaciarse el atasco. */
        val huecoMetros: Double?
            get() = TrackingRules.huecoSeguidores(ultimaLectura, ultimaReportada)

        val enlace: String? get() = sessionId?.let { Config.shareLink(it) }

        /** La que se enseña: la declarada o, en "Automático", la deducida. */
        val actividadEfectiva: BeaconActivity? get() = actividad ?: actividadDeducida
    }

    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    /** "Mis seguimientos": las sesiones del usuario, ya ordenadas. */
    private val _sesiones = MutableStateFlow<List<TrackSessionSummary>>(emptyList())
    val sesiones: StateFlow<List<TrackSessionSummary>> = _sesiones.asStateFlow()

    /** Las rutas planificadas que se pueden asociar a una sesión. */
    private val _planes = MutableStateFlow<List<PlanSummary>>(emptyList())
    val planes: StateFlow<List<PlanSummary>> = _planes.asStateFlow()

    /** Los eventos en los que participo, para elegir uno al salir. */
    private val _eventos = MutableStateFlow<List<EventSummary>>(emptyList())
    val eventos: StateFlow<List<EventSummary>> = _eventos.asStateFlow()

    /** Las guías `.slsnsguide` importadas, para consultarlas sin conexión. */
    private val _guias = MutableStateFlow<List<GuideRules.GuiaLocal>>(emptyList())
    val guias: StateFlow<List<GuideRules.GuiaLocal>> = _guias.asStateFlow()

    /** Las notas de campo de la sesión actual, de la más nueva a la más vieja. */
    private val _notas = MutableStateFlow<List<Note>>(emptyList())
    val notas: StateFlow<List<Note>> = _notas.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var almacen: LocalStore
    /** El contexto de aplicación, solo para leer el nombre del aparato. */
    private var appCtx: Context? = null

    /**
     * El RECORRIDO de esta salida, en memoria, para poder decir por qué
     * kilómetro va quien corre.
     *
     * Hasta ahora `trackKm` viajaba siempre a null: nadie lo calculaba. Sin él
     * el mapa del evento tenía que adivinar el kilómetro proyectando la
     * posición sobre el trazado por cercanía, que en un circuito que acaba
     * donde empieza pone en el km 0 al que acaba de cruzar meta —y con eso no
     * hay forma de saber quién ha terminado—.
     */
    private var rutaPuntos: List<PlanGeometry.PuntoPlan>? = null
    private var rutaKmAcum: List<Double>? = null
    /** El último kilómetro conocido: es lo que impide saltar hacia atrás. */
    private var ultimoKmRuta: Double? = null
    private lateinit var motor: LocationEngine
    private var api: Api = Api()
    private var tokenStore: TokenStore? = null

    private var pendientes: List<Fix> = emptyList()
    private var traza: List<TrailPoint> = emptyList()
    private var notasPendientes: List<Note> = emptyList()
    private var borradosPendientes: List<String> = emptyList()
    private var vaciandoNotas = false
    private var mediosPendientes: List<LocalStore.MedioPendiente> = emptyList()
    private var vaciandoMedios = false
    private var muestrasBateria: List<TrackingRules.MuestraBateria> = emptyList()
    private var ultimaMuestraMs = 0.0
    private var actividadDeducida: BeaconActivity? = null
    private var ultimoIntentoMs: Double = 0.0

    /** La última posición que se dio por buena. Todo se compara contra ella, no
     *  contra la lectura anterior: así un avance lento pero real acaba
     *  acumulando y se detecta, en vez de perderse paso a paso. */
    private var anclaPosicion: Fix? = null
    private var vaciando = false
    private var iniciado = false

    /** El motor del GPS, para que el servicio pueda consultar permisos y estado
     *  del aparato sin duplicar la lógica. */
    val gps: LocationEngine get() = motor

    /**
     * Pide mantener la CPU despierta unos milisegundos. Lo pone el servicio (es
     * quien puede tocar `PowerManager`); aquí solo se avisa de cuándo hace
     * falta.
     *
     * Sin esto, la lectura de posición despierta el móvil lo justo para entregar
     * el punto y se vuelve a dormir con la subida a medias, así que el atasco
     * crece sin que nada falle a la vista.
     */
    var despertador: ((Long) -> Unit)? = null

    /** Lee el nivel de batería (0…1, negativo si se desconoce) y si está
     *  cargando. Lo pone el servicio, por el mismo motivo que [despertador]. */
    var lectorBateria: (() -> Pair<Double, Boolean>)? = null

    private val ahoraMs: Double get() = System.currentTimeMillis().toDouble()

    // ── Ciclo de vida ────────────────────────────────────────────────────────

    /** Se llama una vez por proceso, desde el servicio o desde la actividad. */
    fun inicia(context: Context) {
        if (iniciado) return
        iniciado = true
        val app = context.applicationContext
        appCtx = app
        almacen = LocalStore(app)
        _notaRelevo.value = almacen.leeNotaRelevo()
        tokenStore = TokenStore(app)
        motor = LocationEngine(app)
        motor.onLectura = ::alLlegarLectura
    }

    private val token: String? get() = tokenStore?.token

    // ── Empezar y parar ──────────────────────────────────────────────────────

    /**
     * Crea la sesión en el backend y empieza a transmitir. Si la salida prevista
     * aún queda lejos, la sesión queda ARMADA en espera: existe y se puede
     * compartir el enlace, pero no gasta GPS hasta que se acerca la hora.
     */
    /**
     * La sesion viva de esta cuenta que NO es la de este movil, si la hay.
     *
     * El servidor solo admite UNA sesion por cuenta y cierra la anterior al
     * crear otra, sin avisar. Con dos moviles —uno de reserva, el del
     * acompanante, el viejo con mas bateria— eso dejaba el otro mudo sin que
     * nadie lo dijera. Se pregunta ANTES de crearla: despues ya esta hecho.
     *
     * Sin cobertura devuelve null y se arranca igual: quedarse sin salir por no
     * poder comprobar algo seria el peor de los dos fallos.
     */
    /**
     * Como se llama una sesion cuando hay que hablar de ella.
     *
     * Manda el EVENTO por encima de la ruta: una baliza unida a una carrera es
     * "la Urbion", no "urbion-37k-v3.gpx". El nombre de la ruta es de archivo
     * —lleva versiones, fechas y la coletilla de la organizacion— y no es como
     * se llama esa salida entre quienes la corren.
     */
    /**
     * Como se llama ESTE aparato, para que el otro movil sepa quien le quito la
     * baliza. El nombre que le puso su dueño ("Galaxy de Jose") si el sistema lo
     * da, y si no el modelo, que ya distingue un movil de otro.
     */
    private fun nombreDeEsteAparato(): String {
        val puesto = runCatching {
            appCtx?.let { android.provider.Settings.Global.getString(it.contentResolver, "device_name") }
        }.getOrNull()
        if (!puesto.isNullOrBlank()) return puesto
        return "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim()
    }

    fun nombreDeSesion(s: TrackSessionSummary): String {
        val ev = s.eventId?.let { id -> _eventos.value.firstOrNull { it.id == id } }
        return ev?.name ?: s.title ?: s.planName ?: "Sin nombre"
    }

    suspend fun otraBalizaViva(): TrackSessionSummary? {
        val t = token ?: return null
        val mia = _estado.value.sessionId
        return runCatching { api.listSessions(t) }.getOrNull()
            ?.firstOrNull { it.isActive && it.id != mia }
    }

    suspend fun empieza(
        titulo: String?,
        planId: String? = _estado.value.planId,
        // Sin salida fijada se usa "ahora" EN EL MOMENTO de compartir, no el
        // valor rancio de cuando se abrió la pantalla (como en iOS).
        salidaMs: Double = _estado.value.salidaMs.takeIf { _estado.value.salidaTocada } ?: ahoraMs,
        actividad: BeaconActivity? = _estado.value.actividad,
    ): Result<String> {
        val t = token ?: return Result.failure(ApiException(401, "unauthorized"))
        return runCatching {
            val res = api.createTrack(
                t, titulo, planId, salidaMs, actividad, _estado.value.eventoId, nombreDeEsteAparato(),
            )
            pendientes = emptyList()
            traza = emptyList()
            notasPendientes = emptyList()
            borradosPendientes = emptyList()
            mediosPendientes = emptyList()
            _notas.value = emptyList()
            actividadDeducida = null
            ultimoIntentoMs = 0.0
            anclaPosicion = null
            almacen.guardaPendientes(res.id, pendientes)
            almacen.guardaTraza(res.id, traza)
            almacen.guardaNotas(res.id, _notas.value)
            almacen.guardaNotasPendientes(res.id, notasPendientes)
            almacen.guardaBorradosPendientes(res.id, borradosPendientes)
            almacen.guardaMediosPendientes(res.id, mediosPendientes)
            val enEspera = salidaMs - ahoraMs > TrackingRules.ANTELACION_SALIDA_SEGUNDOS * 1000
            _estado.value = Estado(
                compartiendo = true,
                enEspera = enEspera,
                sessionId = res.id,
                titulo = titulo,
                perfil = _estado.value.perfil,
                ritmo = _estado.value.ritmo,
                actividad = actividad,
                planId = planId,
                salidaMs = salidaMs,
                retenerHoras = _estado.value.retenerHoras,
            )
            aplicaGps()
            ViewerData.registra(res.id)
            cachePlan(res.id, planId)
            guardaActivo()
            scope.launch { cargaSesiones() }
            res.id
        }.onFailure { e ->
            _estado.value = _estado.value.copy(
                error = (e as? ApiException)?.message ?: "No se pudo iniciar el seguimiento.",
            )
        }
    }

    /**
     * Reanuda una sesión que ya existía: tras un reinicio del móvil o después de
     * que el sistema matase el proceso. No crea nada en el backend — el endpoint
     * de ping ya acepta una sesión propia y activa.
     */
    fun reanudaDesdeDisco(): Boolean {
        val guardado = almacen.leeActivo() ?: return false
        pendientes = almacen.leePendientes(guardado.sessionId)
        traza = almacen.leeTraza(guardado.sessionId)
        // El recorrido ya está en disco de cuando empezó: sin esto, reanudar
        // tras una muerte del proceso dejaba de calcular el kilómetro a mitad
        // de carrera.
        cargaGeometriaGuardada(guardado.sessionId)
        cargaNotasDe(guardado.sessionId)
        cargaAnimosDe(guardado.sessionId)
        almacen.leeForma(guardado.sessionId)?.let { ViewerData.cargaForma(it.factor, it.log) }
        actividadDeducida = TrackingRules.deduceActividad(traza)
        ultimoIntentoMs = 0.0
        anclaPosicion = null
        _estado.value = Estado(
            compartiendo = true,
            enEspera = guardado.enEspera &&
                !TrackingRules.tocaEmpezar(ahoraMs, guardado.salidaMs),
            sessionId = guardado.sessionId,
            titulo = guardado.titulo,
            perfil = runCatching { TrackingRules.Perfil.valueOf(guardado.perfil) }
                .getOrDefault(TrackingRules.Perfil.EQUILIBRADO),
            ritmo = TrackingRules.Ritmo(
                modo = runCatching { TrackingRules.Modo.valueOf(guardado.modo) }
                    .getOrDefault(TrackingRules.Modo.DISTANCIA),
                intervaloSegundos = guardado.intervaloSegundos,
                distanciaMetros = guardado.distanciaMetros,
            ),
            actividad = BeaconActivity.fromWire(guardado.actividad),
            eventoId = guardado.eventoId,
            salidaMs = guardado.salidaMs,
            retenerHoras = guardado.retenerHoras,
            pendientes = pendientes.size,
            puntosTraza = traza.size,
            metrosRecorridos = TrackingRules.distanciaTraza(traza),
            notas = _notas.value.size,
            ultimaLectura = traza.lastOrNull()?.let { Fix(it.lat, it.lon, fixAt = it.t) },
        )
        aplicaGps()
        ViewerData.registra(guardado.sessionId)
        return true
    }

    /** Deja de transmitir: vacía lo que quede, cierra la sesión en el backend y
     *  borra el rastro local. Lo que quede sin subir se intenta una última vez. */
    suspend fun para() {
        val id = _estado.value.sessionId
        val t = token
        motor.para()
        if (id != null && t != null) {
            if (pendientes.isNotEmpty()) {
                runCatching { api.pingBatch(t, id, pendientes) }
            }
            // Último intento con lo que quede de notas: al terminar es cuando
            // suele haber cobertura otra vez (se vuelve del monte), y una nota
            // perdida no se puede volver a tomar.
            for (nota in notasPendientes) {
                runCatching { api.createNote(t, id, nota) }
            }
            for (noteId in borradosPendientes) {
                runCatching { api.deleteNote(t, id, noteId) }
            }
            for (medio in mediosPendientes) {
                val datos = almacen.leeMedio(id, medio.file) ?: continue
                val mime = if (medio.kind == "audio") "audio/mp4" else "image/jpeg"
                runCatching { api.uploadNoteMedia(t, id, medio.noteId, medio.kind, datos, mime) }
            }
            // Si se dejó en "Automático", se congela el tipo deducido para que
            // la sesión terminada se identifique después en "Mis seguimientos".
            if (_estado.value.actividad == null) {
                actividadDeducida?.let { api.setActivity(t, id, it) }
            }
            api.end(t, id, _estado.value.retenerHoras)
            // Los ficheros locales NO se borran: la traza, las notas y las fotos
            // son lo que permite revisar la ruta o exportarla como guía después,
            // sin cobertura. Se limpian al borrar la sesión o al podar.
        }
        almacen.borraActivo()
        ViewerData.registra(null)
        pendientes = emptyList()
        traza = emptyList()
        notasPendientes = emptyList()
        borradosPendientes = emptyList()
        mediosPendientes = emptyList()
        _notas.value = emptyList()
        actividadDeducida = null
        _estado.value = Estado(
            perfil = _estado.value.perfil,
            ritmo = _estado.value.ritmo,
            retenerHoras = _estado.value.retenerHoras,
        )
        // El backend conserva la sesión recién terminada durante la retención
        // elegida: se refresca para que aparezca ya en "Mis seguimientos".
        cargaSesiones()
    }

    // ── Mis seguimientos y planes ────────────────────────────────────────────

    /** Refresca la lista. Al mejor esfuerzo: si falla se queda la que había —
     *  sin cobertura, una lista vieja es más útil que una lista vacía. */
    suspend fun cargaSesiones() {
        val t = token ?: return
        runCatching { api.listSessions(t) }
            .onSuccess { lista ->
                _sesiones.value = TrackingRules.ordenaSesiones(lista)

                // Poda, como `LocalStore.prune` en iOS: se tira lo local de las
                // sesiones que el servidor YA NI LISTA. No es lo mismo que
                // caducar —una caducada sigue en la lista y conserva su traza
                // aquí—; esto es para las que se borraron de verdad. Sin ello,
                // el móvil de quien sale a diario acumula trazas y fotos para
                // siempre.
                //
                // Se conservan siempre la sesión en marcha y las guías
                // importadas: esas no las lista el servidor y no son suyas.
                val conservar = lista.map { it.id }.toMutableSet()
                _estado.value.sessionId?.let { conservar.add(it) }
                conservar.addAll(_guias.value.map { it.id })
                almacen.poda(conservar)
            }
        // Y barrer las carpetas vacías, que no tienen nada que perder.
        almacen.limpiaVacias()
    }

    /**
     * Refresca el uso de almacenamiento del usuario. Al mejor esfuerzo: sin
     * cobertura o si falla, se dejan los últimos valores conocidos intactos —
     * nunca se ponen a cero, porque un cero mentiría diciendo que hay sitio.
     */
    suspend fun refrescaAlmacenamiento() {
        val t = token ?: return
        runCatching { api.storage(t) }.onSuccess {
            _estado.value = _estado.value.copy(
                usadoBytes = it.usedBytes,
                cuotaBytes = it.quotaBytes,
            )
        }
    }

    /** Lo que ocupan en local los medios de la sesión actual. */
    fun bytesMediosSesion(): Long =
        _estado.value.sessionId?.let { almacen.bytesMedios(it) } ?: 0L

    /** Fotos y audios de la sesión actual. */
    fun cuentaMediosSesion(): Pair<Int, Int> =
        _estado.value.sessionId?.let { almacen.cuentaMedios(it) } ?: (0 to 0)

    suspend fun cargaPlanes() {
        val t = token ?: return
        runCatching { api.listPlans(t) }.onSuccess { _planes.value = it }
    }

    /** Refresca mis eventos. Al mejor esfuerzo: si falla, la baliza funciona
     *  igual que siempre y el selector simplemente no aparece. */
    suspend fun cargaEventos() {
        val t = token ?: return
        runCatching { api.listEvents(t) }.onSuccess { lista ->
            _eventos.value = lista.filter { !it.isOver }
        }
    }

    /** El evento de la salida en curso, para enseñarlo mientras se emite. */
    fun eventoActual(): EventSummary? =
        _estado.value.eventoId?.let { id -> _eventos.value.firstOrNull { it.id == id } }

    /**
     * Cambia el evento al que se atribuye la salida.
     *
     * Antes de salir es solo una elección local (viaja al crear la sesión). En
     * marcha hay que decírselo al servidor: la sesión ya existe, y obligar a
     * pararla y volver a empezar para corregir el evento partiría la traza en
     * dos. Mismo camino que el lobby de la web.
     */
    fun ajustaEvento(eventoId: String?) {
        val anterior = _estado.value.eventoId
        // La salida OFICIAL del evento pasa a ser la prevista, igual que hace
        // el plan al elegirlo. Es lo que ya sabe la organización y lo que nadie
        // debería tener que teclear a mano en la línea de salida con guantes —y
        // de paso, si aún falta para la hora, la baliza se queda ARMADA y en
        // silencio en vez de gastar GPS y enseñar dónde has aparcado.
        //
        // Solo se pisa la hora si NO la ha puesto nadie a mano: quien la ha
        // tocado sabrá por qué (sale en otra tanda, o el organizador no la ha
        // corregido todavía), y una app que le deshace la elección al cambiar
        // de evento es una app en la que no se puede confiar. Al quitar el
        // evento, la hora puesta por él se va con él.
        val ev = _eventos.value.firstOrNull { it.id == eventoId }
        val salidaEvento = ev?.startsAt?.takeIf { it > 0.0 }
        val laPusoElEvento = _estado.value.salidaMs > 0.0 &&
            _eventos.value.any { it.id == anterior && it.startsAt == _estado.value.salidaMs }
        val libre = !_estado.value.salidaTocada || laPusoElEvento
        _estado.value = when {
            libre && salidaEvento != null ->
                _estado.value.copy(eventoId = eventoId, salidaMs = salidaEvento, salidaTocada = true)
            libre && laPusoElEvento ->
                _estado.value.copy(eventoId = eventoId, salidaMs = 0.0, salidaTocada = false)
            else -> _estado.value.copy(eventoId = eventoId)
        }
        guardaActivo()
        if (!_estado.value.compartiendo) return
        val t = token ?: return
        scope.launch {
            // Quitar primero del anterior: una sesión pertenece a un evento, no
            // a dos, y el servidor solo conoce la petición que le llega.
            if (anterior != null && anterior != eventoId) {
                runCatching { api.attachBeacon(t, anterior, false) }
            }
            if (eventoId != null) {
                runCatching { api.attachBeacon(t, eventoId, true) }.onFailure {
                    // Sin baliza viva o sin permiso: se deshace la elección para
                    // no enseñar un evento al que en realidad no se está unido.
                    _estado.value = _estado.value.copy(
                        eventoId = anterior,
                        error = "No se pudo unir la baliza al evento.",
                    )
                    guardaActivo()
                }
            }
        }
    }

    /**
     * Asocia una ruta planificada. La salida por defecto pasa a ser la DEL PLAN
     * y no el momento de activar, para que los ritmos y las predicciones que ve
     * quien sigue la ruta vayan contra lo planificado.
     */
    fun eligePlan(planId: String?) {
        val plan = _planes.value.firstOrNull { it.id == planId }
        val salida = TrackingRules.parseaIso(plan?.startTime)
        // Sin plan (o sin hora en el plan) la salida vuelve a "ahora", que se
        // resuelve al pulsar "Empezar": dejar aquí la hora de este instante la
        // volvería rancia si se comparte más tarde.
        _estado.value = _estado.value.copy(
            planId = planId,
            salidaMs = salida ?: 0.0,
            salidaTocada = salida != null,
        )
    }

    /**
     * Mientras esta ARMADA, comprobar de vez en cuando que la sesion sigue
     * siendo suya.
     *
     * Una baliza armada calla a proposito hasta la hora de salida, asi que
     * nunca recibe el 410 que le diria que el servidor la cerro —lo que pasa en
     * cuanto otro movil de la misma cuenta arma la suya—. Sin esto se queda
     * enseñando "armado" para siempre mientras el mapa la da por desconectada.
     * Cada dos minutos y sin GPS: no rompe el ahorro que justifica el modo.
     */
    /**
     * La nota que queda en el movil al que le quitaron la baliza.
     *
     * No es un aviso de los que se van solos: quien coge este movil dos horas
     * mas tarde se encuentra una baliza apagada y merece saber por que sin
     * tener que deducirlo. Sobrevive a cerrar la app y se va al descartarla.
     */
    // Arranca VACIA y se llena en `inicia()`, no aqui: la inicializacion del
    // objeto ocurre al cargar la clase, antes de que exista el almacen, y
    // leerlo aqui tumbaba la app entera antes de pintar nada.
    private val _notaRelevo = MutableStateFlow<String?>(null)
    val notaRelevo0: StateFlow<String?> = _notaRelevo
    private var notaRelevo: String?
        get() = _notaRelevo.value
        set(v) { _notaRelevo.value = v; almacen.guardaNotaRelevo(v) }

    fun descartaNotaRelevo() { notaRelevo = null }

    /** Cada cuánto comprueba una baliza armada que sigue siendo la buena. */
    private val COMPROBACION_ARMADA_MS = 120_000.0
    private var ultimaComprobacionArmada = 0.0
    suspend fun compruebaSigueSiendoMia() {
        val e = _estado.value
        if (!e.compartiendo || !e.enEspera) return
        val id = e.sessionId ?: return
        val t = token ?: return
        if (ahoraMs - ultimaComprobacionArmada < COMPROBACION_ARMADA_MS) return
        ultimaComprobacionArmada = ahoraMs
        val todas = runCatching { api.listSessions(t) }.getOrNull() ?: return
        val mia = todas.firstOrNull { it.id == id } ?: return
        if (!mia.isActive) {
            // Quien se la quito: la sesion viva de la cuenta, que es la que la
            // cerro. Con su nombre de aparato la nota deja de ser un misterio.
            val quien = todas.firstOrNull { it.isActive }?.device
            para()
            notaRelevo = if (quien != null) {
                "Otra baliza tomo el relevo desde «$quien» y esta dejo de emitir."
            } else {
                "Otra baliza tuya tomo el relevo y esta dejo de emitir."
            }
        }
    }

    /** Fija a mano la hora de salida prevista (el DatePicker de iOS): ritmos y
     *  previsiones van contra ella, y una hora futura deja la baliza ARMADA sin
     *  gastar GPS hasta que se acerque. */
    fun ajustaSalida(salidaMs: Double) {
        _estado.value = _estado.value.copy(salidaMs = salidaMs, salidaTocada = true)
        guardaActivo()
    }

    /**
     * Vuelve a transmitir a una sesión que YA existe y sigue activa, sin crear
     * otra. El endpoint de ping ya acepta una sesión propia y activa, así que no
     * hace falta tocar el backend: basta con recuperar de disco lo que quedó.
     */
    fun continuaSesion(id: String) {
        val resumen = _sesiones.value.firstOrNull { it.id == id }
        pendientes = almacen.leePendientes(id)
        traza = almacen.leeTraza(id)
        cargaNotasDe(id)
        cargaAnimosDe(id)
        almacen.leeForma(id)?.let { ViewerData.cargaForma(it.factor, it.log) }
        actividadDeducida = TrackingRules.deduceActividad(traza)
        ultimoIntentoMs = 0.0
        anclaPosicion = null
        _estado.value = Estado(
            compartiendo = true,
            sessionId = id,
            titulo = resumen?.title,
            perfil = _estado.value.perfil,
            ritmo = _estado.value.ritmo,
            actividad = resumen?.activity,
            // El evento sale de la sesion, no de lo que estuviera elegido: al
            // retomar una salida de ayer, el evento es el suyo.
            eventoId = resumen?.eventId,
            salidaMs = resumen?.startedAt ?: ahoraMs,
            retenerHoras = _estado.value.retenerHoras,
            pendientes = pendientes.size,
            puntosTraza = traza.size,
            metrosRecorridos = TrackingRules.distanciaTraza(traza),
            notas = _notas.value.size,
            // La posición que ven los seguidores no se sabe hasta la siguiente
            // subida: hasta entonces, simplemente no se enseña el hueco.
            ultimaLectura = traza.lastOrNull()?.let { Fix(it.lat, it.lon, fixAt = it.t) },
        )
        aplicaGps()
        ViewerData.registra(_estado.value.sessionId)
        guardaActivo()
    }

    /** Reabre una sesión terminada y sigue transmitiendo a ella: mismo enlace,
     *  para quien deja de compartir y se arrepiente. */
    suspend fun reabreSesion(id: String): Result<Unit> {
        val t = token ?: return Result.failure(ApiException(401, "unauthorized"))
        return runCatching {
            api.reopen(t, id)
            cargaSesiones()
            continuaSesion(id)
        }.onFailure { e ->
            _estado.value = _estado.value.copy(
                error = (e as? ApiException)?.message ?: "No se pudo reanudar el seguimiento.",
            )
        }
    }

    /** La chincheta: una sesión fijada se conserva indefinidamente. */
    suspend fun fijaSesion(id: String, fijada: Boolean) {
        val t = token ?: return
        api.setPinned(t, id, fijada)
        cargaSesiones()
    }

    /** Un título vacío la devuelve a "Sin nombre". */
    suspend fun renombraSesion(id: String, titulo: String?) {
        val t = token ?: return
        api.rename(t, id, titulo)
        cargaSesiones()
    }

    suspend fun borraSesion(id: String) {
        val t = token ?: return
        api.deleteSession(t, id)
        almacen.limpiaSesion(id)
        if (id == _estado.value.sessionId) {
            motor.para()
            almacen.borraActivo()
            pendientes = emptyList()
            traza = emptyList()
            _estado.value = Estado(
                perfil = _estado.value.perfil,
                ritmo = _estado.value.ritmo,
                retenerHoras = _estado.value.retenerHoras,
            )
        }
        cargaSesiones()
    }

    fun enlaceDe(id: String): String = Config.shareLink(id)

    // ── Guías offline ────────────────────────────────────────────────────────

    fun cargaGuias() {
        _guias.value = almacen.leeGuias().sortedByDescending { it.importadaMs }
    }

    /** Empaqueta una sesión terminada en un `.slsnsguide` listo para compartir.
     *  Null si no tiene traza guardada: sin ella no hay guía que hacer. */
    fun exportaGuia(context: Context, sesion: TrackSessionSummary): java.io.File? =
        GuidePackage.exporta(context, almacen, sesion, ahoraMs)

    /** Abre un `.slsnsguide` recibido y lo deja consultable sin conexión. */
    fun importaGuia(context: Context, origen: android.net.Uri): GuidePackage.Resultado {
        val resultado = GuidePackage.importa(context, almacen, origen, ahoraMs)
        if (resultado is GuidePackage.Resultado.Bien) {
            // Reimportar la misma guía la sustituye en vez de duplicarla.
            val nuevas = _guias.value.filterNot { it.id == resultado.guia.id } + resultado.guia
            almacen.guardaGuias(nuevas)
            cargaGuias()
        }
        return resultado
    }

    fun borraGuia(id: String) {
        almacen.limpiaSesion(id)
        almacen.guardaGuias(_guias.value.filterNot { it.id == id })
        cargaGuias()
    }

    /** Lo que necesita el visor para dibujar algo guardado: traza y notas. */
    fun contenidoDeGuia(id: String): Pair<List<TrailPoint>, List<Note>> =
        almacen.leeTraza(id) to almacen.leeNotas(id)

    /**
     * ¿Queda algo de esta sesión EN ESTE MÓVIL?
     *
     * Es lo que decide si una sesión sirve para algo cuando su ruta ya no está
     * en el servidor: con traza local se puede seguir viendo el mapa y
     * exportarla como guía; sin ella, lo único que se puede hacer es borrarla.
     */
    fun hayDatosLocales(id: String): Boolean = almacen.leeTraza(id).isNotEmpty()

    /**
     * El trazado de una ruta planificada, para poder bajarse su mapa antes de
     * salir. Al mejor esfuerzo: hace falta conexión, y sin ella simplemente no
     * hay ruta que preparar.
     *
     * De paso guarda el blob tal cual llegó, que es lo que luego permitirá al
     * visor incrustado dibujar la ruta prevista encima del mapa sin cobertura.
     */
    /**
     * El recorrido del EVENTO elegido (la base que publicó la organización).
     *
     * Sirve para preparar el mapa sin cobertura cuando no se ha elegido
     * previsión propia: "la del evento" es un recorrido como cualquier otro,
     * solo que vive en el evento y no en tus previsiones, así que se pide al
     * share público en vez de a `/api/plans`.
     */
    suspend fun trazadoDelEvento(): List<Pair<Double, Double>>? {
        val shareId = eventoActual()?.planShareId ?: return null
        val bytes = runCatching { api.fetchSharePayload(shareId) }.getOrNull() ?: return null
        _estado.value.sessionId?.let { almacen.guardaPlan(it, bytes) }
        return PlanGeometry.trazado(bytes)
    }

    suspend fun trazadoDelPlan(planId: String): List<Pair<Double, Double>>? {
        val t = token ?: return null
        val bytes = runCatching { api.fetchPlanPayload(t, planId) }.getOrNull() ?: return null
        _estado.value.sessionId?.let { almacen.guardaPlan(it, bytes) }
        return PlanGeometry.trazado(bytes)
    }

    /**
     * El blob del plan asociado a una sesión, tal cual llegó del backend. Lo
     * sirve el visor incrustado en `/api/share/:id` y lo descomprime él mismo,
     * exactamente igual que haría online: por eso se guarda sin tocar.
     */
    fun planDeSesion(sessionId: String): ByteArray? = almacen.leePlan(sessionId)

    /** Persiste el factor de forma confirmado y avisa al backend para que lo
     *  vean también quienes siguen la ruta. Lo local manda: si no hay cobertura,
     *  el visor incrustado ya lo refleja. */
    fun guardaForma(sessionId: String, factor: Double, historial: List<ViewerData.FormaWire>) {
        almacen.guardaForma(sessionId, LocalStore.FormaGuardada(factor, historial))
        val t = token ?: return
        val km = historial.lastOrNull()?.km
        scope.launch { runCatching { api.setForm(t, sessionId, factor, km) } }
    }

    fun hayPlanDe(sessionId: String): Boolean = almacen.leePlan(sessionId) != null

    /**
     * Dónde cae cada nota sobre la ruta prevista: kilómetro y desnivel
     * acumulado. Es lo que convierte "una fuente en algún sitio" en "la fuente
     * del km 23,4, tras 1.200 m de subida".
     */
    fun metricasDeNotas(sessionId: String, notas: List<Note>): Map<String, PlanGeometry.MetricasNota> {
        val puntos = almacen.leePlan(sessionId)?.let { PlanGeometry.puntosConAltitud(it) }
        return PlanGeometry.metricasDeNotas(puntos, notas)
    }

    /**
     * Se baja el plan de la sesión y lo deja en disco, para que el visor pueda
     * dibujar la ruta prevista sin cobertura. Al mejor esfuerzo y sin bloquear:
     * si no hay conexión al empezar, simplemente no habrá overlay hasta que se
     * vuelva a pedir.
     */
    private fun cachePlan(sessionId: String, planId: String?) {
        scope.launch {
            val bytes = when {
                // La previsión propia manda; si no hay, la del evento, que es un
                // recorrido como cualquier otro solo que vive en la carrera.
                planId != null -> token?.let { t -> runCatching { api.fetchPlanPayload(t, planId) }.getOrNull() }
                else -> eventoActual()?.planShareId?.let { runCatching { api.fetchSharePayload(it) }.getOrNull() }
            }
            if (bytes != null) {
                almacen.guardaPlan(sessionId, bytes)
                cargaGeometriaRuta(bytes)
            }
        }
    }

    /**
     * Deja el recorrido listo en memoria para proyectar posiciones.
     *
     * Se hace una vez por sesión: descomprimir y acumular kilómetros de un
     * trazado de miles de puntos en cada lectura del GPS sería tirar batería
     * justo en lo que más la cuida.
     */
    private fun cargaGeometriaRuta(gz: ByteArray) {
        val puntos = PlanGeometry.puntosConAltitud(gz)
        if (puntos.isNullOrEmpty()) return
        rutaPuntos = puntos
        rutaKmAcum = PlanGeometry.kmAcumulado(puntos)
        ultimoKmRuta = null
    }

    /** Al reanudar una sesión viva, el recorrido ya está en disco. */
    private fun cargaGeometriaGuardada(sessionId: String) {
        val gz = almacen.leePlan(sessionId) ?: return
        cargaGeometriaRuta(gz)
    }

    /** Deja pasar al backend una petición del visor incrustado (dar un "me
     *  gusta" a un ánimo, o retirarlo). */
    fun pasarela(rutaConConsulta: String, metodo: String): Pair<ByteArray, String>? =
        api.pasarelaBloqueante(rutaConConsulta, metodo, token)

    /**
     * Los ánimos que han dejado quienes siguen la ruta.
     *
     * Es lo único del visor incrustado que NO se puede fabricar en local: los
     * escriben otros y viven en el servidor. Se traen del endpoint público —el
     * mismo que ven los seguidores, para que la baliza vea exactamente lo
     * mismo— y se guardan en disco, porque un ánimo que ya llegó tiene que
     * poder releerse sin cobertura, que es justo cuando más apetece.
     */
    fun animos(): JsonElement? = animosEnMemoria

    private var animosEnMemoria: JsonElement? = null
    private var ultimaConsultaAnimosMs = 0.0

    /**
     * Cada cuánto se preguntan.
     *
     * Es lo que de verdad se nota: el backend solo los retiene 10 s
     * (`CHEER_GRACE_MS`, la ventana que tiene su autor para arrepentirse), así
     * que el resto de la espera sale de aquí. A 30 s, un ánimo aparece en menos
     * de medio minuto, que es lo que espera quien acaba de escribirlo. Bajarlo
     * mucho más solo gastaría batería y datos en el monte por un mensaje que no
     * urge tanto.
     */
    private const val ANIMOS_CADA_MS = 30_000

    private suspend fun refrescaAnimos() {
        val id = _estado.value.sessionId ?: return
        if (ahoraMs - ultimaConsultaAnimosMs < ANIMOS_CADA_MS) return
        ultimaConsultaAnimosMs = ahoraMs

        val publico = api.estadoPublico(id)
        val lista = publico?.get("cheers")
        if (lista == null || lista is JsonNull) return

        animosEnMemoria = lista
        runCatching { almacen.guardaAnimos(id, lista.toString().toByteArray()) }
        avisaDeLosNuevos(lista)
    }

    /**
     * Avisa de los ánimos que no se habían visto todavía.
     *
     * Quien camina lleva el móvil en el bolsillo: un mensaje que solo aparece al
     * abrir el mapa no lo va a ver nadie, y el sentido de un ánimo es llegar
     * cuando llega. Por eso se notifica, como hace la web.
     *
     * El corte es la hora del ánimo más reciente que ya se conocía; así al
     * abrir la app por primera vez en una ruta con veinte mensajes no salta una
     * ráfaga de veinte avisos.
     */
    private fun avisaDeLosNuevos(lista: JsonElement) {
        val animos = runCatching { lista.jsonArray }.getOrNull() ?: return
        val nuevos = animos.mapNotNull { it as? JsonObject }.filter { animo ->
            val creado = animo["createdAt"]?.jsonPrimitive?.doubleOrNull ?: 0.0
            val propio = animo["mine"]?.jsonPrimitive?.booleanOrNull ?: false
            creado > ultimoAnimoVistoMs && !propio
        }
        // La primera vuelta solo fija el corte: los que ya estaban no son nuevos.
        val eraLaPrimera = ultimoAnimoVistoMs == 0.0
        animos.mapNotNull { it as? JsonObject }
            .mapNotNull { it["createdAt"]?.jsonPrimitive?.doubleOrNull }
            .maxOrNull()
            ?.let { if (it > ultimoAnimoVistoMs) ultimoAnimoVistoMs = it }
        if (eraLaPrimera || nuevos.isEmpty()) return

        val ultimo = nuevos.maxByOrNull {
            it["createdAt"]?.jsonPrimitive?.doubleOrNull ?: 0.0
        } ?: return
        avisadorDeAnimos?.invoke(
            ultimo["nick"]?.jsonPrimitive?.contentOrNull,
            ultimo["body"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            nuevos.size,
        )
    }

    private var ultimoAnimoVistoMs = 0.0

    /** Enseña un aviso de ánimo nuevo. Lo pone el servicio, que es quien puede
     *  notificar; aquí solo se sabe cuándo hace falta. */
    var avisadorDeAnimos: ((nick: String?, texto: String, cuantos: Int) -> Unit)? = null

    /** Recupera del disco los ánimos de una sesión que se retoma. */
    private fun cargaAnimosDe(id: String) {
        animosEnMemoria = almacen.leeAnimos(id)
            ?.let { runCatching { Api.json.parseToJsonElement(it.toString(Charsets.UTF_8)) }.getOrNull() }
        ultimaConsultaAnimosMs = 0.0
    }

    /** La traza retenida de la sesión actual, para el visor incrustado. */
    fun trazaActual(): List<TrailPoint> = traza

    /** El almacén local, para que el visor pueda servir los medios de las notas
     *  sin cobertura (la foto ya está en el móvil: no hay que ir a buscarla). */
    fun medioDeNota(sessionId: String, noteId: String, kind: String): ByteArray? =
        almacen.leeMedio(sessionId, almacen.nombreMedio(noteId, kind))

    /** La ruta del fichero de un medio. Para reproducir el audio hace falta el
     *  fichero, no los bytes: cargar en memoria un audio largo sería absurdo
     *  cuando el reproductor sabe leerlo del disco. */
    fun ficheroDeMedio(sessionId: String, noteId: String, kind: String): java.io.File? {
        val f = almacen.ficheroMedio(sessionId, almacen.nombreMedio(noteId, kind))
        return if (f.exists()) f else null
    }

    // ── Ajustes en caliente ──────────────────────────────────────────────────

    fun eligePerfil(perfil: TrackingRules.Perfil) {
        val ritmo = TrackingRules.ritmoDe(perfil, _estado.value.ritmo)
        _estado.value = _estado.value.copy(perfil = perfil, ritmo = ritmo)
        aplicaGps()
        guardaActivo()
    }

    fun ajustaRitmo(ritmo: TrackingRules.Ritmo) {
        _estado.value = _estado.value.copy(
            ritmo = ritmo,
            perfil = TrackingRules.Perfil.PERSONALIZADO,
        )
        aplicaGps()
        guardaActivo()
    }

    fun ajustaActividad(actividad: BeaconActivity?) {
        _estado.value = _estado.value.copy(actividad = actividad)
        guardaActivo()
        val id = _estado.value.sessionId ?: return
        val t = token ?: return
        scope.launch { api.setActivity(t, id, actividad) }
    }

    fun ajustaRetencion(horas: Double) {
        _estado.value = _estado.value.copy(retenerHoras = horas)
        guardaActivo()
    }

    private fun aplicaGps() {
        val e = _estado.value
        if (!e.compartiendo) { motor.para(); return }
        motor.aplica(
            if (e.enEspera) {
                TrackingRules.ajusteEspera()
            } else {
                // La actividad decide cada cuánto se pide el GPS en modo
                // distancia: a 60 km/h, 15 s son 250 m y no 100.
                TrackingRules.ajusteGps(e.ritmo, e.actividadEfectiva)
            },
        )
        // Con qué se está emitiendo de verdad. El motor cae a la red cuando el
        // GPS esta apagado, y eso hay que enseñarlo: media posicion es mejor que
        // ninguna, pero solo si quien emite sabe que va con media.
        _estado.value = _estado.value.copy(
            porRed = !e.enEspera &&
                motor.proveedorEnUso == android.location.LocationManager.NETWORK_PROVIDER,
            sinPrecision = !motor.hayPermisoPreciso(),
        )
    }

    // ── Lecturas ─────────────────────────────────────────────────────────────

    private fun alLlegarLectura(loc: Location) {
        val e = _estado.value
        if (!e.compartiendo || e.sessionId == null) return

        // Armada en espera: no se registra nada, la lectura solo sirve de excusa
        // para mirar si ya toca empezar... y para preguntar por los ánimos, que
        // es lo único que puede llegar mientras se espera la hora de salida.
        if (e.enEspera) {
            quizaEmpieza()
            scope.launch { refrescaAnimos() }
            return
        }

        if (!TrackingRules.tocaRegistrar(ahoraMs, ultimoIntentoMs, e.ritmo)) return

        val precision = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null
        if (!TrackingRules.precisionAceptable(precision, traza.isNotEmpty())) return

        val fix = TrackingRules.fixDeLectura(
            lat = loc.latitude,
            lon = loc.longitude,
            tiempoMs = if (loc.time > 0) loc.time.toDouble() else ahoraMs,
            velocidad = if (loc.hasSpeed()) loc.speed.toDouble() else null,
            rumbo = if (loc.hasBearing()) loc.bearing.toDouble() else null,
            precision = precision,
            altitud = if (loc.hasAltitude()) loc.altitude else null,
        )
        if (TrackingRules.esRepetida(e.ultimaLectura, fix)) return
        if (TrackingRules.saltoImposible(
                e.ultimaLectura,
                fix,
                e.actividadEfectiva,
                declarada = e.actividad != null,
            )
        ) {
            return
        }

        // Posición mantenida: si el desplazamiento no supera la incertidumbre,
        // no es que te hayas movido, es el GPS paseándose. Se registra la
        // posición del ancla con la hora nueva —"sigo aquí, y sigo vivo"— en vez
        // de dibujarle a quien te sigue un paseo que no has dado.
        val aRegistrar = if (TrackingRules.hayMovimiento(anclaPosicion, fix)) {
            anclaPosicion = fix
            fix
        } else {
            _estado.value = _estado.value.copy(retenidas = _estado.value.retenidas + 1)
            TrackingRules.mantenPosicion(anclaPosicion!!, fix)
        }

        registra(conKilometro(aRegistrar))
        // Los ánimos se piden aquí y no solo en el tic periódico: el tic va con
        // un `Handler`, que se para cuando la CPU se suspende con la pantalla
        // apagada. La entrega de una posición SÍ despierta el móvil, así que
        // este es el momento fiable para preguntar.
        scope.launch { vacia(); refrescaAnimos() }
    }

    /**
     * La misma posición, con el kilómetro del recorrido puesto — y con la meta
     * detectada si toca.
     *
     * La proyección va con ventana móvil (ver `PlanGeometry.proyectaKm`): busca
     * cerca del último kilómetro conocido, así que no puede saltar al otro
     * extremo del trazado porque la ruta se cruce consigo misma. Si la posición
     * queda lejos del recorrido no se inventa nada: `trackKm` se queda a null,
     * que es lo que significa "voy por otro sitio".
     */
    private fun conKilometro(fix: Fix): Fix {
        val puntos = rutaPuntos ?: return fix
        val kms = rutaKmAcum ?: return fix
        val km = PlanGeometry.proyectaKm(puntos, kms, fix.lat, fix.lon, ultimoKmRuta) ?: return fix
        ultimoKmRuta = km

        // Meta: el final del recorrido, con margen. El GPS no clava el último
        // metro y el arco de meta nunca cae en el punto exacto del GPX, así que
        // exigir el 100% seria no detectarla nunca.
        val total = kms.lastOrNull() ?: 0.0
        if (total > 0.5 && km >= total * 0.99 && !_estado.value.enMeta) {
            _estado.value = _estado.value.copy(enMeta = true)
            guardaActivo()
        }
        return fix.copy(trackKm = km)
    }

    /** Registra en local (y persiste) antes de intentar subir nada. */
    private fun registra(fix: Fix) {
        ultimoIntentoMs = ahoraMs
        val id = _estado.value.sessionId ?: return
        // Escribir en disco y subir vienen justo detrás: que el móvil no se
        // duerma en medio. Con plazo, para que un fallo no deje la CPU
        // encendida el resto de la travesía.
        despertador?.invoke(TrackingRules.DESPIERTO_MS)

        pendientes = TrackingRules.encolaPendiente(pendientes, fix)
        almacen.guardaPendientes(id, pendientes)

        traza = TrackingRules.recortaTraza(traza + TrackingRules.migaDe(fix, ahoraMs))
        almacen.guardaTraza(id, traza)
        actividadDeducida = TrackingRules.deduceActividad(traza)

        muestreaBateria()
        _estado.value = _estado.value.copy(
            pendientes = pendientes.size,
            ultimaLectura = fix,
            puntosTraza = traza.size,
            metrosRecorridos = TrackingRules.distanciaTraza(traza),
            notas = _notas.value.size,
        )
    }

    /**
     * Toma una muestra de batería si toca. Se engancha al registro de posiciones
     * en vez de a un temporizador propio: es el único momento en el que sabemos
     * seguro que la CPU está despierta, y además hace que las muestras sigan el
     * ritmo real del seguimiento.
     *
     * El nivel cambia despacio, así que muestrear cada 2 minutos sobra.
     */
    private fun muestreaBateria() {
        val leer = lectorBateria ?: return
        if (ahoraMs - ultimaMuestraMs < 2 * 60_000) return
        ultimaMuestraMs = ahoraMs
        val (nivel, cargando) = leer()

        if (cargando || nivel < 0) {
            // Enchufado la medida no significa nada: se tira la ventana para que
            // al desenchufar se empiece a medir limpio.
            muestrasBateria = emptyList()
            _estado.value = _estado.value.copy(
                nivelBateria = nivel,
                cargando = cargando,
                gastoBateriaPorHora = null,
                horasRestantes = null,
            )
            return
        }

        muestrasBateria = TrackingRules.podaMuestras(
            muestrasBateria + TrackingRules.MuestraBateria(ahoraMs, nivel),
            ahoraMs,
        )
        val autonomia = TrackingRules.calculaAutonomia(
            muestras = muestrasBateria,
            nivelActual = nivel,
            cargando = false,
            gastoAnterior = _estado.value.gastoBateriaPorHora,
        )
        _estado.value = _estado.value.copy(
            nivelBateria = nivel,
            cargando = false,
            gastoBateriaPorHora = autonomia.gastoPorHora,
            horasRestantes = autonomia.horasRestantes,
        )
    }

    /** Sale del modo espera cuando llega la hora: aplica el perfil de verdad y
     *  manda una primera posición sin esperar al siguiente intervalo. */
    private fun quizaEmpieza() {
        val e = _estado.value
        if (!e.enEspera || !TrackingRules.tocaEmpezar(ahoraMs, e.salidaMs)) return
        _estado.value = e.copy(enEspera = false)
        ultimoIntentoMs = 0.0
        anclaPosicion = null
        aplicaGps()
        guardaActivo()
        motor.pideUnaLectura()
    }

    // ── Notas de campo ───────────────────────────────────────────────────────

    /**
     * Ancla una nota a la posición actual y la encola. Como con las posiciones:
     * primero se guarda en local, y la subida es un paso aparte que se
     * reintenta, para que una nota tomada sin cobertura no se pierda.
     *
     * El texto puede ir vacío cuando la nota es solo un tipo (p. ej. "Agua"):
     * marcar una fuente al pasar tiene que costar un toque, no una redacción.
     */
    fun anadeNota(
        texto: String,
        tipo: String = PoiTypes.DEFAULT_SLUG,
        foto: ByteArray? = null,
        audio: ByteArray? = null,
    ): Boolean {
        val e = _estado.value
        val id = e.sessionId ?: return false
        val ancla = TrackingRules.anclaje(e.ultimaLectura, traza.lastOrNull()?.let {
            Fix(it.lat, it.lon, accuracy = it.a?.toDouble(), fixAt = it.t)
        }) ?: run {
            _estado.value = e.copy(error = "Aún no hay posición GPS para anclar la nota.")
            return false
        }

        val noteId = TrackingRules.generaId()
        // Los medios se escriben en disco ANTES de encolar nada: si la foto no
        // cabe, se pierde la foto pero nunca la nota.
        val clavefoto = foto?.let { almacen.guardaMedio(id, noteId, "photo", it) }
        val claveAudio = audio?.let { almacen.guardaMedio(id, noteId, "audio", it) }

        val nota = Note(
            id = noteId,
            createdAt = ahoraMs,
            fixAt = ancla.fixAt,
            lat = ancla.lat,
            lon = ancla.lon,
            accuracy = ancla.accuracy,
            altitude = ancla.altitude,
            distM = TrackingRules.distanciaTraza(traza),
            body = texto.ifBlank { null },
            poiType = tipo,
            audioKey = claveAudio,
            photoKey = clavefoto,
        )

        _notas.value = listOf(nota) + _notas.value
        notasPendientes = notasPendientes + nota
        claveAudio?.let {
            mediosPendientes = mediosPendientes + LocalStore.MedioPendiente(noteId, "audio", it)
        }
        clavefoto?.let {
            mediosPendientes = mediosPendientes + LocalStore.MedioPendiente(noteId, "photo", it)
        }

        almacen.guardaNotas(id, _notas.value)
        almacen.guardaNotasPendientes(id, notasPendientes)
        almacen.guardaMediosPendientes(id, mediosPendientes)
        _estado.value = _estado.value.copy(notas = _notas.value.size, error = null)
        scope.launch { vaciaNotas(); vaciaMedios() }
        return true
    }

    /**
     * Borra la nota del móvil ya y encola la baja en el servidor. La lápida es
     * lo que impide que una creación aún en vuelo la resucite cuando vuelva la
     * cobertura.
     */
    fun borraNota(nota: Note) {
        val id = _estado.value.sessionId ?: return
        _notas.value = _notas.value.filterNot { it.id == nota.id }
        notasPendientes = notasPendientes.filterNot { it.id == nota.id }
        mediosPendientes = mediosPendientes.filterNot { it.noteId == nota.id }
        if (nota.id !in borradosPendientes) borradosPendientes = borradosPendientes + nota.id
        almacen.borraMediosDe(id, nota.id)

        almacen.guardaNotas(id, _notas.value)
        almacen.guardaNotasPendientes(id, notasPendientes)
        almacen.guardaMediosPendientes(id, mediosPendientes)
        almacen.guardaBorradosPendientes(id, borradosPendientes)
        _estado.value = _estado.value.copy(notas = _notas.value.size)
        scope.launch { vaciaBorradosDeNotas() }
    }

    /** Sube las notas encoladas de una en una: cada una que entra se quita de la
     *  cola, y al primer fallo se para y se deja el resto para el siguiente
     *  intento (sin cobertura, insistir con las 20 solo gasta batería). */
    private suspend fun vaciaNotas() {
        val e = _estado.value
        val id = e.sessionId ?: return
        val t = token ?: return
        if (!e.compartiendo || vaciandoNotas || notasPendientes.isEmpty()) return
        vaciandoNotas = true
        try {
            for (nota in notasPendientes.toList()) {
                try {
                    api.createNote(t, id, nota)
                    notasPendientes = notasPendientes.filterNot { it.id == nota.id }
                    almacen.guardaNotasPendientes(id, notasPendientes)
                } catch (ex: ApiException) {
                    if (ex.status == 410) { para(); return }
                    break
                }
            }
        } finally {
            vaciandoNotas = false
        }
    }

    /**
     * Sube los medios pendientes.
     *
     * Con una condición que no es obvia: **solo los de notas que YA existen en
     * el servidor**. El endpoint del medio cuelga de la fila de la nota, así que
     * mandar la foto de una nota que sigue en la cola de creación daría 404 y se
     * perdería. Por eso se saltan las que aún están en [notasPendientes] y se
     * intentan en la vuelta siguiente, cuando su nota ya haya entrado.
     */
    private suspend fun vaciaMedios() {
        val e = _estado.value
        val id = e.sessionId ?: return
        val t = token ?: return
        if (!e.compartiendo || vaciandoMedios || mediosPendientes.isEmpty()) return
        vaciandoMedios = true
        try {
            val sinCrear = notasPendientes.map { it.id }.toSet()
            for (medio in mediosPendientes.toList()) {
                if (medio.noteId in sinCrear) continue

                val datos = almacen.leeMedio(id, medio.file)
                if (datos == null) {
                    // El fichero ya no está: se descuelga de la cola, porque
                    // reintentarlo eternamente no lo va a resucitar.
                    mediosPendientes = mediosPendientes.filterNot { it.file == medio.file }
                    almacen.guardaMediosPendientes(id, mediosPendientes)
                    continue
                }

                val tipoMime = if (medio.kind == "audio") "audio/mp4" else "image/jpeg"
                try {
                    api.uploadNoteMedia(t, id, medio.noteId, medio.kind, datos, tipoMime)
                    mediosPendientes = mediosPendientes.filterNot { it.file == medio.file }
                    almacen.guardaMediosPendientes(id, mediosPendientes)
                } catch (ex: ApiException) {
                    if (ex.status == 410) { para(); return }
                    // Sin cobertura no tiene sentido intentar los demás: una foto
                    // son cientos de kilobytes y el reintento sale caro.
                    break
                }
            }
        } finally {
            vaciandoMedios = false
        }
    }

    private suspend fun vaciaBorradosDeNotas() {
        val e = _estado.value
        val id = e.sessionId ?: return
        val t = token ?: return
        if (!e.compartiendo || borradosPendientes.isEmpty()) return
        for (noteId in borradosPendientes.toList()) {
            try {
                api.deleteNote(t, id, noteId)
            } catch (ex: ApiException) {
                // Un 404 significa que allí ya no está: la lápida ha cumplido y
                // se retira. Cualquier otro fallo es transitorio y se reintenta.
                if (ex.status != 404) break
            }
            borradosPendientes = borradosPendientes.filterNot { it == noteId }
            almacen.guardaBorradosPendientes(id, borradosPendientes)
        }
    }

    /** Recupera de disco las notas de una sesión que se retoma. */
    private fun cargaNotasDe(id: String) {
        _notas.value = almacen.leeNotas(id).sortedByDescending { it.createdAt }
        notasPendientes = almacen.leeNotasPendientes(id)
        borradosPendientes = almacen.leeBorradosPendientes(id)
        mediosPendientes = almacen.leeMediosPendientes(id)
    }

    // ── Subida ───────────────────────────────────────────────────────────────

    /**
     * Sube el atasco entero de una vez. Si falla (sin cobertura) el atasco se
     * CONSERVA y se reintenta; si va bien solo se quita el lote enviado, porque
     * mientras la subida volaba pueden haber entrado posiciones nuevas.
     */
    private suspend fun vacia() {
        val e = _estado.value
        val id = e.sessionId ?: return
        val t = token ?: return
        if (!e.compartiendo || vaciando || pendientes.isEmpty()) return
        vaciando = true
        try {
            val lote = pendientes
            val seguidores = api.pingBatch(t, id, lote)
            pendientes = TrackingRules.quitaEnviados(pendientes, lote.size)
            almacen.guardaPendientes(id, pendientes)
            _estado.value = _estado.value.copy(
                pendientes = pendientes.size,
                subidas = _estado.value.subidas + lote.size,
                ultimoEnvioMs = ahoraMs,
                seguidores = seguidores,
                error = null,
                ultimaReportada = lote.last(),
            )
        } catch (ex: ApiException) {
            if (ex.status == 410) {
                // La sesión ha terminado o caducado en el servidor: seguir
                // insistiendo solo gastaría batería.
                para()
            } else {
                _estado.value = _estado.value.copy(
                    error = TrackingRules.avisoSinCobertura(pendientes.size),
                )
            }
        } finally {
            vaciando = false
        }
    }

    /**
     * El tic periódico del servicio (cada [TrackingRules.TICK_SEGUNDOS]): el
     * latido de modo distancia, la salida del modo espera cuando se está quieto
     * en la línea de salida, y el reintento del atasco cuando vuelve la
     * cobertura sin haberse movido.
     */
    fun tic() {
        val e = _estado.value
        if (!e.compartiendo) return
        if (e.enEspera) {
            quizaEmpieza()
            // Armada y esperando la hora de salida NO significa incomunicada:
            // el enlace ya está compartido y la gente empieza a mandar ánimos
            // antes de que salgas. Antes se volvía aquí sin preguntar por ellos.
            // Y de paso se comprueba que la sesión sigue siendo la buena: otro
            // móvil de la misma cuenta pudo tomar el relevo mientras esta
            // callaba.
            scope.launch { refrescaAnimos() }
            scope.launch { compruebaSigueSiendoMia() }
            return
        }
        if (TrackingRules.tocaLatido(ahoraMs, ultimoIntentoMs, e.ritmo)) {
            ultimoIntentoMs = ahoraMs   // optimista: que no se repita cada tic
            motor.pideUnaLectura()
        }
        scope.launch {
            vacia()
            vaciaNotas()
            vaciaBorradosDeNotas()
            vaciaMedios()
            refrescaAnimos()
        }
    }

    private fun guardaActivo() {
        val e = _estado.value
        val id = e.sessionId ?: return
        almacen.guardaActivo(
            LocalStore.EstadoActivo(
                sessionId = id,
                enEspera = e.enEspera,
                modo = e.ritmo.modo.name,
                intervaloSegundos = e.ritmo.intervaloSegundos,
                distanciaMetros = e.ritmo.distanciaMetros,
                perfil = e.perfil.name,
                salidaMs = e.salidaMs,
                retenerHoras = e.retenerHoras,
                actividad = e.actividad?.wire,
                titulo = e.titulo,
                eventoId = e.eventoId,
                guardadoMs = ahoraMs,
            ),
        )
    }

    /** ¿Hay una sesión guardada que reanudar? Lo mira el servicio al arrancar
     *  sin que nadie haya abierto la app. */
    fun haySesionGuardada(): Boolean = almacen.leeActivo() != null
}
