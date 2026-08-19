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
        val salidaMs: Double = 0.0,
        val retenerHoras: Double = 48.0,
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
        /** Nivel de batería 0…1, negativo si no se sabe. */
        val nivelBateria: Double = -1.0,
        val cargando: Boolean = false,
        /** Gasto MEDIDO (% por hora) y autonomía estimada a ese ritmo. Nulos
         *  hasta que ha pasado el tiempo suficiente para que signifiquen algo. */
        val gastoBateriaPorHora: Double? = null,
        val horasRestantes: Double? = null,
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

    /** Las notas de campo de la sesión actual, de la más nueva a la más vieja. */
    private val _notas = MutableStateFlow<List<Note>>(emptyList())
    val notas: StateFlow<List<Note>> = _notas.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var almacen: LocalStore
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
        almacen = LocalStore(app)
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
    suspend fun empieza(
        titulo: String?,
        planId: String? = _estado.value.planId,
        salidaMs: Double = _estado.value.salidaMs.takeIf { it > 0 } ?: ahoraMs,
        actividad: BeaconActivity? = _estado.value.actividad,
    ): Result<String> {
        val t = token ?: return Result.failure(ApiException(401, "unauthorized"))
        return runCatching {
            val res = api.createTrack(t, titulo, planId, salidaMs, actividad)
            pendientes = emptyList()
            traza = emptyList()
            notasPendientes = emptyList()
            borradosPendientes = emptyList()
            mediosPendientes = emptyList()
            _notas.value = emptyList()
            actividadDeducida = null
            ultimoIntentoMs = 0.0
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
        cargaNotasDe(guardado.sessionId)
        actividadDeducida = TrackingRules.deduceActividad(traza)
        ultimoIntentoMs = 0.0
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
            almacen.limpiaSesion(id)
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
            .onSuccess { _sesiones.value = TrackingRules.ordenaSesiones(it) }
    }

    suspend fun cargaPlanes() {
        val t = token ?: return
        runCatching { api.listPlans(t) }.onSuccess { _planes.value = it }
    }

    /**
     * Asocia una ruta planificada. La salida por defecto pasa a ser la DEL PLAN
     * y no el momento de activar, para que los ritmos y las predicciones que ve
     * quien sigue la ruta vayan contra lo planificado.
     */
    fun eligePlan(planId: String?) {
        val plan = _planes.value.firstOrNull { it.id == planId }
        val salida = TrackingRules.parseaIso(plan?.startTime) ?: ahoraMs
        _estado.value = _estado.value.copy(planId = planId, salidaMs = salida)
    }

    fun ajustaSalida(salidaMs: Double) {
        _estado.value = _estado.value.copy(salidaMs = salidaMs)
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
        actividadDeducida = TrackingRules.deduceActividad(traza)
        ultimoIntentoMs = 0.0
        _estado.value = Estado(
            compartiendo = true,
            sessionId = id,
            titulo = resumen?.title,
            perfil = _estado.value.perfil,
            ritmo = _estado.value.ritmo,
            actividad = resumen?.activity,
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

    /**
     * El trazado de una ruta planificada, para poder bajarse su mapa antes de
     * salir. Al mejor esfuerzo: hace falta conexión, y sin ella simplemente no
     * hay ruta que preparar.
     *
     * De paso guarda el blob tal cual llegó, que es lo que luego permitirá al
     * visor incrustado dibujar la ruta prevista encima del mapa sin cobertura.
     */
    suspend fun trazadoDelPlan(planId: String): List<Pair<Double, Double>>? {
        val t = token ?: return null
        val bytes = runCatching { api.fetchPlanPayload(t, planId) }.getOrNull() ?: return null
        _estado.value.sessionId?.let { almacen.guardaPlan(it, bytes) }
        return PlanGeometry.trazado(bytes)
    }

    /** La traza retenida de la sesión actual, para el visor incrustado. */
    fun trazaActual(): List<TrailPoint> = traza

    /** El almacén local, para que el visor pueda servir los medios de las notas
     *  sin cobertura (la foto ya está en el móvil: no hay que ir a buscarla). */
    fun medioDeNota(sessionId: String, noteId: String, kind: String): ByteArray? =
        almacen.leeMedio(sessionId, almacen.nombreMedio(noteId, kind))

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
            if (e.enEspera) TrackingRules.ajusteEspera() else TrackingRules.ajusteGps(e.ritmo),
        )
    }

    // ── Lecturas ─────────────────────────────────────────────────────────────

    private fun alLlegarLectura(loc: Location) {
        val e = _estado.value
        if (!e.compartiendo || e.sessionId == null) return

        // Armada en espera: no se registra nada, la lectura solo sirve de excusa
        // para mirar si ya toca empezar.
        if (e.enEspera) { quizaEmpieza(); return }

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
        if (TrackingRules.saltoImposible(e.ultimaLectura, fix, e.actividadEfectiva)) return

        registra(fix)
        scope.launch { vacia() }
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
        if (e.enEspera) { quizaEmpieza(); return }
        if (TrackingRules.tocaLatido(ahoraMs, ultimoIntentoMs, e.ritmo)) {
            ultimoIntentoMs = ahoraMs   // optimista: que no se repita cada tic
            motor.pideUnaLectura()
        }
        scope.launch {
            vacia()
            vaciaNotas()
            vaciaBorradosDeNotas()
            vaciaMedios()
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
                guardadoMs = ahoraMs,
            ),
        )
    }

    /** ¿Hay una sesión guardada que reanudar? Lo mira el servicio al arrancar
     *  sin que nadie haya abierto la app. */
    fun haySesionGuardada(): Boolean = almacen.leeActivo() != null
}
