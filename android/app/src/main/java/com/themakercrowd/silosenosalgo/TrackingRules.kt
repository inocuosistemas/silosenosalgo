package com.themakercrowd.silosenosalgo

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Las REGLAS del seguimiento en vivo, sin nada de Android ni de red.
 *
 * Espejo de la lógica de `ios/Sources/TrackingStore.swift` y de
 * `ios/Sources/LocationManager.swift`. Vive aparte del servicio y del GPS por el
 * mismo motivo que [OtaRules]: aquí está todo lo que no se puede comprobar a
 * mano —el ritmo de envío, el recorte de la traza, el tope del atasco, la
 * deducción del tipo de movimiento— y así se prueba en la JVM en vez de a base
 * de salir a caminar con el móvil.
 *
 * La regla que gobierna el diseño es **primero se registra, luego se envía**:
 * cada posición se guarda en local antes de intentar subirla, y el envío es un
 * paso aparte que se reintenta. Sin cobertura no se pierde nada, que en una app
 * de montaña es lo único que de verdad importa.
 */
object TrackingRules {

    /** Cómo se marca el ritmo de las subidas. */
    enum class Modo { TIEMPO, DISTANCIA }

    /** Los perfiles que ve el usuario. `PERSONALIZADO` = ha tocado los mandos. */
    enum class Perfil { EQUILIBRADO, AHORRO, PRECISION, PERSONALIZADO }

    /** El ritmo efectivo: modo + el valor que corresponda al modo. */
    data class Ritmo(
        val modo: Modo = Modo.DISTANCIA,
        val intervaloSegundos: Double = 15.0,
        val distanciaMetros: Double = 100.0,
    )

    /** Tope de la traza local retenida. Espejo de PATH_MAX en
     *  `functions/api/track/[id]/ping.ts`: la traza de aquí tiene que quedar
     *  igual que la que ven los seguidores, no más fina. */
    const val TRAZA_MAX = 2000

    /** Tope del atasco pendiente de subir. A 100 m por punto son ~1000 km sin
     *  cobertura: de sobra para cualquier travesía real, y evita que un fallo
     *  prolongado se coma la memoria. */
    const val PENDIENTES_MAX = 10_000

    /** En modo distancia, parado no llegan posiciones nuevas: sin esto el visor
     *  mostraría "señal perdida" a quien simplemente ha hecho una parada larga.
     *  Cada 150 s se fuerza una lectura aunque no se haya movido. */
    const val LATIDO_SEGUNDOS = 150.0

    /** Cuánto antes de la salida prevista se pasa de espera a seguimiento real.
     *  El margen absorbe el desfase de reloj entre el móvil y la organización. */
    const val ANTELACION_SALIDA_SEGUNDOS = 120.0

    /** Cada cuánto despierta el bucle de reintento: vacía el atasco cuando
     *  vuelve la cobertura aunque quien camina esté parado. Es una ayuda, no el
     *  mecanismo principal — con la pantalla apagada este temporizador se para,
     *  y por eso el latido de verdad se le pide al GPS (ver [LocationEngine]). */
    const val TICK_SEGUNDOS = 20.0

    /** Cuánto se mantiene la CPU despierta tras registrar una posición: lo que
     *  tarda en escribirse en disco y en irse por la red, con margen para una
     *  cobertura mala. Con plazo para que nunca se quede encendida. */
    const val DESPIERTO_MS = 60_000L

    // ── Perfiles ─────────────────────────────────────────────────────────────

    /**
     * El ritmo de cada perfil. Los tres apuntan a lo mismo: el gasto de batería
     * lo manda el GPS, no la frecuencia de subida, así que ahorrar es pedirle
     * menos al GPS —y por distancia, parado, no pide nada.
     */
    fun ritmoDe(perfil: Perfil, actual: Ritmo = Ritmo()): Ritmo = when (perfil) {
        Perfil.EQUILIBRADO -> Ritmo(Modo.DISTANCIA, actual.intervaloSegundos, 100.0)
        Perfil.AHORRO -> Ritmo(Modo.DISTANCIA, actual.intervaloSegundos, 500.0)
        Perfil.PRECISION -> Ritmo(Modo.TIEMPO, 10.0, actual.distanciaMetros)
        Perfil.PERSONALIZADO -> actual
    }

