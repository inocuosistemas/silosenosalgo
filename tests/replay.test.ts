import { describe, it, expect } from 'vitest'
import { finDelReplay, recortaTraza } from '../functions/lib/replay'
import type { EventStats, TrailPoint } from '../shared/wireTypes'

const H = 60 * 60_000

/** Unos resultados con solo lo que mira el cierre: quién llegó y quién lo dejó, y cuándo. */
function resultados(corredores: { finishedAt?: number | null; abandonoAt?: number | null }[]): EventStats {
  return {
    corredores: corredores.map((c, i) => ({
      username: `c${i}`, finishedAt: c.finishedAt ?? null, abandonoAt: c.abandonoAt ?? null,
    })),
  } as unknown as EventStats
}

function traza(...horas: number[]): TrailPoint[] {
  return horas.map((h, i) => ({ t: h * H, lat: 42.7 + i * 0.001, lon: -0.52 }))
}

describe('finDelReplay', () => {
  const cierreDelEvento = 20.5 * H

  it('termina con la llegada del último', () => {
    expect(finDelReplay(resultados([{ finishedAt: 15 * H }, { finishedAt: 16.5 * H }, { abandonoAt: 17 * H }]), cierreDelEvento))
      .toBe(16.5 * H)
  })

  it('si no llegó nadie, con el último abandono y no con la hora en que se cerró el evento', () => {
    // La CanFranc: nadie a meta, el último lo dejó a las 17:16 y el evento se
    // cerró a las 20:31 con las balizas aún emitiendo desde el coche.
    expect(finDelReplay(resultados([{ abandonoAt: 11 * H }, { abandonoAt: 17.27 * H }, {}]), cierreDelEvento))
      .toBe(17.27 * H)
  })

  it('sin nada que derivar, la hora del cierre del evento; sin cierre, ninguna', () => {
    expect(finDelReplay(resultados([{}, {}]), cierreDelEvento)).toBe(cierreDelEvento)
    expect(finDelReplay(null, cierreDelEvento)).toBe(cierreDelEvento)
    expect(finDelReplay(null, null)).toBeNull()
  })
})

describe('recortaTraza', () => {
  it('deja fuera lo posterior al abandono: el coche de vuelta no es la carrera', () => {
    const pts = traza(9, 10, 11, 12, 13)
    expect(recortaTraza(pts, 11 * H).map((p) => p.t)).toEqual([9 * H, 10 * H, 11 * H])
  })

  it('sin límite, entera', () => {
    const pts = traza(9, 10)
    expect(recortaTraza(pts, null)).toBe(pts)
    expect(recortaTraza(pts, undefined)).toBe(pts)
  })

  it('si al cortar no quedan dos puntos, entera: mejor que sobre a que desaparezca', () => {
    const pts = traza(9, 10, 11)
    expect(recortaTraza(pts, 9.5 * H)).toBe(pts)
  })
})
