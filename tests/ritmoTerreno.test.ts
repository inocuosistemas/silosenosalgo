import { describe, it, expect } from 'vitest'
import { ajustaRitmo, costeRelativo, perfilDeEsfuerzo, prediceLlegada } from '../src/lib/ritmoTerreno'

/** 20 km: 10 llanos y luego 10 subiendo al 10 %. Un punto cada 100 m. */
function pista() {
  const points: { ele: number }[] = []
  const cumKm: number[] = []
  for (let i = 0; i <= 200; i++) {
    const km = i / 10
    cumKm.push(km)
    points.push({ ele: km <= 10 ? 1000 : 1000 + (km - 10) * 100 })
  }
  return { points, cumKm }
}

const SALIDA = Date.UTC(2026, 8, 19, 4)
const min = (m: number) => SALIDA + m * 60_000

describe('el ritmo según el terreno', () => {
  it('Tobler: la bajada suave es lo más rápido y subir cuesta más', () => {
    expect(costeRelativo(0)).toBeCloseTo(1, 5)
    expect(costeRelativo(-0.05)).toBeLessThan(1)
    expect(costeRelativo(0.15)).toBeGreaterThan(1.6)
    expect(costeRelativo(-0.25)).toBeGreaterThan(1)
  })

  it('lo que queda de SUBIDA cuesta más que lo mismo en llano, aunque el plan diga lo contrario', () => {
    const perfil = perfilDeEsfuerzo(pista())!
    // Ha hecho los 8 primeros km llanos a 6 min/km.
    const muestras = Array.from({ length: 17 }, (_, i) => ({ km: i * 0.5, t: min(i * 3) }))
    const ritmo = ajustaRitmo(perfil, muestras, SALIDA)!
    expect(ritmo).not.toBeNull()
    // Del 8 al 10 (llano) y del 10 al 12 (subiendo): la subida tarda más.
    const llano = prediceLlegada(perfil, ritmo, 8, min(48), 10, SALIDA)! - min(48)
    const hasta12 = prediceLlegada(perfil, ritmo, 8, min(48), 12, SALIDA)! - min(48)
    const subida = hasta12 - llano
    expect(subida).toBeGreaterThan(llano * 1.3)
  })

  it('sin datos suficientes no se ajusta: se queda la previsión de siempre', () => {
    const perfil = perfilDeEsfuerzo(pista())!
    expect(ajustaRitmo(perfil, [{ km: 0.5, t: min(3) }, { km: 1, t: min(6) }], SALIDA)).toBeNull()
  })

  it('la fatiga: el tiempo crece algo más deprisa que el esfuerzo', () => {
    const perfil = perfilDeEsfuerzo(pista())!
    const muestras = Array.from({ length: 17 }, (_, i) => ({ km: i * 0.5, t: min(i * 3) }))
    const ritmo = ajustaRitmo(perfil, muestras, SALIDA)!
    // Del 8 al 10, llano: más de los 12 min que saldrían sin fatiga.
    const t = (prediceLlegada(perfil, ritmo, 8, min(48), 10, SALIDA)! - min(48)) / 60_000
    expect(t).toBeGreaterThan(12)
    expect(t).toBeLessThan(18)
  })
})
