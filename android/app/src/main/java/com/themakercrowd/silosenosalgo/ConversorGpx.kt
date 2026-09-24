package com.themakercrowd.silosenosalgo

import android.annotation.SuppressLint
import android.content.Context
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Convierte un GPX en ruta con el MISMO código que la web.
 *
 * La app no sabe leer GPX, y reescribir el lector en Kotlin sería tener otro
 * más que acaba diciendo cosas distintas (distancias, desnivel, waypoints). Así
 * que se carga, en un visor oculto, la web que la app ya lleva dentro para ir
 * sin cobertura —`index.html?convierte=gpx`, una página sin interfaz—, se le
 * pasa el fichero y devuelve la ruta hecha. Todo en el móvil: funciona en modo
 * avión. Espejo de `GpxImporter` en iOS; ver `src/lib/convierteGpx.ts`.
 */
class ConversorGpx(private val context: Context) {

    data class Ruta(val nombre: String, val distanciaKm: Double, val desnivelM: Double, val cuerpo: ByteArray)

    class Fallo(mensaje: String) : Exception(mensaje)

    /**
     * El puente con la página. El GPX no viaja metido en un trozo de JS —un
     * fichero de megas escapado a mano—: la página se lo PIDE al puente, y
     * contesta por él. Los métodos los llama el visor desde su propio hilo.
     */
    private class Puente {
        @Volatile var gpx = ""
        @Volatile var nombreFichero = ""
        @Volatile var act = ""
        @Volatile var plan = ""
        @Volatile var ajustes = ""
        @Volatile var salida = 0.0
        @Volatile var espera: CompletableDeferred<Result<String>>? = null

        @JavascriptInterface fun texto(): String = gpx
        @JavascriptInterface fun fichero(): String = nombreFichero
        @JavascriptInterface fun actividad(): String = act
        @JavascriptInterface fun planGz(): String = plan
        @JavascriptInterface fun ajustesJson(): String = ajustes
        @JavascriptInterface fun salidaMs(): Double = salida
        @JavascriptInterface fun hecho(json: String) { espera?.complete(Result.success(json)) }
        @JavascriptInterface fun fallo(mensaje: String) { espera?.complete(Result.failure(Fallo(mensaje))) }
    }

    private val puente = Puente()
    private var web: WebView? = null

    suspend fun convierte(texto: String, fichero: String, actividad: String?): Ruta = withContext(Dispatchers.Main) {
        val web = preparado()
        puente.gpx = texto
        puente.nombreFichero = fichero
        puente.act = actividad ?: ""
        val espera = CompletableDeferred<Result<String>>()
        puente.espera = espera
        web.evaluateJavascript(
            "window.slsnsGpxARuta(SlsnsPuente.texto(), SlsnsPuente.fichero(), SlsnsPuente.actividad())" +
                ".then(function (r) { SlsnsPuente.hecho(JSON.stringify(r)) }," +
                " function (e) { SlsnsPuente.fallo(String((e && e.message) || e)) })",
            null,
        )
        val json = try {
            withTimeout(120_000) { espera.await() }.getOrThrow()
        } finally {
            // El GPX puede ser de megas: no se queda colgado del puente.
            puente.gpx = ""
            puente.espera = null
        }
        val d = JSONObject(json)
        Ruta(
            nombre = d.getString("nombre"),
            distanciaKm = d.getDouble("distanciaKm"),
            desnivelM = d.getDouble("desnivelM"),
            cuerpo = Base64.decode(d.getString("cuerpoBase64"), Base64.DEFAULT),
        )
    }

    /**
     * La hoja de tramos de una carrera (ver `src/lib/hojaDeTramos.ts`), con el
     * mismo código que la web y que iOS: el texto JSON tal cual, para guardarlo.
     */
    suspend fun hojaDeTramos(planGz: ByteArray, ajustes: String?, salidaMs: Double?): String = withContext(Dispatchers.Main) {
        val web = preparado()
        puente.plan = Base64.encodeToString(planGz, Base64.NO_WRAP)
        puente.ajustes = ajustes ?: ""
        puente.salida = salidaMs ?: 0.0
        val espera = CompletableDeferred<Result<String>>()
        puente.espera = espera
        web.evaluateJavascript(
            "window.slsnsHojaDeTramos(SlsnsPuente.planGz(), SlsnsPuente.ajustesJson(), SlsnsPuente.salidaMs())" +
                ".then(function (r) { SlsnsPuente.hecho(r) }," +
                " function (e) { SlsnsPuente.fallo(String((e && e.message) || e)) })",
            null,
        )
        try {
            withTimeout(60_000) { espera.await() }.getOrThrow()
        } finally {
            puente.plan = ""
            puente.espera = null
        }
    }

    /** Suelta el visor oculto cuando ya no hace falta. */
    fun suelta() {
        web?.destroy()
        web = null
    }

    /** El visor oculto, cargado y con el conversor a punto. Se crea una vez. */
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private suspend fun preparado(): WebView {
        web?.let { return it }
        val nuevo = WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // El mismo interceptor que el visor del mapa: sirve la web
            // empaquetada sin salir a la red.
            webViewClient = ClienteVisor(context)
            addJavascriptInterface(puente, "SlsnsPuente")
            loadUrl("${VisorWeb.ORIGEN}/index.html?convierte=gpx")
        }
        // Hasta diez segundos a que la página diga que está lista.
        repeat(50) {
            delay(200)
            val listo = suspendCancellableCoroutine { cont ->
                nuevo.evaluateJavascript("window.slsnsConversorListo === true") { cont.resume(it == "true") }
            }
            if (listo) {
                web = nuevo
                return nuevo
            }
        }
        nuevo.destroy()
        throw Fallo("No se pudo preparar el lector de GPX. Vuelve a intentarlo.")
    }
}
