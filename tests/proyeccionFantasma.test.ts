import { describe, it, expect } from 'vitest'
import { proyeccionFantasma, SILENCIO_MIN_MS, type EntradaFantasma } from '../src/lib/proyeccionFantasma'
import type { PlannedCurve } from '../src/lib/ghostPacer'

/**
 * La proyección de quien se queda sin cobertura.
 *
 * Lo que hay que asegurar no es que acierte —no puede—, sino que se CALLE
 * cuando no tiene nada honesto que decir. Cada prueba de aquí es un caso en el
 * que dibujar un fantasma sería mentir.
 */

/** Un recorrido de 40 km con una subida en medio, en minutos de plan. */
const curva: PlannedCurve = (() => {
  const kms: number[] = [], mins: number[] = []
  for (let i = 0; i <= 40; i++) {
    kms.push(i)
    // 6 min/km en llano; entre el 20 y el 30 cuesta el doble.
    mins.push(i <= 20 ? i * 6 : i <= 30 ? 120 + (i - 20) * 12 : 240 + (i - 30) * 6)
  }
  return { kms, mins }
})()

const base: EntradaFantasma = {
  kmUltimo: 10,
  silencioMs: 10 * 60_000,
  totalKm: 40,
  estabaParado: false,
  resuelto: false,
  curva,
  transcurridoMs: 60 * 60_000,   // 60 min para 10 km = va exactamente en plan
  velocidadKmH: 10,
}

describe('la proyección de quien no da señal', () => {
  it('avanza por el recorrido a su ritmo', () => {
    const f = proyeccionFantasma(base)!
    expect(f.desdeKm).toBe(10)
    // Diez minutos en llano a 6 min/km: km 11,7 aproximadamente.
    expect(f.hastaKm).toBeGreaterThan(11)
    expect(f.hastaKm).toBeLessThan(12.5)
  })

  it('sabe de terreno: el mismo silencio avanza menos en la subida', () => {
    const llano = proyeccionFantasma(base)!
    const cuesta = proyeccionFantasma({ ...base, kmUltimo: 22, transcurridoMs: 144 * 60_000 })!
    expect(cuesta.hastaKm - cuesta.desdeKm).toBeLessThan(llano.hastaKm - llano.desdeKm)
  })

  it('va más deprisa quien lleva la carrera más deprisa que el plan', () => {
    const enPlan = proyeccionFantasma(base)!
    const rapido = proyeccionFantasma({ ...base, transcurridoMs: 30 * 60_000 })!
    expect(rapido.hastaKm).toBeGreaterThan(enPlan.hastaKm)
  })

  // ── Y ahora, cuándo se calla ────────────────────────────────────────────

  it('se para en la meta y no la pasa', () => {
    const f = proyeccionFantasma({ ...base, kmUltimo: 39.5, transcurridoMs: 297 * 60_000 })!
    expect(f.hastaKm).toBe(40)
    expect(f.enMeta).toBe(true)
  })

  it('no dice nada si sus últimas lecturas ya decían que estaba parado', () => {
    // El avituallamiento del km 30 del Desafío Urbión: tres lecturas en el
    // mismo sitio y después silencio. Proyectar ahí lo mandaba medio kilómetro
    // monte arriba mientras se bebía un vaso de agua.
    expect(proyeccionFantasma({ ...base, estabaParado: true })).toBe(null)
  })

  it('calla antes de los tres minutos, que es el pulso normal de la baliza', () => {
    expect(proyeccionFantasma({ ...base, silencioMs: SILENCIO_MIN_MS - 1 })).toBe(null)
  })

  it('calla pasada la media hora: ahí ya habla el modelo, no el corredor', () => {
    expect(proyeccionFantasma({ ...base, silencioMs: 31 * 60_000 })).toBe(null)
  })

  it('no proyecta a quien ya cruzó ni a quien cerró la baliza', () => {
    expect(proyeccionFantasma({ ...base, resuelto: true })).toBe(null)
  })

  it('sin curva tira de la velocidad reciente, y sin ninguna de las dos se calla', () => {
    const plano = proyeccionFantasma({ ...base, curva: null })!
    expect(plano.hastaKm).toBeCloseTo(10 + 10 * (10 / 60), 2)
    expect(proyeccionFantasma({ ...base, curva: null, velocidadKmH: null })).toBe(null)
  })

  it('sin kilómetro conocido no hay nada que proyectar', () => {
    expect(proyeccionFantasma({ ...base, kmUltimo: null })).toBe(null)
  })
})
