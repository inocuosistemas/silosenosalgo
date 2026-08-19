package com.themakercrowd.silosenosalgo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Las reglas del seguimiento: lo que decide si una travesía de ocho horas llega
 * entera al servidor o se queda a medias.
 *
 * Cada prueba de aquí es un caso que en el monte cuesta un día entero
 * reproducir: un tramo sin cobertura, una parada larga, un GPS que se
 * teletransporta, una traza que se pasa del tope. Comprobarlo en la JVM es la
 * única forma de no depender de salir a andar para saber si sigue bien.
 */
class TrackingRulesTest {

    private fun miga(t: Double, lat: Double, lon: Double) = TrailPoint(t = t, lat = lat, lon = lon)

    private fun fix(lat: Double, lon: Double, t: Double? = null) =
        Fix(lat = lat, lon = lon, fixAt = t)

    // ── Perfiles y GPS ───────────────────────────────────────────────────────

    @Test fun `cada perfil elige su modo y su valor`() {
        val equilibrado = TrackingRules.ritmoDe(TrackingRules.Perfil.EQUILIBRADO)
        assertEquals(TrackingRules.Modo.DISTANCIA, equilibrado.modo)
        assertEquals(100.0, equilibrado.distanciaMetros, 0.0)

        val ahorro = TrackingRules.ritmoDe(TrackingRules.Perfil.AHORRO)
        assertEquals(TrackingRules.Modo.DISTANCIA, ahorro.modo)
        assertEquals(500.0, ahorro.distanciaMetros, 0.0)

        val precision = TrackingRules.ritmoDe(TrackingRules.Perfil.PRECISION)
        assertEquals(TrackingRules.Modo.TIEMPO, precision.modo)
        assertEquals(10.0, precision.intervaloSegundos, 0.0)
    }

    @Test fun `personalizado no toca lo que el usuario ha puesto a mano`() {
        val aMano = TrackingRules.Ritmo(TrackingRules.Modo.TIEMPO, 45.0, 250.0)
        assertEquals(aMano, TrackingRules.ritmoDe(TrackingRules.Perfil.PERSONALIZADO, aMano))
    }

    @Test fun `en modo distancia el filtro se traslada al GPS`() {
        // Es la clave del ahorro: una posición descartada arriba ya se ha
        // pagado. Que filtre el propio GPS es lo que hace que parado no gaste.
        val ajuste = TrackingRules.ajusteGps(
            TrackingRules.Ritmo(TrackingRules.Modo.DISTANCIA, 15.0, 500.0),
        )
        assertEquals(500f, ajuste.distanciaMinimaM, 0f)
        assertEquals(TrackingRules.Proveedor.GPS, ajuste.proveedor)
    }

    @Test fun `intervalos largos relajan el GPS y los cortos no`() {
        val corto = TrackingRules.ajusteGps(TrackingRules.Ritmo(TrackingRules.Modo.TIEMPO, 10.0))
        val largo = TrackingRules.ajusteGps(TrackingRules.Ritmo(TrackingRules.Modo.TIEMPO, 300.0))
        assertEquals(0f, corto.distanciaMinimaM, 0f)
        assertTrue(largo.distanciaMinimaM > corto.distanciaMinimaM)
        assertTrue(largo.tiempoMinimoMs > corto.tiempoMinimoMs)
    }

    @Test fun `en modo distancia el GPS no se enciende en continuo`() {
        // En Android el filtro de distancia lo aplica el framework: el GPS se
        // enciende al ritmo del tiempo mínimo aunque nadie se mueva. Si esto se
        // baja, el perfil "Ahorro" deja de ahorrar sin que se note.
        val ajuste = TrackingRules.ajusteGps(
            TrackingRules.Ritmo(TrackingRules.Modo.DISTANCIA, 15.0, 500.0),
        )
        assertTrue(
            "el GPS se pediría cada ${ajuste.tiempoMinimoMs} ms",
            ajuste.tiempoMinimoMs >= 10_000,
        )
    }

    @Test fun `la misma lectura entregada dos veces se registra una`() {
        // Al GPS se le engancha dos veces (normal + latido) y el sistema entrega
        // la misma lectura a los dos: sin este filtro, cada punto se subiría
        // duplicado. Visto en la primera prueba de campo.
        val a = fix(41.0, 2.0, t = 1000.0)
        val repetida = fix(41.0, 2.0, t = 1000.0)
        val siguiente = fix(41.0, 2.0, t = 2000.0)
        assertTrue(TrackingRules.esRepetida(a, repetida))
        assertFalse(TrackingRules.esRepetida(a, siguiente))
    }