    /** Los pasos de los mandos manuales (espejo de los sliders de iOS). */
    val PASOS_INTERVALO = listOf(5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 180.0, 300.0, 600.0)
    val PASOS_DISTANCIA = listOf(25.0, 50.0, 100.0, 250.0, 500.0)

    /** Cuánto gasta el ritmo elegido. Espejo de `batteryLabel` en iOS: los
     *  mismos cortes, para que las dos apps no digan cosas distintas del mismo
     *  ajuste. */
    enum class Gasto { ALTO, MEDIO, AHORRO }

    fun gastoPorIntervalo(segundos: Double): Gasto = when {
        segundos <= 15 -> Gasto.ALTO
        segundos <= 120 -> Gasto.MEDIO
        else -> Gasto.AHORRO
    }

    fun gastoPorDistancia(metros: Double): Gasto = when {
        metros <= 50 -> Gasto.ALTO
        metros <= 250 -> Gasto.MEDIO
        else -> Gasto.AHORRO
    }

    fun etiquetaGasto(gasto: Gasto): String = when (gasto) {
        Gasto.ALTO -> "Consumo alto"
        Gasto.MEDIO -> "Consumo medio"
        Gasto.AHORRO -> "Ahorro batería"
    }

    fun etiquetaIntervalo(segundos: Double): String = when {
        segundos < 60 -> "${segundos.toInt()} s"
        segundos < 3600 -> "${(segundos / 60).toInt()} min"
        else -> "${(segundos / 3600).toInt()} h"
    }

    fun etiquetaDistancia(metros: Double): String =
        if (metros < 1000) "${metros.toInt()} m"
        else String.format(java.util.Locale.getDefault(), "%.1f km", metros / 1000)

    // ── Configuración del GPS ────────────────────────────────────────────────

    /** Qué proveedor de posición se le pide al sistema. */
    enum class Proveedor { GPS, RED }

    /**
     * Lo que hay que pedirle al `LocationManager` de Android para un ritmo dado.
     *
     * Aquí está la diferencia grande con iOS y conviene no perderla de vista:
     * allí se ajusta la *precisión deseada* y el sistema decide; aquí se piden
     * directamente un tiempo y una distancia mínimos entre lecturas, y es ESO lo
     * que ahorra batería. Por eso el filtro de distancia se traslada al propio
     * GPS en vez de descartar lecturas ya calculadas: una posición descartada
     * ya se ha pagado.
     */
    data class AjusteGps(
        val proveedor: Proveedor,
        val tiempoMinimoMs: Long,
        val distanciaMinimaM: Float,
    )

    fun ajusteGps(ritmo: Ritmo, actividad: BeaconActivity? = null): AjusteGps = when (ritmo.modo) {
        Modo.TIEMPO -> when {
            // Máximo detalle: se deja al GPS entregar todo lo que tenga y el
            // recorte por tiempo se hace arriba, para que el primer punto tras
            // arrancar no se haga esperar un intervalo entero.
            ritmo.intervaloSegundos <= 30 ->
                AjusteGps(Proveedor.GPS, 1_000L, 0f)
            ritmo.intervaloSegundos <= 120 ->
                AjusteGps(Proveedor.GPS, (ritmo.intervaloSegundos * 1000).toLong(), 10f)
            else ->
                AjusteGps(Proveedor.GPS, (ritmo.intervaloSegundos * 1000).toLong(), 25f)
        }
        // Por distancia manda el desplazamiento... pero OJO con el tiempo
        // mínimo, que aquí no es un detalle: en Android el filtro de distancia
        // lo aplica el framework, no el aparato, así que el GPS se enciende al
        // ritmo del tiempo mínimo AUNQUE no te muevas. Ponerlo muy corto haría
        // que "Ahorro" tuviera el GPS en continuo, que es exactamente lo que ese
        // perfil promete no hacer.
        //
        // 15 s es el compromiso: andando, 100 m son unos 72 s, así que sobra; en
        // bici son ~18 s y se detecta el tramo con un retraso de una lectura.
        Modo.DISTANCIA -> AjusteGps(
            Proveedor.GPS,
            intervaloMinimoDistancia(actividad),
            ritmo.distanciaMetros.toFloat(),
        )
    }

