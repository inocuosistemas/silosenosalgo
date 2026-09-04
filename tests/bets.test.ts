import { describe, it, expect } from 'vitest'
import { betMedal, puestosDePorra } from '../src/lib/bets'

/**
 * El podio de la porra.
 *
 * Con la carrera sin decidir todo el mundo va a cero, y la lista queda ordenada
 * POR NOMBRE — que es lo único que queda cuando no hay puntos ni aciertos que
 * comparar—. Repartir oro, plata y bronce ahí es anunciar un ganador que no
 * existe, y encima elegido por la primera letra de su apodo.
 */
describe('las medallas de la porra', () => {
  it('sin puntos no hay medalla, aunque se esté el primero de la lista', () => {
    expect(betMedal(0, 0)).toBe('·')
    expect(betMedal(1, 0)).toBe('·')
  })

  it('con puntos, bola de cristal, plata y bronce', () => {
    expect(betMedal(0, 30)).toBe('🔮')
    expect(betMedal(1, 20)).toBe('🥈')
    expect(betMedal(2, 10)).toBe('🥉')
    expect(betMedal(3, 5)).toBe('·')
  })

  it('los mismos puntos son el mismo puesto', () => {
    const ranking = [{ points: 40 }, { points: 40 }, { points: 10 }]
    expect(puestosDePorra(ranking)).toEqual([0, 0, 2])
    // Y por tanto la misma medalla: dos bolas de cristal y nada de plata.
    const medallas = puestosDePorra(ranking).map((p, i) => betMedal(p, ranking[i].points))
    expect(medallas).toEqual(['🔮', '🔮', '🥉'])
  })

  it('todos a cero es todos sin medalla, no un podio alfabético', () => {
    const ranking = [{ points: 0 }, { points: 0 }, { points: 0 }]
    const medallas = puestosDePorra(ranking).map((p, i) => betMedal(p, ranking[i].points))
    expect(medallas).toEqual(['·', '·', '·'])
  })
})