    @Test fun `parado, dos lecturas distintas en el mismo sitio SI se registran`() {
        // Estar quieto es legítimo: lo que delata el duplicado es el instante
        // del fix, no las coordenadas.
        val a = fix(41.0, 2.0, t = 1000.0)
        val b = fix(41.0, 2.0, t = 151_000.0)
        assertFalse(TrackingRules.esRepetida(a, b))
    }

    @Test fun `el modo espera no enciende el GPS`() {
        val espera = TrackingRules.ajusteEspera()
        assertEquals(TrackingRules.Proveedor.RED, espera.proveedor)
        assertTrue(espera.tiempoMinimoMs >= 60_000)
    }

    // ── Ritmo de registro ────────────────────────────────────────────────────

    @Test fun `en modo tiempo se respeta el intervalo elegido`() {
        val ritmo = TrackingRules.Ritmo(TrackingRules.Modo.TIEMPO, 30.0)
        assertFalse(TrackingRules.tocaRegistrar(29_000.0, 0.0, ritmo))
        assertTrue(TrackingRules.tocaRegistrar(30_000.0, 0.0, ritmo))
    }

    @Test fun `en modo distancia se registra todo lo que llega`() {
        // El GPS ya ha filtrado por desplazamiento: si ha entregado algo, es que
        // se ha movido lo pactado.
        val ritmo = TrackingRules.Ritmo(TrackingRules.Modo.DISTANCIA, 15.0, 100.0)
        assertTrue(TrackingRules.tocaRegistrar(1.0, 0.0, ritmo))
    }

    @Test fun `parado en modo distancia salta el latido`() {
        val ritmo = TrackingRules.Ritmo(TrackingRules.Modo.DISTANCIA, 15.0, 100.0)
        assertFalse(TrackingRules.tocaLatido(100_000.0, 0.0, ritmo))
        assertTrue(TrackingRules.tocaLatido(151_000.0, 0.0, ritmo))
    }

    @Test fun `en modo tiempo no hay latido porque el reloj ya manda`() {
        val ritmo = TrackingRules.Ritmo(TrackingRules.Modo.TIEMPO, 15.0)
        assertFalse(TrackingRules.tocaLatido(999_000.0, 0.0, ritmo))
    }

    @Test fun `se empieza con antelacion a la salida prevista`() {
        val salida = 1_000_000.0
        assertFalse(TrackingRules.tocaEmpezar(salida - 180_000, salida))
        assertTrue(TrackingRules.tocaEmpezar(salida - 119_000, salida))
        assertTrue(TrackingRules.tocaEmpezar(salida + 1, salida))
    }

    // ── Traza ────────────────────────────────────────────────────────────────

    @Test fun `la traza se recorta al tope`() {
        val traza = (1..5000).map { miga(it.toDouble(), 41.0, 2.0) }
        assertTrue(TrackingRules.recortaTraza(traza).size <= TrackingRules.TRAZA_MAX)
    }

    @Test fun `al recortar NUNCA se pierde el punto mas reciente`() {
        // Es la posición actual: perderla movería hacia atrás el punto que se
        // dibuja en el mapa, que es justo lo que mira quien sigue la ruta.
        val traza = (1..4001).map { miga(it.toDouble(), 41.0, 2.0) }
        val recortada = TrackingRules.recortaTraza(traza)
        assertEquals(4001.0, recortada.last().t, 0.0)
    }

    @Test fun `una traza por debajo del tope se queda igual`() {
        val traza = (1..10).map { miga(it.toDouble(), 41.0, 2.0) }
        assertEquals(traza, TrackingRules.recortaTraza(traza))
    }

    // ── Atasco ───────────────────────────────────────────────────────────────

    @Test fun `el atasco tiene tope y tira lo mas viejo`() {
        var cola = (1..TrackingRules.PENDIENTES_MAX).map { fix(41.0, it.toDouble()) }
        cola = TrackingRules.encolaPendiente(cola, fix(41.0, 99999.0))
        assertEquals(TrackingRules.PENDIENTES_MAX, cola.size)
        // Lo último que entra es lo que sobrevive: dónde está AHORA importa más
        // que dónde estaba al principio del tramo sin cobertura.
        assertEquals(99999.0, cola.last().lon, 0.0)
        assertEquals(2.0, cola.first().lon, 0.0)
    }

