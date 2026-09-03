package com.themakercrowd.silosenosalgo

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Si el movil tiene salida a la red.
 *
 * Hace falta porque la baliza es una app de montaña: buena parte de lo que
 * enseña —las previsiones, los eventos, los seguimientos anteriores— vive en el
 * servidor, asi que sin cobertura esas listas salen VACIAS. Y una lista vacia
 * miente: dice "no tienes seguimientos" cuando lo que pasa es que no se pueden
 * consultar. Sabiendo que no hay red, la pantalla puede decir la verdad.
 *
 * Con `NetworkCallback` y no con un "he fallado al pedir algo": el sistema sabe
 * del estado del enlace en el momento, sin esperar a que una peticion caduque,
 * y avisa solo cuando la cobertura vuelve —que es justo cuando toca refrescar—.
 */
object Conectividad {

    private val _online = MutableStateFlow(true)
    /** Empieza en `true`: hasta que el sistema diga otra cosa, lo normal es
     *  tener red, y arrancar avisando de un problema que aun no se sabe si
     *  existe seria peor que callar. */
    val online: StateFlow<Boolean> = _online

    private var iniciado = false

    fun inicia(context: Context) {
        if (iniciado) return
        iniciado = true
        val cm = context.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        // Se pregunta el estado actual antes de escuchar: si ya se arranca sin
        // cobertura, el aviso tiene que estar desde el primer pintado.
        _online.value = cm.activeNetwork
            ?.let { cm.getNetworkCapabilities(it) }
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        runCatching {
            cm.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) { _online.value = true }
                    override fun onLost(network: Network) { _online.value = false }
                },
            )
        }
    }
}
