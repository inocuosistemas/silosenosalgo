import { describe, it, expect } from 'vitest'
import { margenDeTiempo, scoreBets } from '../src/lib/bets'
import type { EventBet } from '../shared/wireTypes'
import type { RunnerOutcome } from '../src/lib/bets'

/**
 * El margen del tiempo, proporcional a lo que dura la carrera.
 *
 * Se restaban 2 puntos por minuto de error, así que a los 20 minutos ya no
 * quedaba nada — en todas las carreras por igual. Eso son el 4,6% de una
 * prueba de siete horas y el 0,85% de una de treinta y nueve: en la segunda,
 * acertar "por minutos" no es difícil, es imposible.
 */

describe('cuánto error se perdona', () => {
  it('crece con la carrera: un veinteavo de lo que dura', () => {
    expect(margenDeTiempo(8 * 60).tolerancia).toBe(24)      // Urbión, límite 8 h
    expect(margenDeTiempo(39 * 60).tolerancia).toBe(117)    // CanFranc, límite 39 h
  })

  it('la clavada, la décima parte de ese margen', () => {
    expect(margenDeTiempo(39 * 60).clavada).toBeCloseTo(11.7, 1)
  })

  it('con suelo, que en una carrera corta el porcentaje se queda en nada', () => {
    // Un 10K con una hora de límite: el medio por ciento serían 18 segundos.
    expect(margenDeTiempo(60).clavada).toBe(2)
    expect(margenDeTiempo(60).tolerancia).toBe(10)
  })

  it('sin referencia, el suelo', () => {
    expect(margenDeTiempo(null)).toEqual({ tolerancia: 10, clavada: 2 })
  })
})

describe('lo que cambia en la mesa', () => {
  const SALIDA = Date.UTC(2026, 8, 5, 6, 30)
  const min = (n: number) => SALIDA + n * 60_000
  const acabo = (m: number): RunnerOutcome[] =>
    [{ username: 'S', tracked: true, finished: true, finishedAt: min(m), settled: true }]
  const apuesta = (author: string, m: number): EventBet =>
    ({ author, target: 'S', kind: 'finish_time', value: String(min(m)), createdAt: 1 })

  it('en una ultra, fallar por media hora ya no es un cero', () => {
    // 39 h de límite: media hora de error sobre dos días de carrera es acertar.
    const [s] = scoreBets([apuesta('a', 1400)], acabo(1370), SALIDA, 39 * 60)
    expect(s.points).toBeGreaterThan(0)
  })

  it('pero en una carrera corta, media hora sigue siendo un cero', () => {
    const [s] = scoreBets([apuesta('a', 200)], acabo(170), SALIDA, 3 * 60)
    expect(s.points).toBe(0)
  })

  it('quien más se acerca sigue puntuando más', () => {
    const t = scoreBets([apuesta('lejos', 1500), apuesta('cerca', 1380)], acabo(1370), SALIDA, 39 * 60)
    expect(t[0].author).toBe('cerca')
    expect(t[0].points).toBeGreaterThan(t[1].points)
  })

  it('clavarlo son 40 y la prima, dure lo que dure la carrera', () => {
    const [corta] = scoreBets([apuesta('a', 170)], acabo(170), SALIDA, 3 * 60)
    const [larga] = scoreBets([apuesta('a', 1370)], acabo(1370), SALIDA, 39 * 60)
    expect(corta.points).toBe(55)
    expect(larga.points).toBe(55)
  })
})