    @Test fun `al vaciar solo se quita el lote enviado`() {
        // Mientras la subida volaba han entrado dos posiciones nuevas: esas no
        // se han enviado y no pueden desaparecer de la cola.
        val cola = (1..5).map { fix(41.0, it.toDouble()) }
        val restantes = TrackingRules.quitaEnviados(cola, 3)
        assertEquals(2, restantes.size)
        assertEquals(4.0, restantes.first().lon, 0.0)
    }

    @Test fun `si se envio todo la cola queda vacia`() {
        val cola = (1..3).map { fix(41.0, it.toDouble()) }
        assertTrue(TrackingRules.quitaEnviados(cola, 3).isEmpty())
        assertTrue(TrackingRules.quitaEnviados(cola, 9).isEmpty())
    }

    // ── Geometría ────────────────────────────────────────────────────────────

    @Test fun `la distancia entre dos puntos conocidos cuadra`() {
        // Barcelona–Girona, ~85 km en línea recta.
        val m = TrackingRules.distanciaMetros(41.3874, 2.1686, 41.9794, 2.8214)
        assertTrue("esperados ~85 km, salieron ${m / 1000}", m in 80_000.0..90_000.0)
    }

    @Test fun `el hueco con los seguidores es nulo hasta que hay las dos posiciones`() {
        assertNull(TrackingRules.huecoSeguidores(fix(41.0, 2.0), null))
        assertNull(TrackingRules.huecoSeguidores(null, fix(41.0, 2.0)))
        assertNotNull(TrackingRules.huecoSeguidores(fix(41.0, 2.0), fix(41.01, 2.0)))
    }

    // ── Tipo de movimiento ───────────────────────────────────────────────────

    /** Traza sintética a velocidad constante: `pasoGrados` de latitud por minuto. */
    private fun trazaA(kmh: Double, puntos: Int = 20): List<TrailPoint> {
        val metrosPorMinuto = kmh * 1000 / 60
        val gradosPorMinuto = metrosPorMinuto / 111_320.0
        return (0 until puntos).map {
            miga(it * 60_000.0, 41.0 + it * gradosPorMinuto, 2.0)
        }
    }

    @Test fun `una traza a paso de andar se deduce como caminar`() {
        assertEquals(BeaconActivity.WALK, TrackingRules.deduceActividad(trazaA(5.0)))
    }

    @Test fun `una traza a velocidad de bici se deduce como bici`() {
        assertEquals(BeaconActivity.BIKE, TrackingRules.deduceActividad(trazaA(22.0)))
    }

    @Test fun `con pocos puntos no se deduce nada`() {
        // Mejor no decir nada que decir una tontería con tres migas.
        assertNull(TrackingRules.deduceActividad(trazaA(5.0, puntos = 4)))
    }

    @Test fun `las paradas no hunden la deduccion`() {
        // Media travesía parada: la media diría "caminar" de una salida en bici.
        // Por eso se usa el percentil 85 y se descartan los tramos parados.
        val enMovimiento = trazaA(22.0, puntos = 12)
        val ultima = enMovimiento.last()
        val paradas = (1..12).map { miga(ultima.t + it * 60_000.0, ultima.lat, ultima.lon) }
        assertEquals(BeaconActivity.BIKE, TrackingRules.deduceActividad(enMovimiento + paradas))
    }

    // ── Filtros de basura ────────────────────────────────────────────────────

    @Test fun `un salto imposible se descarta`() {
        val a = fix(41.0, 2.0, t = 0.0)
        val b = fix(42.0, 2.0, t = 60_000.0) // 111 km en un minuto
        assertTrue(TrackingRules.saltoImposible(a, b, BeaconActivity.WALK))
    }

    @Test fun `en automatico no se descarta ningun salto`() {
        // Sin saber si va en bici o en tren, cualquier tope sería inventado.
        val a = fix(41.0, 2.0, t = 0.0)
        val b = fix(42.0, 2.0, t = 60_000.0)
        assertFalse(TrackingRules.saltoImposible(a, b, null))
    }

    @Test fun `un paso normal no se confunde con un salto`() {
        val a = fix(41.0, 2.0, t = 0.0)
        val b = fix(41.0009, 2.0, t = 60_000.0) // ~100 m en un minuto = 6 km/h
        assertFalse(TrackingRules.saltoImposible(a, b, BeaconActivity.WALK))
    }

