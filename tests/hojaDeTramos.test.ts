import { describe, expect, it } from 'vitest'
import { buildSharePayload } from '../src/lib/sharePayload'
import { gzipBytes } from '../src/lib/shareTransport'
import { hojaDeTramos } from '../src/lib/hojaDeTramos'
import { cutoffWptKey } from '../src/lib/cutoffInference'
import { DEFAULT_PACE, DEFAULT_SAMPLING } from '../src/lib/timing'
import type { GpxNamedWaypoint, GpxTrack } from '../src/lib/gpx'

// La hoja de tramos que se lleva la app al empezar la baliza: qué puntos
// cierran tramo, con qué corte (y de qué día), el perfil y el horario del plan.

// Una ruta recta de 20 km hacia el este, que sube 10 m por km.
const puntos = Array.from({ length: 201 }, (_, i) => ({
  lat: 42.5, lon: -0.5 + i * 0.0012198, ele: 1000 + i, time: null,
}))
const cumKm = puntos.map((_, i) => i * 0.1)
const wpt = (name: string, km: number, extra: Partial<GpxNamedWaypoint> = {}): GpxNamedWaypoint => {
  const i = Math.round(km * 10)
  return { name, lat: puntos[i].lat, lon: puntos[i].lon, ele: puntos[i].ele, distanceKm: km, nearestTrackIndex: i, ...extra }
}
const namedWaypoints = [
  wpt('Fuente', 3, { aid: 'liquido' }),
  wpt('Collado', 6, { aid: 'control' }),                 // control SIN corte: no cierra tramo
  wpt('Refugio', 10, { aid: 'solido' }),
  wpt('Paso', 14, { aid: 'control' }),                   // control CON corte: sí
]
const track: GpxTrack = {
  name: 'Prueba', points: puntos, cumKm, totalDistanceKm: 20,
  elevGainM: 200, elevLossM: 0, namedWaypoints,
}
const salida = new Date('2026-09-20T07:00:00Z')

async function hoja(opts: { ajustes?: object; salidaOficial?: number } = {}) {
  const cortes = new Map([[cutoffWptKey(namedWaypoints[3].lat, namedWaypoints[3].lon), { hour: 11, minute: 30 }]])
  const p = buildSharePayload({
    track, startTime: salida, paceConfig: DEFAULT_PACE, sampling: DEFAULT_SAMPLING, cutoffWallClocks: cortes,
  })
  const gz = new Uint8Array(await gzipBytes(JSON.stringify(p)))
  const b64 = btoa(String.fromCharCode(...gz))
  return hojaDeTramos(b64, opts.ajustes ? JSON.stringify(opts.ajustes) : null, opts.salidaOficial ?? null)
}

describe('hoja de tramos', () => {
  it('cierran tramo los avituallamientos y los puntos con corte; un control sin corte, no', async () => {
    const h = await hoja()
    expect(h.puntos.map((p) => p.nombre)).toEqual(['Fuente', 'Refugio', 'Paso', 'Meta'])
    expect(h.puntos.map((p) => p.tipo)).toEqual(['liquido', 'solido', 'control', 'meta'])
  })

  it('el corte lleva su fecha y hora de verdad', async () => {
    const h = await hoja()
    const paso = h.puntos.find((p) => p.nombre === 'Paso')!
    expect(paso.corte).toBeDefined()
    // Las 11:30 del mismo día de la salida (en hora local del que ejecuta).
    const d = new Date(paso.corte!)
    expect(d.getHours()).toBe(11)
    expect(d.getMinutes()).toBe(30)
    expect(paso.corte!).toBeGreaterThan(salida.getTime())
  })

  it('los ajustes de quien organiza mandan: un control sin corte hecho avituallamiento cierra tramo', async () => {
    const h = await hoja({ ajustes: { '6.00': { aid: 'completo' } } })
    expect(h.puntos.map((p) => p.nombre)).toEqual(['Fuente', 'Collado', 'Refugio', 'Paso', 'Meta'])
  })

  it('el perfil y el horario cubren la ruta entera, y el horario solo avanza', async () => {
    const h = await hoja()
    expect(h.perfil[0].km).toBe(0)
    expect(h.perfil.at(-1)!.km).toBeCloseTo(20, 3)
    expect(h.perfil.at(-1)!.ele).toBeCloseTo(1200, -1)
    expect(h.previsto[0].min).toBe(0)
    for (let i = 1; i < h.previsto.length; i++) expect(h.previsto[i].min).toBeGreaterThanOrEqual(h.previsto[i - 1].min)
  })

  it('se mide desde la salida oficial si se da', async () => {
    const oficial = salida.getTime() + 30 * 60_000
    expect((await hoja({ salidaOficial: oficial })).salida).toBe(oficial)
    expect((await hoja()).salida).toBe(salida.getTime())
  })
})
