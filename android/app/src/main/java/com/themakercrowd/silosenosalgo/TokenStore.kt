package com.themakercrowd.silosenosalgo

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * El token de sesión, cifrado en reposo. Espejo de `ios/Sources/Keychain.swift`:
 * allí el llavero, aquí EncryptedSharedPreferences respaldado por el Keystore
 * del dispositivo (la clave maestra no sale del hardware).
 *
 * Si el almacén cifrado no se puede abrir —pasa cuando el usuario cambia el
 * bloqueo de pantalla y el Keystore invalida la clave— se borra y se empieza de
 * cero: perder el token solo obliga a iniciar sesión otra vez, mientras que
 * quedarse sin poder arrancar dejaría la app inservible.
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = abrir(context)

    companion object {
        private const val FILE = "slsns_secure"
        private const val KEY_TOKEN = "auth_token"

        private fun abrir(context: Context): SharedPreferences {
            val crear = {
                val master = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context, FILE, master,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            }
            return runCatching { crear() }.getOrElse {
                context.deleteSharedPreferences(FILE)
                crear()
            }
        }
    }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit().apply {
                if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
            }.apply()
        }

    fun clear() { token = null }
}