    @Test fun `las primeras lecturas malas se descartan salvo que no haya ninguna`() {
        // Un GPS recién despertado suelta posiciones con cientos de metros de
        // error. Se tiran... menos si es lo único que tenemos.
        assertFalse(TrackingRules.precisionAceptable(400.0, hayAlguna = true))
        assertTrue(TrackingRules.precisionAceptable(400.0, hayAlguna = false))
        assertTrue(TrackingRules.precisionAceptable(12.0, hayAlguna = true))
        assertTrue(TrackingRules.precisionAceptable(null, hayAlguna = true))
    }

    // ── Mis seguimientos ─────────────────────────────────────────────────────

    private fun sesion(
        id: String,
        activa: Boolean = false,
        fijada: Boolean = false,
        iniciada: Double = 0.0,
        terminada: Double? = null,
        caduca: Double = Double.MAX_VALUE,
    ) = TrackSessionSummary(
        id = id,
        status = if (activa) "active" else "ended",
        startedAt = iniciada,
        expiresAt = caduca,
        endedAt = terminada,
        pinned = fijada,
    )

    @Test fun `las fijadas van primero aunque sean viejas`() {
        val lista = listOf(
            sesion("nueva", terminada = 1000.0),
            sesion("vieja-fijada", fijada = true, terminada = 10.0),
        )
        assertEquals("vieja-fijada", TrackingRules.ordenaSesiones(lista).first().id)
    }

    @Test fun `las que siguen en marcha flotan por encima de las terminadas`() {
        val lista = listOf(
            sesion("terminada-hoy", terminada = 9_999_999.0),
            sesion("en-marcha", activa = true, iniciada = 1.0),
        )
        assertEquals("en-marcha", TrackingRules.ordenaSesiones(lista).first().id)
    }

    @Test fun `sin fin se ordena por lo ultimo que se sepa de ella`() {
        // Una sesión terminada sin `endedAt` (backend antiguo) no puede irse al
        // fondo de la lista: se usa updatedAt, y en su defecto el inicio.
        val a = sesion("a", iniciada = 100.0).copy(updatedAt = 500.0)
        val b = sesion("b", iniciada = 300.0)
        assertEquals("a", TrackingRules.ordenaSesiones(listOf(b, a)).first().id)
    }

    @Test fun `pasada la retencion la sesion se da por caducada`() {
        val s = sesion("x", caduca = 1000.0)
        assertFalse(TrackingRules.estaCaducada(s, 999.0))
        assertTrue(TrackingRules.estaCaducada(s, 1001.0))
    }

    @Test fun `una sesion con chincheta no caduca nunca`() {
        // Es justo lo que promete la chincheta: se conserva indefinidamente.
        val s = sesion("x", fijada = true, caduca = 1000.0)
        assertFalse(TrackingRules.estaCaducada(s, Double.MAX_VALUE))
    }

    // ── Hora de salida del plan ──────────────────────────────────────────────

    @Test fun `la hora del plan se entiende en sus varias formas`() {
        val conZ = TrackingRules.parseaIso("2026-08-19T06:30:00Z")
        val conOffset = TrackingRules.parseaIso("2026-08-19T08:30:00+02:00")
        assertNotNull(conZ)
        // Las dos son el mismo instante: 06:30 UTC y 08:30 en Madrid.
        assertEquals(conZ!!, conOffset!!, 0.0)
        assertNotNull(TrackingRules.parseaIso("2026-08-19T06:30:00.500Z"))
        assertNotNull(TrackingRules.parseaIso("2026-08-19T06:30:00"))
    }

    @Test fun `una hora ilegible no revienta, simplemente no hay plan`() {
        // Si no se entiende se usa la hora de activar, que es el comportamiento
        // de antes de elegir plan; nunca una excepción a mitad de arrancar.
        assertNull(TrackingRules.parseaIso("mañana por la mañana"))
        assertNull(TrackingRules.parseaIso(""))
        assertNull(TrackingRules.parseaIso(null))
    }

    // ── Batería medida ───────────────────────────────────────────────────────

    private fun muestras(vararg pares: Pair<Double, Double>) =
        pares.map { TrackingRules.MuestraBateria(it.first, it.second) }

