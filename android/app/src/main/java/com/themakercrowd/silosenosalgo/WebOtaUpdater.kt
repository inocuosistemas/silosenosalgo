package com.themakercrowd.silosenosalgo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Descarga y activa versiones nuevas del visor web. Espejo de
 * `ios/Sources/WebOTAUpdater.swift`; las **reglas** de qué se acepta viven
 * aparte, en [OtaRules], y están probadas en la JVM.
 *
 * La regla que gobierna todo esto es **todo o nada**: se descarga a `staging/`,
 * se verifica el build entero y solo entonces se promociona a `active/`.
 * Cualquier fallo —red, hash, fichero que falta, cáscara desparejada— deja la
 * copia activa intacta. Esta es una app de montaña: un visor a medias se
 * descubriría justo donde no hay cobertura para arreglarlo.
 */
class WebOtaUpdater(
    context: Context,
    private val cliente: OkHttpClient = clientePorDefecto,
) {

    private val assets = WebAssetStore(context.applicationContext)

    companion object {
        /** El manifiesto que publica el build de producción. */
        const val RUTA_MANIFIESTO = "ota-manifest.json"

        private val clientePorDefecto: OkHttpClient by lazy {
            Api.defaultClient.newBuilder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()
        }
    }

    /**
     * Mira si hay build nuevo y, si lo hay, lo descarga y lo activa. Devuelve el
     * buildId activado, o null si no había nada que hacer o algo falló.
     *
     * **Nunca lanza**: se llama al abrir la app y un fallo aquí no puede impedir
     * usarla. Si algo va mal se limpia el staging y se sigue con lo que hubiera.
     */
    suspend fun actualiza(): String? = withContext(Dispatchers.IO) {
        try {
            val manifiesto = descargaManifiesto() ?: return@withContext null
            if (!OtaRules.hayQueActualizar(manifiesto, assets.buildIdInstalado())) {
                return@withContext null
            }
            if (OtaRules.validaManifiesto(manifiesto) != null) return@withContext null

            val descargados = descargaFicheros(manifiesto) ?: return@withContext null
            if (OtaRules.validaDescarga(manifiesto, descargados) != null) return@withContext null

            escribeStaging(manifiesto, descargados)
            promociona(manifiesto.buildId)
            manifiesto.buildId
        } catch (e: Exception) {
            // Se limpia el staging para no dejar basura ni reintentar sobre restos.
            runCatching { assets.dirStaging.deleteRecursively() }
            null
        }
    }

    private fun descargaManifiesto(): OtaRules.Manifest? = runCatching {
        val req = Request.Builder()
            .url("${Config.BASE_URL}/$RUTA_MANIFIESTO")
            .header("Cache-Control", "no-cache")
            .build()
        cliente.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val cuerpo = resp.body?.string() ?: return null
            Api.json.decodeFromString<OtaRules.Manifest>(cuerpo)
        }
    }.getOrNull()

    /**
     * Baja todos los ficheros a memoria y los verifica uno a uno según van
     * llegando. Se corta al primer fallo: seguir bajando megas de un build que ya
     * sabemos que no vamos a activar solo gasta datos móviles.
     */
    private fun descargaFicheros(m: OtaRules.Manifest): Map<String, ByteArray>? {
        val recogidos = HashMap<String, ByteArray>(m.files.size)
        for (entrada in m.files) {
            val bytes = runCatching {
                val req = Request.Builder().url("${Config.BASE_URL}/${entrada.path}").build()
                cliente.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) null else resp.body?.bytes()
                }
            }.getOrNull() ?: return null

            if (!OtaRules.verificaFichero(entrada, bytes)) return null
            recogidos[entrada.path] = bytes
        }
        return recogidos
    }

    private fun escribeStaging(m: OtaRules.Manifest, datos: Map<String, ByteArray>) {
        val staging = assets.dirStaging
        staging.deleteRecursively()
        staging.mkdirs()
        for ((ruta, bytes) in datos) {
            val destino = File(staging, ruta)
            destino.parentFile?.mkdirs()
            destino.writeBytes(bytes)
        }
        // La marca del build va DENTRO del directorio, no en preferencias: así el
        // id instalado y los ficheros no pueden desincronizarse nunca.
        File(staging, "ota-buildid").writeText(m.buildId)
    }

    /**
     * El cambio de activo. Es el único momento delicado: se borra el anterior y
     * se renombra el staging encima. Si el proceso muriera justo entre las dos
     * cosas quedaría sin copia activa, y entonces [WebAssetStore] sirve la
     * empaquetada en el APK — que es exactamente el comportamiento que queremos
     * como red de seguridad.
     */
    private fun promociona(buildId: String) {
        val activo = assets.dirActivo
        runCatching { activo.deleteRecursively() }
        activo.parentFile?.mkdirs()
        if (!assets.dirStaging.renameTo(activo)) {
            // Renombrar puede fallar entre volúmenes; se copia y se limpia.
            assets.dirStaging.copyRecursively(activo, overwrite = true)
            assets.dirStaging.deleteRecursively()
        }
    }
}
