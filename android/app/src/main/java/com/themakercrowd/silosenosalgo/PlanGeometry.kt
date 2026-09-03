package com.themakercrowd.silosenosalgo

import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.util.zip.GZIPInputStream

/**
 * Saca el trazado de una ruta planificada de su blob guardado, que es lo que
 * permite bajarse el mapa de la travesía por adelantado.
 *
 * Espejo de `ios/Sources/PlanGeometry.swift`. Allí hay que descomprimir el gzip
 * a mano —quitando cabecera y cola— porque la API de compresión de Apple solo
 * entiende deflate crudo; aquí `GZIPInputStream` lo hace directamente, así que
 * esa complicación no se porta.
 *
 * Los blobs los genera el navegador con `CompressionStream('gzip')` al guardar
 * el plan, y viajan comprimidos de punta a punta: el backend no los toca.
 */
object PlanGeometry {

    /** Tope de descompresión. Un blob manipulado podría expandirse hasta
     *  quedarse con toda la memoria; un plan real no pasa de unos pocos MB. */
    const val MAX_DESCOMPRIMIDO = 32 * 1024 * 1024

    fun descomprime(gz: ByteArray): ByteArray? = runCatching {
        GZIPInputStream(ByteArrayInputStream(gz)).use { entrada ->
            val salida = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val leidos = entrada.read(buffer)
                if (leidos <= 0) break
                total += leidos
                if (total > MAX_DESCOMPRIMIDO) return null
                salida.write(buffer, 0, leidos)
            }
            salida.toByteArray()
        }
    }.getOrNull()

    /**
     * El trazado `[(lat, lon)]` que hay dentro de un SharePayload comprimido.
     * Null si el blob no se puede leer o no trae ruta: entonces no hay corredor
     * que descargar y hay que decirlo, no fabricar una ruta vacía.
     */
    fun trazado(gz: ByteArray): List<Pair<Double, Double>>? = runCatching {
        val json = descomprime(gz) ?: return null
        val raiz = Api.json.parseToJsonElement(json.toString(Charsets.UTF_8)).jsonObject
        val puntos = raiz["track"]?.jsonObject?.get("points")?.jsonArray ?: return null

        val ruta = puntos.mapNotNull { punto ->
            val o = punto.jsonObject
            val lat = o["lat"]?.jsonPrimitive?.doubleOrNull
            val lon = o["lon"]?.jsonPrimitive?.doubleOrNull
            if (lat != null && lon != null) lat to lon else null
        }
        ruta.ifEmpty { null }
    }.getOrNull()

    /** El nombre de la ruta, para poder decir qué se está descargando. */
    fun nombre(gz: ByteArray): String? = runCatching {
        val json = descomprime(gz) ?: return null
        val raiz = Api.json.parseToJsonElement(json.toString(Charsets.UTF_8)).jsonObject
        raiz["name"]?.jsonPrimitive?.contentOrNull
            ?: raiz["track"]?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    /** Dónde cae una nota sobre la ruta prevista. */
    data class MetricasNota(val kmDeRuta: Double?, val desnivelPositivoM: Double?)

    /** Un punto del plan con su altitud. */
    data class PuntoPlan(val lat: Double, val lon: Double, val ele: Double)

    /**
     * Los puntos del plan CON altitud. Null si a alguno le falta: mezclar puntos
     * con y sin altitud daría un desnivel acumulado inventado.
     */
    fun puntosConAltitud(gz: ByteArray): List<PuntoPlan>? = runCatching {
        val json = descomprime(gz) ?: return null
        val raiz = Api.json.parseToJsonElement(json.toString(Charsets.UTF_8)).jsonObject
        val crudos = raiz["track"]?.jsonObject?.get("points")?.jsonArray ?: return null
        val puntos = crudos.mapNotNull { p ->
            val o = p.jsonObject
            val lat = o["lat"]?.jsonPrimitive?.doubleOrNull
            val lon = o["lon"]?.jsonPrimitive?.doubleOrNull
            val ele = o["ele"]?.jsonPrimitive?.doubleOrNull
            if (lat != null && lon != null && ele != null) PuntoPlan(lat, lon, ele) else null
        }
        if (puntos.size != crudos.size || puntos.isEmpty()) null else puntos
    }.getOrNull()

    /**
     * Desnivel positivo acumulado a lo largo de la ruta, con la **histéresis de
     * 1 m** que usan los cálculos de GPX de la web.
     *
     * La histéresis no es un refinamiento: sin ella, el ruido del altímetro
     * —que sube y baja unos centímetros en cada punto— se suma miles de veces y
     * convierte un paseo llano en una etapa de montaña. Solo se acumula cuando
     * la subida pendiente llega al metro; cualquier bajada la descarta.
     */
    fun desnivelAcumulado(puntos: List<PuntoPlan>): List<Double> {
        val acumulado = DoubleArray(puntos.size)
        var ganancia = 0.0
        var pendiente = 0.0
        for (i in 1 until puntos.size) {
            val delta = puntos[i].ele - puntos[i - 1].ele
            if (delta > 0) {
                pendiente += delta
                if (pendiente >= 1) { ganancia += pendiente; pendiente = 0.0 }
            } else if (delta < 0) {
                pendiente = 0.0
            }
            acumulado[i] = ganancia
        }
        return acumulado.toList()
    }

    /** Kilómetro acumulado en cada punto del plan. */
    fun kmAcumulado(puntos: List<PuntoPlan>): List<Double> {
        val km = DoubleArray(puntos.size)
        for (i in 1 until puntos.size) {
            km[i] = km[i - 1] + TrackingRules.distanciaMetros(
                puntos[i - 1].lat, puntos[i - 1].lon, puntos[i].lat, puntos[i].lon,
            ) / 1000.0
        }
        return km.toList()
    }

    /**
     * En qué kilometro del RECORRIDO esta una posicion.
     *
     * Se busca el punto del trazado mas cercano, pero solo dentro de una
     * VENTANA alrededor del kilometro anterior. Eso es lo que distingue este
     * calculo de "el punto mas cercano" a secas, y no es un detalle: en un
     * circuito que empieza y acaba en el mismo pueblo, o en una ruta que pasa
     * dos veces por el mismo collado, el punto mas cercano al llegar a meta es
     * el de la salida — y el corredor aparece en el km 0 despues de cinco
     * horas. Con la ventana no puede saltar hacia atras medio recorrido.
     *
     * La primera vez (sin km anterior) se busca en todo el trazado, que es lo
     * unico que se puede hacer y ademas es correcto: al empezar se esta donde
     * se esta.
     *
     * Devuelve null si la posicion queda LEJOS del recorrido (mas de 250 m):
     * quien va por otro sitio no tiene kilometro de esta ruta, y decir uno
     * inventado es peor que no decir ninguno.
     */
    fun proyectaKm(
        puntos: List<PuntoPlan>,
        kmAcum: List<Double>,
        lat: Double,
        lon: Double,
        kmPrevio: Double?,
        ventanaKm: Double = 3.0,
        toleranciaM: Double = 250.0,
    ): Double? {
        if (puntos.isEmpty() || puntos.size != kmAcum.size) return null
        var desde = 0
        var hasta = puntos.size - 1
        if (kmPrevio != null) {
            val min = kmPrevio - ventanaKm
            val max = kmPrevio + ventanaKm
            desde = kmAcum.indexOfFirst { it >= min }.let { if (it < 0) puntos.size - 1 else it }
            hasta = kmAcum.indexOfLast { it <= max }.let { if (it < 0) desde else it }
            if (hasta < desde) hasta = desde
        }
        var mejor = -1
        var mejorD = Double.MAX_VALUE
        for (i in desde..hasta) {
            val d = TrackingRules.distanciaMetros(lat, lon, puntos[i].lat, puntos[i].lon)
            if (d < mejorD) { mejorD = d; mejor = i }
        }
        if (mejor < 0 || mejorD > toleranciaM) return null
        return kmAcum[mejor]
    }

    /**
     * Para cada nota, en qué kilómetro de la ruta prevista cae y cuánto desnivel
     * llevaba acumulado ahí. Es lo que convierte "una fuente en algún sitio" en
     * "la fuente del km 23,4, tras 1.200 m de subida".
     *
     * Sin plan no se inventa nada: se cae al kilómetro que la propia nota traiga
     * (el recorrido real medido) y el desnivel se queda sin saber.
     */
    fun metricasDeNotas(
        puntos: List<PuntoPlan>?,
        notas: List<Note>,
    ): Map<String, MetricasNota> {
        if (puntos.isNullOrEmpty()) {
            return notas.associate { nota ->
                nota.id to MetricasNota(nota.trackKm ?: nota.distM?.div(1000), null)
            }
        }

        val km = kmAcumulado(puntos)
        val desnivel = desnivelAcumulado(puntos)

        return notas.associate { nota ->
            var mejor = 0
            var mejorDistancia = Double.MAX_VALUE
            for (i in puntos.indices) {
                val d = TrackingRules.distanciaMetros(
                    nota.lat, nota.lon, puntos[i].lat, puntos[i].lon,
                )
                if (d < mejorDistancia) { mejorDistancia = d; mejor = i }
            }
            nota.id to MetricasNota(km[mejor], desnivel[mejor])
        }
    }

    /**
     * Por dónde bajar el mapa: la ruta planificada si la hay y, si no, la traza
     * ya recorrida — para que una salida sin plan también pueda cachear el mapa
     * de por donde ha pasado.
     */
    fun rutaParaDescargar(
        planificada: List<Pair<Double, Double>>?,
        recorrida: List<TrailPoint>,
    ): List<Pair<Double, Double>>? = when {
        !planificada.isNullOrEmpty() -> planificada
        recorrida.isNotEmpty() -> recorrida.map { it.lat to it.lon }
        else -> null
    }
}
