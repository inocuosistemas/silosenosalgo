package com.themakercrowd.silosenosalgo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * ¿Hay un APK más nuevo que este?
 *
 * La app de Android no pasa por ninguna tienda: se instala desde el enlace de
 * GitHub, y nada avisa de que ha salido otra. En la CanFranc corrieron balizas de
 * versiones distintas y la única forma de saberlo era preguntar a cada uno. Esto
 * mira la última publicada al abrir la app y, si es más nueva, lo dice junto a la
 * versión con el enlace directo al APK.
 *
 * Se pregunta a GitHub y no a nuestro servidor a propósito: lo que se ha publicado
 * lo dice el propio release, y así no hay un número más que acordarse de subir.
 * Sin red, o si GitHub no contesta, no se dice nada.
 */
object Actualizacion {
    /** El enlace que no caduca: apunta siempre al APK de la última versión. */
    const val APK_URL = "https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk"

    private const val ULTIMA_URL = "https://api.github.com/repos/inocuosistemas/silosenosalgo/releases/latest"

    /** El `versionCode` de una etiqueta de release: `v1.0-483` → 483. */
    fun versionDeEtiqueta(etiqueta: String): Int? =
        Regex("""-(\d+)$""").find(etiqueta.trim())?.groupValues?.get(1)?.toIntOrNull()

    /**
     * La versión que merece la pena anunciar, o null. Solo si es MÁS nueva: una
     * compilada a mano desde un commit posterior al último release no tiene nada
     * que descargar.
     */
    fun nuevaQue(actual: Int, publicada: Int?): Int? = publicada?.takeIf { it > actual }

    /** La última publicada en GitHub, o null si no se sabe. */
    suspend fun ultimaPublicada(client: OkHttpClient = Api.defaultClient): Int? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url(ULTIMA_URL)
                .header("Accept", "application/vnd.github+json")
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val cuerpo = resp.body?.string() ?: return@use null
                Api.json.parseToJsonElement(cuerpo).jsonObject["tag_name"]?.jsonPrimitive?.content
                    ?.let(::versionDeEtiqueta)
            }
        }.getOrNull()
    }
}
