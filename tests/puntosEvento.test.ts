import { describe, it, expect } from 'vitest'
import { puntosDelEvento, rutaDelEvento, sitioEnKm, kmMasCerca } from '../src/lib/puntosEvento'
import { cutoffWptKey } from '../src/lib/cutoffInference'

/** 10 km hacia el norte, un punto cada 100 m, subiendo 10 m cada 100 m. */
function ruta() {
  const points = Array.from({ length: 101 }, (_, i) => ({ lat: 42 + i * 0.0009, lon: 1, ele: 1000 + i * 10 }))
  const cumKm = points.map((_, i) => i / 10)
  const wp = (km: number, name: string) => ({
    ...points[km * 10], name, distanceKm: km, nearestTrackIndex: km * 10,
  })
  return {
    track: { points, cumKm, namedWaypoints: [wp(3, 'Coll'), wp(7, 'Pueblo')] },
    cutoffWallClocks: { [cutoffWptKey(points[70].lat, points[70].lon)]: { hour: 12, minute: 0 } },
  }
}

describe('los puntos del evento', () => {
  it('sin ajustes, la ruta tal cual', () => {
    const r = ruta()
    expect(rutaDelEvento(r, null)).toBe(r)
  })

  it('un punto añadido aparece en su km, en orden, en su sitio del recorrido', () => {
    const { puntos } = puntosDelEvento(ruta().track, { nabcd1: { nuevo: true, nombre: 'Control', km: 5.05, aid: 'control' } })
    expect(puntos.map((p) => p.name)).toEqual(['Coll', 'Control', 'Pueblo'])
    const c = puntos[1]
    expect(c.nuevo).toBe(true)
    expect(c.ele).toBeCloseTo(1505, 0)
    expect(c.lat).toBeCloseTo(42 + 50.5 * 0.0009, 6)
  })

  it('mover un punto con corte se lleva su hora de corte', () => {
    const r = ruta()
    const movida = rutaDelEvento(r, { '7.00': { km: 7.5 } })
    const pueblo = movida.track.namedWaypoints.find((w) => w.name === 'Pueblo')!
    expect(pueblo.distanceKm).toBe(7.5)
    const clave = cutoffWptKey(pueblo.lat, pueblo.lon)
    expect(movida.cutoffWallClocks[clave]).toEqual({ hour: 12, minute: 0 })
    expect(Object.keys(movida.cutoffWallClocks)).toHaveLength(1)
  })

  it('el tipo y la parada se aplican sin mover el punto', () => {
    const { puntos } = puntosDelEvento(ruta().track, { '3.00': { aid: 'bolsa', pausa: 15 } })
    expect(puntos[0]).toMatchObject({ name: 'Coll', distanceKm: 3, aid: 'bolsa', pauseMin: 15 })
    expect(puntos[0].kmRuta).toBeUndefined()
  })

  it('del mapa al km: el punto del recorrido más cerca', () => {
    const r = ruta().track
    const s = sitioEnKm(r, 4.2)!
    expect(kmMasCerca(r, s.lat, s.lon + 0.0001)!.km).toBeCloseTo(4.2, 5)
  })
})