    /**
     * Cada cuánto se le pregunta al GPS en modo distancia, según a qué velocidad
     * se va.
     *
     * El tiempo mínimo es el que MANDA de verdad sobre la resolución: por muchos
     * "cada 100 m" que se pidan, entre lectura y lectura no puede haber menos de
     * esto. Medido en una salida real: a 60 km/h y con 15 s fijos, los puntos
     * salían cada 250 m en vez de cada 100.
     *
     * Los valores son el tiempo que se tarda en recorrer 100 m a cada ritmo, con
     * margen: andando sobran 15 s (100 m son ~70 s), en bici hacen falta ~18 s,
     * y en coche 100 m se hacen en 6 s. En "Automático" se toma el punto medio,
     * porque no se sabe.
     */
    fun intervaloMinimoDistancia(actividad: BeaconActivity?): Long = when (actividad) {
        BeaconActivity.WALK, BeaconActivity.RUN -> 15_000L
        BeaconActivity.BIKE -> 10_000L
        BeaconActivity.TRANSPORT -> 5_000L
        null -> 10_000L
    }

    /**
     * Modo espera: la sesión existe y cuenta atrás, pero aún no toca transmitir.
     * Posición por red (antenas/wifi), sin GPS, muy de tarde en tarde: solo hace
     * falta para que el servicio siga vivo y note que ha llegado la hora.
     */
    fun ajusteEspera(): AjusteGps = AjusteGps(Proveedor.RED, 5 * 60_000L, 3_000f)

    // ── Ritmo de registro ────────────────────────────────────────────────────

    /**
     * ¿Toca registrar esta lectura?
     *
     * En modo distancia el propio GPS ya filtra por desplazamiento, así que todo
     * lo que llega se registra. En modo tiempo se recorta aquí: Android puede
     * entregar antes de lo pedido (otra app con el GPS abierto comparte las
     * lecturas), y sin este freno el ritmo elegido no se respetaría.
     */
    fun tocaRegistrar(ahoraMs: Double, ultimoIntentoMs: Double, ritmo: Ritmo): Boolean =
        when (ritmo.modo) {
            Modo.DISTANCIA -> true
            Modo.TIEMPO -> (ahoraMs - ultimoIntentoMs) >= ritmo.intervaloSegundos * 1000
        }

    /** ¿Toca forzar una lectura por estar demasiado tiempo quieto? Solo en modo
     *  distancia: en modo tiempo el reloj ya se encarga. */
    fun tocaLatido(ahoraMs: Double, ultimoIntentoMs: Double, ritmo: Ritmo): Boolean =
        ritmo.modo == Modo.DISTANCIA && (ahoraMs - ultimoIntentoMs) >= LATIDO_SEGUNDOS * 1000

    /** ¿Toca salir del modo espera y empezar a transmitir de verdad? */
    fun tocaEmpezar(ahoraMs: Double, salidaMs: Double): Boolean =
        ahoraMs >= salidaMs - ANTELACION_SALIDA_SEGUNDOS * 1000

    // ── Traza y atasco ───────────────────────────────────────────────────────

    /**
     * Recorta la traza a la mitad conservando SIEMPRE el punto más reciente,
     * igual que hace el servidor al recibir. Que el último se conserve no es un
     * detalle: es la posición actual, y perderla movería hacia atrás el punto
     * que se dibuja en el mapa.
     */
    fun recortaTraza(traza: List<TrailPoint>, maximo: Int = TRAZA_MAX): List<TrailPoint> {
        if (traza.size <= maximo) return traza
        var actual = traza
        while (actual.size > maximo) {
            val ultimo = actual.last()
            val alternos = actual.filterIndexed { i, _ -> i % 2 == 0 }
            actual = if (alternos.lastOrNull()?.t != ultimo.t) alternos + ultimo else alternos
        }
        return actual
    }

