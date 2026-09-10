import { describe, it, expect } from 'vitest'
import { computeMarginChoices } from '../src/lib/cutoffStrategy'
import type { GpxTrack } from '../src/lib/gpx'
import type { EnrichedNamedWaypoint } from '../src/lib/places'
import type { PaceConfig } from '../src/lib/timing'

/**
 * Elegir el ritmo por el margen que se quiere en cada corte.
 *
 * Es la pregunta al revés de la de siempre: no «con este ritmo, ¿llego?», sino
 * «para llegar con media hora de sobra a cada corte, ¿a qué ritmo tengo que
 * ir?». Sirve para EMPEZAR, y por eso lo que se prueba aquí sobre todo es que
 * la respuesta no dependa del ritmo que lleves puesto — que es justo lo que no
 * se sabe cuando se abre el planificador.
 */

/** Una pista llana de `km` kilómetros, un punto por kilómetro. */
function pistaLlana(km: number): GpxTrack {
  const points = []
  const cumKm = []
  for (let i = 0; i <= km; i++) {
    points.push({ lat: 42 + i * 0.009, lon: -0.5, ele: 1000, time: null })
    cumKm.push(i)
  }
  return {
    name: 'llana', points, cumKm, totalDistanceKm: km,
    elevGainM: 0, elevLossM: 0, namedWaypoints: [],
  }
}

const salida = new Date(2026, 8, 12, 8, 0, 0, 0)

/** Un corte en el km `km` a las `hora` en punto del día de la salida. */
function corte(nombre: string, km: number, hora: number, minuto = 0): EnrichedNamedWaypoint {
  const cutoffTime = new Date(salida)
  cutoffTime.setHours(hora, minuto, 0, 0)
  return {
    lat: 42 + km * 0.009, lon: -0.5, ele: 1000, name: nombre,
    distanceKm: km, nearestTrackIndex: Math.round(km),
    estimatedTime: null, weather: null, cutoffTime,
  }
}

const aPie = (ritmoBase: number): PaceConfig => ({
  mode: 'fixed',
  paceMinPerKm: ritmoBase,
  naismithMin100mUp: 10,
  smartDescent: 'balanced',
  smartFatigue: 'medium',
  activity: 'run',
})

// 30 km, corte en el 10 a las 10:00 (2 h) y meta en el 30 a las 14:00 (6 h).
// El primer tramo pide 12 min/km y el segundo 12 min/km: van igualados, así que
// media hora de margen los mueve a los dos y el primero, más corto, es el que
// más lo acusa.
const pista = pistaLlana(30)
const cortes = [corte('Villanúa', 10, 10), corte('Meta', 30, 14)]

describe('el ritmo que pide cada margen', () => {
  it('cuanto más margen pides, más rápido hay que ir', () => {
    const [justo, media, hora] = computeMarginChoices([0, 30, 60], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(7),
    })
    expect(justo.requiredPaceMinPerKm).toBeCloseTo(12, 2)      // 120 min / 10 km
    expect(media.requiredPaceMinPerKm).toBeCloseTo(9, 2)       //  90 min / 10 km
    expect(hora.requiredPaceMinPerKm).toBeCloseTo(6, 2)        //  60 min / 10 km
  })

  it('no depende del ritmo que lleves puesto, que es lo que no sabes', () => {
    const lento = computeMarginChoices([30], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(11),
    })
    const rápido = computeMarginChoices([30], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(4),
    })
    expect(lento[0].requiredPaceMinPerKm).toBeCloseTo(rápido[0].requiredPaceMinPerKm!, 6)
  })

  it('dice qué corte manda, que es el que fija el ritmo de todo el recorrido', () => {
    const [r] = computeMarginChoices([30], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(7),
    })
    // El tramo hasta Villanúa pierde media hora de sus 120 min; el de Villanúa
    // a Meta pierde media hora de 240 y le sobra sitio. Manda el primero.
    expect(r.bottleneckLabel).toBe('Villanúa')
    expect(r.bottleneckKm).toBe(10)
  })

  it('un margen que no da se dice, y se dice a cuántos cortes no llegas', () => {
    // 120 min para 10 km es un margen máximo de 120 min menos lo que tardes.
    // Pedir 2 h de colchón deja el primer tramo en cero minutos.
    const [r] = computeMarginChoices([120], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(7),
    })
    expect(r.requiredPaceMinPerKm).toBeNull()
    expect(r.unreachableCount).toBe(1)
  })

  it('las paradas previstas se pagan en ritmo', () => {
    const sinParada = computeMarginChoices([0], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(7),
    })
    const conParada = computeMarginChoices([0], {
      track: pista, namedWaypoints: cortes, startTime: salida, paceConfig: aPie(7),
      pauses: [{ km: 5, minutes: 20 }],
    })
    // Veinte minutos parado en el km 5 dejan 100 min de movimiento para 10 km.
    expect(sinParada[0].requiredPaceMinPerKm).toBeCloseTo(12, 2)
    expect(conParada[0].requiredPaceMinPerKm).toBeCloseTo(10, 2)
  })
})
