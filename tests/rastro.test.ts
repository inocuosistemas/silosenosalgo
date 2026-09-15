import { describe, expect, it } from 'vitest'
import { LLEGADA_TARDIA_MS, puntoDelRastro } from '../functions/lib/rastro'

describe('puntoDelRastro', () => {
  const ahora = Date.UTC(2026, 9, 3, 9, 0)
  const fix = (t: number, accuracy: number | null = 8.4) => ({ t, lat: 42.7, lon: -0.5, accuracy })

  it('un punto que llega a tiempo no guarda la hora de llegada', () => {
    expect(puntoDelRastro(fix(ahora - 5_000), ahora)).toEqual({ t: ahora - 5_000, lat: 42.7, lon: -0.5, a: 8 })
  })

  it('un punto que llega tarde guarda cuándo llegó', () => {
    const p = puntoDelRastro(fix(ahora - 25 * 60_000), ahora)
    expect(p.r).toBe(ahora)
    expect(p.t).toBe(ahora - 25 * 60_000)
  })

  it('el umbral es de un minuto justo', () => {
    expect(puntoDelRastro(fix(ahora - LLEGADA_TARDIA_MS + 1), ahora).r).toBeUndefined()
    expect(puntoDelRastro(fix(ahora - LLEGADA_TARDIA_MS), ahora).r).toBe(ahora)
  })

  it('sin precisión no inventa una', () => {
    expect(puntoDelRastro(fix(ahora, null), ahora)).toEqual({ t: ahora, lat: 42.7, lon: -0.5 })
  })
})
