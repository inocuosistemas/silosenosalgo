import { describe, expect, it } from 'vitest'
import type { TrailPoint } from '../shared/wireTypes'
import { tramosDeTransporte, refinaVehiculos, muestrasDe, resumenDeTramo, aplicaAjustes, corrige, mueveCorte, margenDeCorte, totalesPorModo, type Entorno } from '../src/lib/tramosDeTransporte'

/** Un trazado hacia el norte, un punto cada 30 s, por trozos: [minutos, km/h, sensor]. */
function traza(trozos: [number, number, TrailPoint['m']?][]): TrailPoint[] {
  const out: TrailPoint[] = [{ t: 0, lat: 40, lon: 0 }]
  for (const [min, kmh, m] of trozos) {
    for (let k = 0; k < min * 2; k++) {
      const u = out[out.length - 1]
      const p: TrailPoint = { t: u.t + 30_000, lat: u.lat + (kmh * (30 / 3600)) / 111.2, lon: 0, a: 5 }
      if (m) p.m = m
      out.push(p)
    }
  }
  return out
}
const modos = (ts: Tramo[]) => ts.map((t) => t.modo)

describe('tramos de transporte', () => {
  it('con sensor: andando, coche (con un semáforo) y andando', () => {
    const ts = tramosDeTransporte(traza([[10, 5, 'w'], [15, 60, 'v'], [1, 0, 'v'], [15, 60, 'v'], [6, 5, 'w']]))
    expect(modos(ts)).toEqual(['pie', 'vehiculo', 'pie'])
    expect(ts[1].km).toBeCloseTo(30, 0)
  })

  it('sin sensor, por la velocidad de cada tramo entero', () => {
    expect(modos(tramosDeTransporte(traza([[10, 5], [30, 70], [8, 11]])))).toEqual(['pie', 'vehiculo', 'correr'])
  })

  it('andando despacio con la posición anclada (0 m, 0 m, 26 m…) es a pie, no parado ni corriendo', () => {
    // Cada 10 s: dos veces la misma posición y luego un salto de 26 m, que es
    // como graba la baliza cuando el paso no supera el ruido del GPS (≈3 km/h).
    const tr: TrailPoint[] = [{ t: 0, lat: 40, lon: 0, a: 14 }]
    for (let k = 1; k <= 180; k++) {
      const u = tr[tr.length - 1]
      tr.push({ t: u.t + 10_000, lat: u.lat + (k % 3 === 0 ? 0.026 / 111.2 : 0), lon: 0, a: 14 })
    }
    const ts = tramosDeTransporte(tr)
    expect(modos(ts)).toEqual(['pie'])
    expect(ts[0].km).toBeCloseTo(1.56, 1)
  })

  it('un titubeo de un minuto no es un cambio de medio', () => {
    expect(modos(tramosDeTransporte(traza([[10, 5, 'w'], [1, 30, 'v'], [10, 5, 'w']])))).toEqual(['pie'])
  })

  it('una parada larga se queda; una corta, no', () => {
    expect(modos(tramosDeTransporte(traza([[10, 5, 'w'], [12, 0, 'q'], [10, 5, 'w']])))).toEqual(['pie', 'parado', 'pie'])
    expect(modos(tramosDeTransporte(traza([[10, 5, 'w'], [3, 0, 'q'], [10, 5, 'w']])))).toEqual(['pie'])
  })

  it('a más de 250 km/h es avión, diga lo que diga el sensor', () => {
    expect(modos(tramosDeTransporte(traza([[10, 5, 'w'], [60, 780, 'v'], [10, 5, 'w']])))).toEqual(['pie', 'avion', 'pie'])
  })

  it('el sensor distingue la bici de un coche lento', () => {
    expect(modos(tramosDeTransporte(traza([[20, 22, 'b'], [20, 22, 'v']])))).toEqual(['bici', 'vehiculo'])
  })

  // El trazado va hacia el norte desde 40°: el mapa de mentira dice qué hay
  // por latitud (1 km ≈ 0,009°).
  const mapa = (zonas: [number, number, Partial<Entorno>][]) => (lat: number): Entorno => {
    const z = zonas.find(([a, b]) => lat >= a && lat < b)
    return { agua: false, via: false, ferry: false, ...(z?.[2] ?? {}) }
  }
  const km = (k: number) => 40 + k / 111.2

  it('el mapa decide coche, tren o barco, y un puente no es un barco', () => {
    // 10 min andando (0,8 km), 12 km en barco, 10 min andando, 15 km en coche con un puente de 1 km.
    const tr = traza([[10, 5, 'w'], [18, 40, 'v'], [10, 5, 'w'], [15, 60, 'v']])
    const ts = tramosDeTransporte(tr)
    expect(modos(ts)).toEqual(['pie', 'vehiculo', 'pie', 'vehiculo'])
    const m = mapa([[km(1.2), km(12.5), { agua: true }], [km(20), km(21), { agua: true }]])
    expect(modos(refinaVehiculos(tr, ts, (lat) => m(lat)))).toEqual(['pie', 'barco', 'pie', 'coche'])
  })

  it('del tren al coche sin bajarse a andar: el mapa lo parte', () => {
    // 20 min en vehículo: 10 km por la vía y 10 por carretera.
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w']])
    const ts = tramosDeTransporte(tr)
    const m = mapa([[km(0.5), km(11), { via: true }]])
    const r = refinaVehiculos(tr, ts, (lat) => m(lat))
    expect(modos(r)).toEqual(['pie', 'tren', 'coche', 'pie'])
    expect(r[1].km).toBeGreaterThan(8)
    expect(r[2].km).toBeGreaterThan(8)
    // Continuos: cada uno empieza donde acaba el anterior.
    for (let k = 1; k < r.length; k++) expect(r[k].i0).toBe(r[k - 1].i1)
  })

  it('por la vía y sobre el agua a la vez es tren (un puente, o el Marmaray bajo el Bósforo)', () => {
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w']])
    const m = mapa([[km(0.5), km(21), { via: true }], [km(5), km(10), { agua: true, via: true }]])
    expect(modos(refinaVehiculos(tr, tramosDeTransporte(tr), (lat) => m(lat)))).toEqual(['pie', 'tren', 'pie'])
  })

  it('sin sensor, un barco lento (13 km/h, «correr» por velocidad) se ve en el mapa', () => {
    const tr = traza([[10, 5], [60, 13], [10, 5]])
    const ts = tramosDeTransporte(tr)
    expect(modos(ts)).toEqual(['pie', 'correr', 'pie'])
    const agua = mapa([[km(0.9), km(14), { agua: true }]])
    expect(modos(refinaVehiculos(tr, ts, (lat) => agua(lat)))).toEqual(['pie', 'barco', 'pie'])
    // Por tierra, sigue siendo correr.
    expect(modos(refinaVehiculos(tr, ts, sinNada))).toEqual(['pie', 'correr', 'pie'])
  })

  it('con sensor, correr es correr aunque sea junto al agua', () => {
    const tr = traza([[10, 5, 'w'], [60, 13, 'r'], [10, 5, 'w']])
    const agua = mapa([[km(0.9), km(14), { agua: true }]])
    expect(modos(refinaVehiculos(tr, tramosDeTransporte(tr), (lat) => agua(lat)))).toEqual(['pie', 'correr', 'pie'])
  })

  it('sin el mapa de algún punto, se queda «en vehículo»', () => {
    const tr = traza([[10, 5, 'w'], [20, 60, 'v']])
    expect(modos(refinaVehiculos(tr, tramosDeTransporte(tr), () => undefined))).toEqual(['pie', 'vehiculo'])
  })

  it('las correcciones a mano mandan, y juntan lo que queda igual', () => {
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w'], [20, 60, 'v']])
    const ts = refinaVehiculos(tr, tramosDeTransporte(tr), () => ({ agua: false, via: false, ferry: false }))
    expect(modos(ts)).toEqual(['pie', 'coche', 'pie', 'coche'])
    // El primer coche era un tren.
    let aj = corrige([], ts[1], 'tren')
    expect(modos(aplicaAjustes(tr, ts, aj))).toEqual(['pie', 'tren', 'pie', 'coche'])
    expect(aplicaAjustes(tr, ts, aj)[1].corregido).toBe(true)
    // El paseo de en medio era también tren (no se bajó): un solo tren.
    aj = corrige(aj, ts[2], 'tren')
    const r = aplicaAjustes(tr, ts, aj)
    expect(modos(r)).toEqual(['pie', 'tren', 'coche'])
    expect(r[1].i0).toBe(ts[1].i0)
    expect(r[1].i1).toBe(ts[2].i1)
    // Volver a lo detectado.
    aj = corrige(aj, ts[1], null)
    expect(modos(aplicaAjustes(tr, ts, aj))).toEqual(['pie', 'coche', 'tren', 'coche'])
  })

  it('las muestras del mapa se reparten por distancia', () => {
    const tr = traza([[10, 5, 'w'], [30, 60, 'v']])
    const ts = tramosDeTransporte(tr)
    const m = muestrasDe(tr, ts[1])
    expect(m.length).toBeGreaterThan(50)   // 30 km, una cada 300 m
    expect(m.length).toBeLessThanOrEqual(121)
  })

  const sinNada = () => ({ agua: false, via: false, ferry: false })

  it('mover el corte entre dos tramos, hacia atrás y hacia delante', () => {
    // 10 min andando (puntos 0–20), 20 en coche (20–60), 10 andando.
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w']])
    const ts = refinaVehiculos(tr, tramosDeTransporte(tr), sinNada)
    expect(modos(ts)).toEqual(['pie', 'coche', 'pie'])
    expect(ts[0].i1).toBe(20)
    // Subió al coche dos minutos antes de lo detectado.
    const r = aplicaAjustes(tr, ts, mueveCorte([], ts[0], ts[1], tr[16].t))
    expect(modos(r)).toEqual(['pie', 'coche', 'pie'])
    expect([r[0].i1, r[1].i0, r[1].i1]).toEqual([16, 16, 60])
    // O más tarde.
    const r2 = aplicaAjustes(tr, ts, mueveCorte([], ts[0], ts[1], tr[26].t))
    expect([r2[0].i1, r2[1].i0]).toEqual([26, 26])
    // Fuera de los dos tramos, no cambia nada.
    expect(mueveCorte([], ts[0], ts[1], tr[70].t)).toEqual([])
    expect(margenDeCorte(ts, 0)).toEqual([1, 59])
    expect(margenDeCorte(ts, 2)).toBeNull()
  })

  it('corregir un trozo no tira lo corregido de alrededor', () => {
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w'], [20, 60, 'v']])
    const ts = refinaVehiculos(tr, tramosDeTransporte(tr), sinNada)
    // Todo del primer coche al segundo, en tren (una corrección grande)…
    let aj = corrige([], { ...ts[1], hasta: ts[3].hasta }, 'tren')
    expect(modos(aplicaAjustes(tr, ts, aj))).toEqual(['pie', 'tren'])
    // …y luego el paseo de en medio, que sí fue a pie: el tren sigue a los lados.
    aj = corrige(aj, ts[2], 'pie')
    expect(modos(aplicaAjustes(tr, ts, aj))).toEqual(['pie', 'tren', 'pie', 'tren'])
  })

  it('las pausas no se corrigen: una corrección encima no las tapa ni las crea', () => {
    // Paseo, 45 min de cena parados, paseo.
    const tr = traza([[20, 4, 'w'], [45, 0, 'q'], [20, 4, 'w']])
    const ts = tramosDeTransporte(tr)
    expect(modos(ts)).toEqual(['pie', 'parado', 'pie'])
    // «De principio a fin, a pie»: la cena sigue siendo pausa.
    const todo = { ...ts[0], hasta: ts[2].hasta }
    expect(modos(aplicaAjustes(tr, ts, corrige([], todo, 'coche')))).toEqual(['coche', 'parado', 'coche'])
    // Una corrección vieja a «parado» sobre el paseo no crea una pausa.
    expect(modos(aplicaAjustes(tr, ts, [{ desde: ts[0].desde, hasta: ts[0].hasta, modo: 'parado' }]))).toEqual(['pie', 'parado', 'pie'])
    // A la pausa no se le cambia el medio, ni se mueven sus extremos.
    expect(corrige([], ts[1], 'pie')).toEqual([])
    expect(mueveCorte([], ts[0], ts[1], tr[10].t)).toEqual([])
    expect(margenDeCorte(ts, 0)).toBeNull()
  })

  it('un tramo «en vehículo» (sin mapa aún) se fija como coche', () => {
    const tr = traza([[10, 5, 'w'], [20, 60, 'v'], [10, 5, 'w']])
    const ts = tramosDeTransporte(tr)
    expect(ts[1].modo).toBe('vehiculo')
    const aj = mueveCorte([], ts[0], ts[1], tr[16].t)
    expect(aj.map((a) => a.modo)).toEqual(['pie', 'coche'])
  })

  it('los totales por medio suman los tramos del mismo, del que más al que menos', () => {
    const tr = traza([[10, 5, 'w'], [30, 60, 'v'], [20, 5, 'w'], [12, 0, 'q'], [15, 60, 'v']])
    const ts = refinaVehiculos(tr, tramosDeTransporte(tr), () => ({ agua: false, via: false, ferry: false }))
    expect(modos(ts)).toEqual(['pie', 'coche', 'pie', 'parado', 'coche'])
    const tot = totalesPorModo(ts)
    expect(tot.map((x) => x.modo)).toEqual(['coche', 'pie', 'parado'])
    expect(tot[0].km).toBeCloseTo(45, 0)
    expect(tot[0].tramos).toBe(2)
    expect(tot[1].ms).toBe(30 * 60_000)
  })

  it('el resumen de un tramo', () => {
    const [t] = tramosDeTransporte(traza([[45, 4.3, 'w']]))
    expect(resumenDeTramo(t)).toBe('🚶 3,2 km · 45 min')
    const [c] = tramosDeTransporte(traza([[80, 90, 'v']]))
    expect(resumenDeTramo({ ...c, modo: 'tren' })).toBe('🚆 120 km · 1 h 20')
  })
})
