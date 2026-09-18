import { describe, expect, it } from 'vitest'
import { buildSharePayload, reviveSharePayload } from '../src/lib/sharePayload'
import { DEFAULT_SAMPLING, type PaceConfig } from '../src/lib/timing'
import type { GpxTrack } from '../src/lib/gpx'

// La marca que decide si la baliza se arma: una ruta guardada con la hora de
// relleno del planificador NO es una salida programada.

const track: GpxTrack = {
  name: 'Prueba',
  points: [
    { lat: 42.7, lon: -0.52, ele: 1200, time: null },
    { lat: 42.71, lon: -0.51, ele: 1250, time: null },
  ],
  totalDistanceKm: 1.2,
  elevGainM: 50,
  elevLossM: 0,
  namedWaypoints: [],
  cumKm: [0, 1.2],
}

const base = {
  track,
  startTime: new Date('2026-09-20T08:00:00Z'),
  paceConfig: { mode: 'fixed' } as unknown as PaceConfig,
  sampling: DEFAULT_SAMPLING,
  cutoffWallClocks: new Map(),
}

const idaYVuelta = (p: object) => reviveSharePayload(JSON.parse(JSON.stringify(p)))

describe('hora de salida elegida o de relleno', () => {
  it('la de relleno viaja marcada como no elegida', () => {
    const p = buildSharePayload({ ...base, startTimeChosen: false })
    expect(p.startTimeChosen).toBe(false)
    expect(idaYVuelta(p).startTimeChosen).toBe(false)
  })

  it('la elegida viaja como elegida', () => {
    expect(idaYVuelta(buildSharePayload({ ...base, startTimeChosen: true })).startTimeChosen).toBe(true)
  })

  it('una ruta guardada antes de la marca se da por elegida: no se sabe, y así no cambia nada', () => {
    const p = buildSharePayload(base)
    delete (p as { startTimeChosen?: boolean }).startTimeChosen
    expect(idaYVuelta(p).startTimeChosen).toBe(true)
  })

  it('la hora sigue viajando aunque no sea elegida: el pronóstico la necesita', () => {
    const p = buildSharePayload({ ...base, startTimeChosen: false })
    expect(idaYVuelta(p).startTime.toISOString()).toBe('2026-09-20T08:00:00.000Z')
  })
})
