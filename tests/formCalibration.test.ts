import { describe, it, expect } from 'vitest'
import { detectForm } from '../src/lib/formCalibration'
import type { GpxTrack } from '../src/lib/gpx'
import type { PaceConfig } from '../src/lib/timing'

/** Una pista llana de `km` kilómetros, un punto por kilómetro. */
function pistaLlana(km: number): GpxTrack {
  const points = []
  const cumKm = []
  for (let i = 0; i <= km; i++) {
    points.push({ lat: 42 + i * 0.009, lon: -0.5, ele: 1000, time: null })
    cumKm.push(i)
  }
  return { name: 'llana', points, cumKm, totalDistanceKm: km, elevGainM: 0, elevLossM: 0, namedWaypoints: [] }
}

const ritmo: PaceConfig = {
  mode: 'fixed', paceMinPerKm: 10, naismithMin100mUp: 10,
  smartDescent: 'balanced', smartFatigue: 'medium', activity: 'run',
}
const T0 = Date.UTC(2026, 8, 19, 4)

/** A ritmo constante: un punto cada dos minutos, del km 0 al `hasta`. */
function corriendo(minKm: number, hasta: number) {
  const out: { km: number; t: number }[] = []
  for (let m = 0; m / minKm <= hasta; m += 2) out.push({ km: m / minKm, t: T0 + m * 60_000 })
  return out
}

describe('el estado de forma', () => {
  it('un punto colocado en la meta de un circuito no lo tuerce', () => {
    // Matxicots 26: el primer punto, en la salida de un circuito, cayó en el
    // km final. Con él salía "−50% vs plan" y "fatiga +1922%".
    const pista = pistaLlana(30)
    const limpio = detectForm(pista, corriendo(10, 12), ritmo)!
    const conMeta = detectForm(pista, [{ km: 30, t: T0 - 5 * 60_000 }, ...corriendo(10, 12)], ritmo)!
    expect(conMeta.overall).toBeCloseTo(limpio.overall, 5)
    expect(conMeta.fatigue ?? 0).toBeCloseTo(limpio.fatigue ?? 0, 5)
    expect(Math.abs(conMeta.fatigue ?? 0)).toBeLessThan(0.2)
  })

  it('cambiar de terreno no es fatiga', () => {
    // Llano los primeros 10 km y subida los 10 siguientes. Va mucho más rápido
    // que el plan en llano y justo en subida, SIEMPRE igual: no se apaga.
    const pista = pistaLlana(20)
    pista.points.forEach((p, i) => { if (i > 10) p.ele = 1000 + (i - 10) * 100 })
    const plan = (desde: number, hasta: number) => {
      let m = 0
      for (let k = desde; k < hasta; k++) m += k < 10 ? 10 : 10 + 6
      return m
    }
    const out: { km: number; t: number }[] = []
    let t = T0
    for (let km = 0; km <= 20; km++) {
      out.push({ km, t })
      // Llano a la mitad del plan; subida exactamente al plan.
      t += (km < 10 ? plan(km, km + 1) / 2 : plan(km, km + 1)) * 60_000
    }
    const f = detectForm(pista, out, { ...ritmo, naismithMin100mUp: 6 })!
    expect(Math.abs(f.fatigue ?? 0)).toBeLessThan(0.15)
  })
})
