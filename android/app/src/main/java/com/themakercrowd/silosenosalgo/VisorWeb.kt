package com.themakercrowd.silosenosalgo

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayInputStream

/**
 * El visor incrustado: el MISMO código web que ve quien te sigue desde casa,
 * servido entero desde el móvil para que funcione sin cobertura.
 *
 * Espejo de `ios/Sources/AppWebSchemeHandler.swift` + `WebView.swift`. Allí se
 * usa un esquema propio (`appweb://`) porque WebKit no deja interceptar
 * http/https; aquí se usa el dominio reservado de Android,
 * `https://appassets.androidplatform.net`, que se intercepta igual y además da
 * un **origen seguro**: sin él, el visor perdería las APIs web que solo
 * funcionan bajo https y fallaría de formas difíciles de relacionar con la causa.
 *
 * Las peticiones relativas del visor caen aquí:
 *
 *  - `/`, `/index.html`, los de `assets/`, iconos… → [WebAssetStore] (copia OTA
 *    activa si la hay, si no la empaquetada en el APK)
 *  - `/api/track/<id>` → el estado fabricado en local por [ViewerData]
 *  - `/api/track/<id>/notes/<noteId>/media?kind=` → la foto o el audio que ya
 *    están en el móvil
 *  - `/_tile/z/x/y.png` → [TileCache]
 *
 * El documento se carga con `?t=<id>&embedded=1` para que `main.tsx` entre por
 * la rama del visor y use las teselas cacheadas.
 */
object VisorWeb {

    /** Dominio reservado de Android para servir contenido propio con origen
     *  seguro. No sale a la red: todo lo resuelve el interceptor. */
    const val ORIGEN = "https://appassets.androidplatform.net"

    fun urlDelVisor(sessionId: String): String = "$ORIGEN/index.html?t=$sessionId&embedded=1"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VisorIncrustado(
    sessionId: String,
    estado: TrackingStore.Estado,
    notas: List<Note>,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.apply {
                    javaScriptEnabled = true
                    // El visor guarda preferencias (capas, unidades) en
                    // localStorage: sin esto se olvidan en cada apertura.
                    domStorageEnabled = true
                    // Todo se sirve desde el móvil, así que no hay nada que
                    // pedirle a la red; forzar caché evitaría reintentos inútiles
                    // sin cobertura, pero el interceptor ya contesta a todo.
                    cacheMode = WebSettings.LOAD_DEFAULT
                    // El mapa necesita gestos de zoom, pero sin los controles
                    // encima: el visor ya trae los suyos.
                    builtInZoomControls = false
                    setSupportZoom(false)
                }
                webViewClient = ClienteVisor(context)
                loadUrl(VisorWeb.urlDelVisor(sessionId))
            }
        },
        update = { web ->
            // El visor se refresca solo (hace poll a /api/track/:id), así que no
            // hace falta recargarlo al cambiar el estado: la siguiente vuelta de
            // su propio temporizador ya trae la posición nueva. Recargar aquí
            // tiraría el zoom y el centro del mapa cada pocos segundos.
            ClienteVisor.ultimoEstado = estado
            ClienteVisor.ultimasNotas = notas
        },
    )
}

/**
 * El interceptor. Contesta a TODAS las peticiones del visor sin salir a la red
 * (salvo las teselas, que sí se bajan y se guardan).
 */
private class ClienteVisor(context: Context) : WebViewClient() {

    private val assets = WebAssetStore(context.applicationContext)
    private val teselas = TileCache(context.applicationContext)

    companion object {
        /** El estado y las notas que se le enseñan al visor. Se actualizan desde
         *  la composición; el interceptor corre en otro hilo y solo lee. */
        @Volatile var ultimoEstado: TrackingStore.Estado = TrackingStore.Estado()
        @Volatile var ultimasNotas: List<Note> = emptyList()
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        val url = request.url
        if (url.host != "appassets.androidplatform.net") return null
        val ruta = url.path ?: "/"

        // Teselas del mapa. El interceptor es síncrono y WebView ya lo llama en
        // un hilo de trabajo, así que aquí sí se puede bloquear: es lo que hace
        // que el mapa dibuje en orden en vez de a saltos.
        TileCache.parseaRuta(ruta)?.let { (z, x, y) ->
            val bytes = runBlocking { teselas.tesela(z, x, y) }
            return respuesta(bytes, "image/png")
        }

        // Medios de las notas, servidos desde el móvil: la foto ya está aquí, no
        // tiene sentido ir a buscarla a internet.
        parseaMedio(ruta)?.let { (id, noteId) ->
            val kind = url.getQueryParameter("kind")
            if ((kind == "audio" || kind == "photo") && ViewerData.esLaActual(id)) {
                val bytes = TrackingStore.medioDeNota(id, noteId, kind)
                if (bytes != null) {
                    val mime = if (kind == "audio") "audio/mp4" else "image/jpeg"
                    return respuesta(bytes, mime, sinCache = true)
                }
            }
            return noEncontrado()
        }

        // El estado de la sesión, fabricado con la traza local.
        if (ruta.startsWith("/api/track/")) {
            val id = ruta.removePrefix("/api/track/").substringBefore('/')
            val json = ViewerData.estadoJson(id, ultimoEstado, ultimasNotas)
                ?: return noEncontrado()
            return respuesta(json.toByteArray(), "application/json", sinCache = true)
        }

        // Ficheros estáticos del visor.
        assets.carga(ruta)?.let { (bytes, mime) -> return respuesta(bytes, mime) }
        return noEncontrado()
    }

    private fun respuesta(
        datos: ByteArray,
        mime: String,
        sinCache: Boolean = false,
    ): WebResourceResponse {
        val cabeceras = mutableMapOf("Access-Control-Allow-Origin" to "*")
        if (sinCache) cabeceras["Cache-Control"] = "no-store"
        return WebResourceResponse(
            mime,
            if (mime.startsWith("text/") || mime.endsWith("json")) "utf-8" else null,
            200,
            "OK",
            cabeceras,
            ByteArrayInputStream(datos),
        )
    }

    private fun noEncontrado() = WebResourceResponse(
        "text/plain", "utf-8", 404, "No encontrado",
        mapOf("Access-Control-Allow-Origin" to "*"),
        ByteArrayInputStream(ByteArray(0)),
    )

    /** "/api/track/<id>/notes/<noteId>/media" */
    private fun parseaMedio(ruta: String): Pair<String, String>? {
        val partes = ruta.trim('/').split('/')
        if (partes.size != 6) return null
        if (partes[0] != "api" || partes[1] != "track" || partes[3] != "notes" ||
            partes[5] != "media"
        ) {
            return null
        }
        return partes[2] to partes[4]
    }
}
