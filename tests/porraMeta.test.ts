import { describe, it, expect } from 'vitest'
import { resultadosDeCarrera } from '../src/lib/eventOutcomes'
import { scoreBets } from '../shared/bets'
import type { EventBet } from '../shared/wireTypes'

/**
 * La hora de meta que puntúa la porra.
 *
 * La porra reparte puntos por acercarse al tiempo, así que TODO depende de una
 * sola cifra: a qué hora cruzó. Y esa cifra se equivocaba de la peor manera
 * posible —no fallaba, se movía—: era la hora del último aviso de la baliza, y
 * quien cruza la meta y no apaga el móvil sigue emitiendo desde el bar. Su
 * llegada avanzaba con el reloj, los pronósticos se alejaban solos y los puntos
 * de todos se derretían hasta empatar en cero. Pasó en el Desafío Urbión.
 */

const SALIDA = Date.UTC(2026, 8, 5, 6, 30)          // 08:30 en punto
const min = (n: number) => SALIDA + n * 60_000
const META = min(435)                                // cruzó a las 7h 15m

const fila = (extra: Partial<Parameters<typeof resultadosDeCarrera>[0][0]> = {}) => ({
  username: 'Soriano', emitiendo: true, acabo: true, metaEn: META, retirado: false, ...extra,
})

/** Alguien que dice que Soriano tarda `tarda` minutos. */
const pronostico = (author: string, tarda: number): EventBet =>
  ({ author, target: 'Soriano', kind: 'finish_time', value: String(min(tarda)), createdAt: 1 })

describe('la hora de meta que puntúa la porra', () => {
  it('es la de la llegada, aunque la baliza siga emitiendo horas después', () => {
    const o = resultadosDeCarrera([fila()])[0]
    expect(o.finished).toBe(true)
    expect(o.finishedAt).toBe(META)
  })

  it('gana el que más se acerca, y no se empata solo con el tiempo', () => {
    const bets = [
      pronostico('lejos', 393),   // 6h 33m — falla por 42
      pronostico('cerca', 450),   // 7h 30m — falla por 15
    ]
    const tabla = scoreBets(bets, resultadosDeCarrera([fila()]), SALIDA)
    expect(tabla[0].author).toBe('cerca')
    expect(tabla[0].points).toBeGreaterThan(tabla[1].points)
  })

  it('quien se retira tiene la carrera decidida, pero sin hora que comparar', () => {
    const o = resultadosDeCarrera([fila({ acabo: false, metaEn: null, retirado: true })])[0]
    expect(o.settled).toBe(true)
    expect(o.finishedAt).toBe(null)
    const [s] = scoreBets([pronostico('alguien', 450)], [o], SALIDA)
    expect(s.points).toBe(0)
    expect(s.bets[0].state).toBe('ko')
  })

  it('una baliza que nunca emitió no decide nada: el pronóstico sigue vivo', () => {
    const o = resultadosDeCarrera([fila({ emitiendo: false, acabo: false, metaEn: null })])[0]
    expect(o.settled).toBe(false)
    const [s] = scoreBets([pronostico('alguien', 450)], [o], SALIDA)
    expect(s.bets[0].state).toBe('pending')
  })
})
