package com.themakercrowd.silosenosalgo

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * El golpecito que se siente al tocar: elegir carrera, empezar a compartir y
 * parar.
 *
 * No es adorno. La baliza se maneja con prisa, con guantes y sin mirar —en la
 * línea de salida, o al llegar—, y el aviso por el tacto confirma que el toque
 * ha entrado sin tener que leer la pantalla. Espejo de `Vibra.swift` en iOS.
 *
 * Lo da el SISTEMA a través de la vista (`performHapticFeedback`), no el motor
 * de vibración a pelo: así no hace falta el permiso VIBRATE, y respeta que
 * quien tenga la vibración apagada no la sienta. `CONFIRM` y `REJECT` son de
 * Android 11; por debajo se usan los de siempre, que se notan parecido.
 */
object Vibracion {
    /** Algo cambia de estado: una carrera elegida o soltada. */
    fun eleccion(vista: View) = vista.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)

    /** Algo ARRANCA y sale bien: la baliza empieza a emitir. */
    fun exito(vista: View) = vista.performHapticFeedback(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
        else HapticFeedbackConstants.KEYBOARD_TAP,
    )

    /** Algo se PARA: la baliza deja de emitir. Distinto del de empezar, para
     *  que no se confundan al tacto. */
    fun fin(vista: View) = vista.performHapticFeedback(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT
        else HapticFeedbackConstants.LONG_PRESS,
    )
}
