package com.themakercrowd.silosenosalgo

import com.google.android.gms.location.DetectedActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Lo que dice el reconocimiento de actividad, a los códigos de `TrailPoint.m`. */
class SensorDeMovimientoTest {
    @Test fun enVehiculoMandaSobreQuieto() {
        // Parado en un semáforo: vehículo y quieto a la vez.
        assertEquals("v", SensorDeMovimiento.codigo(listOf(DetectedActivity.STILL to 80, DetectedActivity.IN_VEHICLE to 60)))
    }

    @Test fun cadaActividadSuCodigo() {
        assertEquals("b", SensorDeMovimiento.codigo(listOf(DetectedActivity.ON_BICYCLE to 90)))
        assertEquals("r", SensorDeMovimiento.codigo(listOf(DetectedActivity.RUNNING to 70, DetectedActivity.ON_FOOT to 70)))
        assertEquals("w", SensorDeMovimiento.codigo(listOf(DetectedActivity.ON_FOOT to 75)))
        assertEquals("q", SensorDeMovimiento.codigo(listOf(DetectedActivity.STILL to 95)))
    }

    @Test fun conPocaConfianzaNoDiceNada() {
        assertNull(SensorDeMovimiento.codigo(listOf(DetectedActivity.IN_VEHICLE to 30)))
        assertNull(SensorDeMovimiento.codigo(listOf(DetectedActivity.TILTING to 100)))
    }
}