    /** Añade al atasco respetando el tope: si desborda se tiran los MÁS VIEJOS.
     *  Perder el principio de un tramo sin cobertura es menos malo que perder
     *  dónde está ahora quien camina. */
    fun encolaPendiente(pendientes: List<Fix>, fix: Fix, maximo: Int = PENDIENTES_MAX): List<Fix> {
        val cola = pendientes + fix
        return if (cola.size > maximo) cola.takeLast(maximo) else cola
    }

    /**
     * Quita del atasco el lote que ya se ha subido.
     *
     * Se quitan por número, no por igualdad: mientras la subida estaba en vuelo
     * pueden haberse añadido posiciones nuevas al final, y esas tienen que
     * seguir en la cola.
     */
    fun quitaEnviados(pendientes: List<Fix>, enviados: Int): List<Fix> =
        if (enviados >= pendientes.size) emptyList() else pendientes.drop(enviados)

    // ── Mis seguimientos ─────────────────────────────────────────────────────

    /** Cuánto se conserva una ruta terminada. 48 h por defecto, como en iOS. */
    val PASOS_RETENCION = listOf(6.0, 12.0, 24.0, 48.0, 72.0, 168.0)

    fun etiquetaRetencion(horas: Double): String =
        if (horas >= 168) "1 semana" else "${horas.toInt()} h"

    /**
     * Clave de orden de la lista: lo más recientemente terminado primero. Las
     * sesiones en marcha no tienen fin todavía, así que flotan arriba del todo.
     */
    fun claveOrden(s: TrackSessionSummary): Double =
        if (s.isActive) Double.MAX_VALUE else s.endedAt ?: s.updatedAt ?: s.startedAt

    /** Primero las fijadas con chincheta, luego por reciente. */
    fun ordenaSesiones(sesiones: List<TrackSessionSummary>): List<TrackSessionSummary> =
        sesiones.sortedWith(
            compareByDescending<TrackSessionSummary> { it.isPinned }
                .thenByDescending { claveOrden(it) },
        )

    /**
     * Una sesión cuya ruta ya ha borrado el servidor: sin chincheta y pasada su
     * ventana de retención. Su enlace público está muerto (el visor contesta
     * "caducado"), así que la app deja de ofrecer compartirlo y la marca como
     * caducada en vez de dejar que alguien mande un enlace roto.
     */
    fun estaCaducada(s: TrackSessionSummary, ahoraMs: Double): Boolean =
        !s.isPinned && ahoraMs > s.expiresAt

    /**
     * La hora ISO del plan a epoch ms. El backend la manda en varias formas
     * según de dónde venga el plan (con zona, en UTC con `Z`, con o sin
     * fracciones de segundo, o sin zona ninguna), así que se prueban por orden
     * en vez de dar por hecho un formato. Nulo si no hay manera: entonces se usa
     * la hora de activación, que es lo que hacía antes de elegir plan.
     */
    fun parseaIso(iso: String?): Double? {
        val texto = iso?.trim().orEmpty()
        if (texto.isEmpty()) return null
        runCatching { return java.time.Instant.parse(texto).toEpochMilli().toDouble() }
        runCatching {
            return java.time.OffsetDateTime.parse(texto).toInstant().toEpochMilli().toDouble()
        }
        runCatching {
            // Sin zona: se interpreta en la del móvil, que es la que tiene en la
            // cabeza quien escribió "salgo a las 7".
            return java.time.LocalDateTime.parse(texto)
                .atZone(java.time.ZoneId.systemDefault())
                .toInstant().toEpochMilli().toDouble()
        }
        return null
    }

    // ── Geometría ────────────────────────────────────────────────────────────