    @Test fun `el gasto se mide en porcentaje por hora`() {
        // De 100 % a 90 % en una hora = 10 %/h, y a ese ritmo quedan 9 horas.
        val m = muestras(0.0 to 1.0, 3_600_000.0 to 0.90)
        val a = TrackingRules.calculaAutonomia(m, nivelActual = 0.90, cargando = false)
        assertEquals(10.0, a.gastoPorHora!!, 0.01)
        assertEquals(9.0, a.horasRestantes!!, 0.01)
    }

    @Test fun `con menos de diez minutos no se dice nada`() {
        // El nivel salta de punto en punto: antes de eso el número sería ruido.
        val m = muestras(0.0 to 1.0, 5 * 60_000.0 to 0.98)
        assertNull(TrackingRules.calculaAutonomia(m, 0.98, cargando = false).horasRestantes)
    }

    @Test fun `sin una caida de al menos un punto tampoco`() {
        val m = muestras(0.0 to 1.0, 3_600_000.0 to 0.999)
        assertNull(TrackingRules.calculaAutonomia(m, 0.999, cargando = false).horasRestantes)
    }

    @Test fun `cargando no se mide gasto`() {
        val m = muestras(0.0 to 0.5, 3_600_000.0 to 0.40)
        val a = TrackingRules.calculaAutonomia(m, 0.40, cargando = true)
        assertNull(a.gastoPorHora)
        assertNull(a.horasRestantes)
    }

    @Test fun `el gasto se suaviza contra el anterior`() {
        // Un escalón del nivel no puede disparar la estimación: 60 % de lo que
        // había y 40 % de lo nuevo.
        val m = muestras(0.0 to 1.0, 3_600_000.0 to 0.90)
        val a = TrackingRules.calculaAutonomia(m, 0.90, cargando = false, gastoAnterior = 5.0)
        assertEquals(5.0 * 0.6 + 10.0 * 0.4, a.gastoPorHora!!, 0.01)
    }

    @Test fun `la ventana solo conserva los ultimos 45 minutos`() {
        val ahora = 100 * 60_000.0
        val m = muestras(0.0 to 1.0, ahora - 10 * 60_000 to 0.9, ahora to 0.85)
        val podadas = TrackingRules.podaMuestras(m, ahora)
        assertEquals(2, podadas.size)
    }

    @Test fun `la autonomia se lee como la leeria una persona`() {
        assertEquals("8 h 20 min", TrackingRules.formateaHoras(8.333))
        assertEquals("45 min", TrackingRules.formateaHoras(0.75))
    }

    // ── Notas de campo ───────────────────────────────────────────────────────

    @Test fun `el id de nota cumple lo que exige el backend`() {
        // El servidor valida ^[A-Za-z0-9_-]{16,32}$; si no cuadra, se inventa
        // otro id y la nota deja de ser idempotente al reintentar.
        val re = Regex("^[A-Za-z0-9_-]{16,32}$")
        repeat(200) {
            val id = TrackingRules.generaId()
            assertTrue("id fuera de formato: $id", re.matches(id))
        }
    }

    @Test fun `dos ids seguidos no se repiten`() {
        val ids = (1..500).map { TrackingRules.generaId() }.toSet()
        assertEquals(500, ids.size)
    }

    @Test fun `la nota se ancla a la lectura mas fresca disponible`() {
        val gps = fix(41.0, 2.0)
        val registrada = fix(40.0, 1.0)
        assertEquals(gps, TrackingRules.anclaje(gps, registrada))
        // Sin lectura del GPS todavía, vale la última registrada.
        assertEquals(registrada, TrackingRules.anclaje(null, registrada))
        // Sin ninguna de las dos NO se inventa una posición.
        assertNull(TrackingRules.anclaje(null, null))
    }

    // ── Presentación ─────────────────────────────────────────────────────────

    @Test fun `las distancias se formatean en metros o kilometros`() {
        assertEquals("240 m", TrackingRules.formateaDistancia(240.4))
        assertTrue(TrackingRules.formateaDistancia(2400.0).endsWith("km"))
    }

    @Test fun `una lectura sin rumbo ni altitud NO manda ceros`() {
        // Un rumbo 0 es "norte" y una altitud 0 es "nivel del mar": ninguna de
        // las dos significa "no lo sé", y mandarlas borraría el dato bueno.
        val f = TrackingRules.fixDeLectura(lat = 41.0, lon = 2.0, tiempoMs = 1.0)
        assertNull(f.heading)
        assertNull(f.altitude)
        assertNull(f.speed)
        assertEquals(1.0, f.fixAt!!, 0.0)
    }
}