    /** Distancia entre dos puntos por haversine (metros). */
    fun distanciaMetros(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /**
     * Distancia acumulada de la traza retenida (metros), **descartando el ruido
     * del GPS**.
     *
     * Un tramo solo cuenta si es más largo que la incertidumbre de las dos
     * lecturas que lo forman. Suena conservador y no lo es: medido en el
     * aparato, once lecturas seguidas con el móvil QUIETO dentro de un edificio
     * sumaban 449 m, con saltos de hasta 118 m entre lecturas que el propio GPS
     * declaraba con ±76 y ±99 m de error. Dos posiciones así de imprecisas
     * pueden estar cien metros separadas sin que nadie se haya movido; sumarlas
     * convierte una espera en una carrera.
     *
     * El precio es quedarse corto cuando se anda despacio con mala señal —bajo
     * arbolado, en un barranco—, y se asume: un número algo bajo es un error
     * honesto, y uno inflado es una mentira que además estropea los ritmos y las
     * predicciones de llegada.
     *
     * Una lectura sin precisión declarada se trata como fiable: es lo que hacía
     * antes de existir esta regla, y no hay base para desconfiar de ella.
     */
    fun distanciaTraza(traza: List<TrailPoint>): Double {
        var total = 0.0
        for (i in 1 until traza.size) {
            val d = distanciaMetros(traza[i - 1].lat, traza[i - 1].lon, traza[i].lat, traza[i].lon)
            // El mismo umbral que decide si hubo movimiento: si un tramo no da
            // para mover la posición, tampoco puede sumar kilómetros.
            if (d >= umbralMovimiento(
                    traza[i - 1].a?.toDouble(),
                    traza[i].a?.toDouble(),
                )
            ) {
                total += d
            }
        }
        return total
    }

    /** El desplazamiento mínimo que hay que ver entre dos lecturas para creer
     *  que ha habido movimiento: la suma de sus errores declarados. */
    fun incertidumbre(precisionA: Int?, precisionB: Int?): Double =
        (precisionA ?: 0).toDouble() + (precisionB ?: 0).toDouble()

    /**
     * ¿Se ha movido de verdad respecto al ANCLA —la última posición que dimos
     * por buena—, o es el GPS paseándose?
     *
     * Se compara contra el ancla y no contra la lectura anterior a propósito: si
     * se comparase con la anterior, un avance lento y real (cada paso por debajo
     * del ruido) no se detectaría nunca. Contra el ancla, el desplazamiento se
     * va acumulando hasta que supera la incertidumbre y entonces salta de golpe,
     * que es tarde pero cierto — y se corrige solo.
     */
    fun hayMovimiento(ancla: Fix?, nueva: Fix): Boolean {
        if (ancla == null) return true
        // Con señal buena la lectura se cree tal cual. El ancla se inventó para
        // el caso de ±50 m dentro de un edificio; con 4 m de precisión hace más
        // daño que bien, porque el umbral (unos 6 m) se acerca peligrosamente a
        // lo que se anda entre dos lecturas y acabaría comiéndose pasos reales
        // en cuanto la señal empeore un poco.
        val peor = maxOf(ancla.accuracy ?: 0.0, nueva.accuracy ?: 0.0)
        if (peor <= PRECISION_FIABLE_M) return true

        val d = distanciaMetros(ancla.lat, ancla.lon, nueva.lat, nueva.lon)
        return d >= umbralMovimiento(ancla.accuracy, nueva.accuracy)
    }

    /**
     * Por debajo de esta precisión declarada, la posición se cree sin más.
     *
     * 10 m es el punto donde el ruido deja de parecerse a un paso: andando se
     * hacen unos 12 m entre lecturas de 10 s, así que por encima de eso el
     * filtro empezaría a confundir andar con no moverse.
     */
    const val PRECISION_FIABLE_M = 10.0

    /**
     * Cuánto hay que desplazarse para creer que ha habido movimiento.
     *
     * **1,5 veces el PEOR de los dos errores**, no la suma. La suma era
     * demasiado severa al salir: con el GPS aún enganchando (±50 m) exigía 100 m
     * antes de dar el primer punto, y el arranque de una ruta salía vacío.
     * Tomando el peor error se responde antes cuando una de las dos lecturas es
     * buena, y el factor 1,5 mantiene fuera el ruido medido con señal mala
     * (saltos de hasta 118 m con lecturas de ±99: 1,5 × 99 = 148, sigue fuera).
     *
     * Es un equilibrio, no una verdad: con señal mediocre y constante puede
     * colarse algún salto que antes no se colaba. Si vuelve a verse ruido, el
     * factor es el mando que hay que subir.
     */
    fun umbralMovimiento(precisionA: Double?, precisionB: Double?): Double {
        val peor = maxOf(precisionA ?: 0.0, precisionB ?: 0.0)
        return peor * 1.5
    }

    /**
     * La posición que se registra cuando NO hay movimiento: la del ancla, pero
     * con la hora y la precisión de la lectura nueva.
     *
     * Es lo que evita que a quien te sigue le baile la marca por el mapa estando
     * tú sentado. Medido en el aparato: quieto, la posición se paseaba en un
     * radio de 40 m mientras el GPS declaraba ±50 m de error. Conservar la
     * posición y refrescar solo la hora dice justo lo que pasa —"sigo aquí, y
     * sigo vivo"— sin inventarse un paseo.
     */
    fun mantenPosicion(ancla: Fix, nueva: Fix): Fix = ancla.copy(
        fixAt = nueva.fixAt,
        accuracy = nueva.accuracy,
        // La velocidad y el rumbo de una lectura que no supera el ruido no
        // significan nada: se omiten en vez de propagar un dato falso.
        speed = null,
        heading = null,
        altitude = nueva.altitude,
    )

    // ── Tipo de movimiento ───────────────────────────────────────────────────

    /**
     * Deduce el tipo de movimiento de la traza, espejo de
     * `src/lib/activityInference.ts` y de `inferActivity` en iOS: percentil 85 de
     * las velocidades de los tramos en movimiento.
     *
     * Se usa el p85 y no la media porque una travesía real está llena de paradas
     * que hundirían la media hasta hacer pasar una salida en bici por una
     * caminata. Los tramos parados (<1,5 km/h) y los saltos imposibles del GPS
     * (>430 km/h) se descartan antes de mirar nada.
     */
    fun deduceActividad(traza: List<TrailPoint>): BeaconActivity? {
        if (traza.size < 7) return null
        val velocidades = ArrayList<Double>(traza.size)
        for (i in 1 until traza.size) {
            val horas = (traza[i].t - traza[i - 1].t) / 3_600_000.0
            if (horas <= 0) continue
            val km = distanciaMetros(
                traza[i - 1].lat, traza[i - 1].lon, traza[i].lat, traza[i].lon,
            ) / 1000.0
            val kmh = km / horas
            if (kmh < 1.5 || kmh > 430) continue
            velocidades.add(kmh)
        }
        if (velocidades.size < 6) return null
        velocidades.sort()
        val p85 = velocidades[min(velocidades.size - 1, (velocidades.size * 0.85).toInt())]
        return when {
            p85 < 8 -> BeaconActivity.WALK
            p85 < 16 -> BeaconActivity.RUN
            p85 < 40 -> BeaconActivity.BIKE
            else -> BeaconActivity.TRANSPORT
        }
    }

    // ── Batería medida ───────────────────────────────────────────────────────

    /** Una lectura del nivel de batería (0…1) en un instante. */
    data class MuestraBateria(val tMs: Double, val nivel: Double)

    /** Gasto medido y autonomía estimada. Nulos mientras no haya con qué. */
    data class Autonomia(val gastoPorHora: Double?, val horasRestantes: Double?)

    /** La ventana móvil sobre la que se mide el gasto. */
    const val VENTANA_BATERIA_MS = 45 * 60 * 1000.0

    /**
     * Gasto real medido, no teórico: (% perdido) / (horas transcurridas) sobre
     * una ventana móvil de 45 minutos.
     *
     * Tres cautelas, y las tres vienen de que el nivel de batería que da el
     * sistema es **grueso** (salta de 1 en 1, o de 5 en 5 en algunos aparatos):
     * hacen falta al menos 10 minutos y una caída de al menos 1 punto antes de
     * decir nada, o el número baila de forma ridícula; y el resultado se suaviza
     * contra el anterior para que un escalón no lo dispare. Cargando no se mide
     * — el gasto no significa nada enchufado.
     */
    fun calculaAutonomia(
        muestras: List<MuestraBateria>,
        nivelActual: Double,
        cargando: Boolean,
        gastoAnterior: Double? = null,
    ): Autonomia {
        if (cargando || nivelActual < 0) return Autonomia(null, null)
        val primera = muestras.firstOrNull() ?: return Autonomia(gastoAnterior, null)
        if (muestras.size < 2) return Autonomia(gastoAnterior, null)

        val horas = (muestras.last().tMs - primera.tMs) / 3_600_000.0
        val caidaPct = (primera.nivel - nivelActual) * 100
        if (horas < 10.0 / 60.0 || caidaPct < 1) return Autonomia(gastoAnterior, null)

        val ritmo = caidaPct / horas
        val suavizado = gastoAnterior?.let { it * 0.6 + ritmo * 0.4 } ?: ritmo
        val restantes = if (suavizado > 0) (nivelActual * 100) / suavizado else null
        return Autonomia(suavizado, restantes)
    }

    /** Descarta de la ventana las muestras demasiado viejas. */
    fun podaMuestras(muestras: List<MuestraBateria>, ahoraMs: Double): List<MuestraBateria> =
        muestras.filter { ahoraMs - it.tMs <= VENTANA_BATERIA_MS }

    /** "8 h 20 min" — la forma en que alguien mira si le llega para acabar. */
    fun formateaHoras(horas: Double): String {
        val total = (horas * 60).roundToInt()
        val h = total / 60
        val m = total % 60
        return if (h > 0) "$h h $m min" else "$m min"
    }

    // ── Notas de campo ───────────────────────────────────────────────────────

    /**
     * Id de nota generado en el CLIENTE. Es lo que hace que reintentar tras una
     * respuesta perdida sea inofensivo: el servidor inserta con `OR IGNORE`, así
     * que la misma nota mandada dos veces se queda en una. Sin esto, una nota
     * tomada sin cobertura se duplicaría al vaciar el atasco.
     *
     * 16 bytes en base64url sin relleno = 22 caracteres, dentro del
     * `^[A-Za-z0-9_-]{16,32}$` que exige el backend.
     */
    fun generaId(bytes: Int = 16, aleatorio: java.util.Random = java.security.SecureRandom()): String {
        val crudo = ByteArray(bytes).also { aleatorio.nextBytes(it) }
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(crudo)
    }

    /**
     * Dónde anclar una nota: la última lectura del GPS y, si aún no ha llegado
     * ninguna, la última posición registrada. Nulo si no hay ni una cosa ni la
     * otra — entonces no se puede anclar y hay que decirlo en vez de inventar
     * unas coordenadas.
     */
    fun anclaje(ultimaLectura: Fix?, ultimaRegistrada: Fix?): Fix? =
        ultimaLectura ?: ultimaRegistrada

    // ── Conversión de lecturas ───────────────────────────────────────────────

    /**
     * Convierte una lectura cruda del GPS en la posición que viaja al backend.
     *
     * Los `has*` llegan del `Location` de Android: los campos que el aparato no
     * conoce se OMITEN en vez de mandarse a cero, porque un rumbo 0 significa
     * "norte" y una altitud 0 "nivel del mar", y ninguna de las dos es "no lo
     * sé". Es la misma regla que gobierna todo el cuerpo JSON en [Api].
     */
    fun fixDeLectura(
        lat: Double,
        lon: Double,
        tiempoMs: Double,
        velocidad: Double? = null,
        rumbo: Double? = null,
        precision: Double? = null,
        altitud: Double? = null,
    ): Fix = Fix(
        lat = lat,
        lon = lon,
        speed = velocidad,
        heading = rumbo,
        accuracy = precision,
        altitude = altitud,
        fixAt = tiempoMs,
    )

    /** Una posición registrada se guarda además como miga de la traza local. */
    fun migaDe(fix: Fix, ahoraMs: Double): TrailPoint = TrailPoint(
        t = fix.fixAt ?: ahoraMs,
        lat = fix.lat,
        lon = fix.lon,
        a = fix.accuracy?.roundToInt(),
    )

    /**
     * Distancia entre la posición real y la última que llegó al servidor: es el
     * hueco que ve quien sigue la ruta mientras no hay cobertura. Nulo si aún no
     * hay las dos.
     */
    fun huecoSeguidores(real: Fix?, reportada: Fix?): Double? {
        if (real == null || reportada == null) return null
        return distanciaMetros(real.lat, real.lon, reportada.lat, reportada.lon)
    }

    /**
     * ¿Esta lectura es lo bastante buena para registrarla?
     *
     * Un GPS recién despertado suelta primero posiciones con cientos de metros de
     * error, y en la práctica dibujan un rayajo que sale del sitio y vuelve. Se
     * descartan salvo que no haya ninguna otra: más vale una mala que ninguna.
     */
    fun precisionAceptable(precision: Double?, hayAlguna: Boolean): Boolean = when {
        precision == null -> true
        precision <= 100.0 -> true
        else -> !hayAlguna
    }

    /**
     * ¿Es esta lectura la misma que la anterior?
     *
     * Al GPS se le engancha por partida doble —el enganche normal y el del
     * latido— y el sistema entrega la MISMA lectura a los dos. Sin este filtro
     * cada posición se registraría y se subiría dos veces. El instante del fix
     * es la firma buena: el GPS no produce dos lecturas distintas con la misma
     * marca de tiempo, mientras que las coordenadas sí se repiten legítimamente
     * cuando alguien está parado.
     */
    fun esRepetida(anterior: Fix?, nueva: Fix): Boolean {
        val t0 = anterior?.fixAt ?: return false
        val t1 = nueva.fixAt ?: return false
        return t0 == t1
    }

    /**
     * Salto imposible: dos lecturas seguidas que exigirían ir más rápido de lo
     * que permite el tipo de movimiento. El visor ya lo filtra al pintar; se
     * filtra también aquí para no llenar el atasco de basura sin cobertura.
     *
     * Con la actividad en "Automático" no se descarta nada: sin saber si va en
     * bici o en coche, cualquier tope sería inventado.
     */
    fun saltoImposible(
        anterior: Fix?,
        nuevo: Fix,
        actividad: BeaconActivity?,
        declarada: Boolean = false,
    ): Boolean {
        if (actividad == null || anterior == null) return false
        val t0 = anterior.fixAt ?: return false
        val t1 = nuevo.fixAt ?: return false
        val horas = (t1 - t0) / 3_600_000.0
        if (horas <= 0) return false
        val km = distanciaMetros(anterior.lat, anterior.lon, nuevo.lat, nuevo.lon) / 1000.0
        return (km / horas) > actividad.maxSpeedKmh * margenDeVelocidad(declarada)
    }

    /**
     * Cuánto se le perdona al tope de la actividad antes de llamar imposible a
     * un salto.
     *
     * **Declarada, 1,5.** Si alguien dice que va andando, 18 km/h ya no es
     * andar. Medido en una salida real: un salto de 78,6 m en 11 s —25,7 km/h
     * con el GPS declarando 3 m de precisión— se colaba con el margen anterior y
     * se llevaba él solo el 26 % del recorrido de toda la ruta.
     *
     * **Deducida, 3.** Aquí no se puede apretar: la actividad se deduce DE LA
     * TRAZA, así que descartar agresivamente por una deducción se muerde la cola
     * —quien empieza andando y se sube a un coche vería su traza congelada, y al
     * congelarse ya no habría datos nuevos con los que corregir la deducción.
     * Una actividad declarada es una promesa; una deducida es una conjetura, y
     * no se tiran datos por una conjetura.
     */
    fun margenDeVelocidad(declarada: Boolean): Double = if (declarada) 1.5 else 3.0

    /** Texto del aviso cuando hay atasco, tal cual lo dice iOS. */
    fun avisoSinCobertura(pendientes: Int): String =
        "Sin cobertura: $pendientes posiciones en cola; se enviarán al recuperarla."

    /** Formato del hueco para la notificación (m / km, sin decimales inútiles). */
    fun formateaDistancia(metros: Double): String = when {
        abs(metros) < 1000 -> "${metros.roundToInt()} m"
        else -> String.format("%.1f km", metros / 1000)
    }
}
