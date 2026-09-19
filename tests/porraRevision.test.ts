import { describe, it, expect } from 'vitest'
import { scoreBets, pendientesDeOficial, REVISION, type RunnerOutcome } from '../shared/bets'
import type { EventBet } from '../shared/wireTypes'

const T = Date.UTC(2026, 8, 19, 17, 17, 0)
const valen = (o: Partial<RunnerOutcome> = {}): RunnerOutcome => ({ username: 'Valen', tracked: true, finished: true, finishedAt: T, settled: true, manual: true, margenMs: 60_000, ...o })
const soriano = (o: Partial<RunnerOutcome> = {}): RunnerOutcome => ({ username: 'Soriano', tracked: true, finished: true, finishedAt: T + 2_000, settled: true, margenMs: 17_000, ...o })
const apuesta = { author: 'markis', target: 'Valen', kind: 'order', value: '1', createdAt: 1 } as unknown as EventBet

describe('llegadas pegadas: la porra espera a los tiempos oficiales', () => {
  it('sin tiempos oficiales, el puesto queda pendiente de revisión', () => {
    expect(pendientesDeOficial([valen(), soriano()])).toEqual(new Set(['Valen', 'Soriano']))
    const [s] = scoreBets([apuesta], [valen(), soriano()], T - 13 * 3600_000)
    expect(s.bets[0]).toMatchObject({ state: 'pending', note: REVISION })
  })

  it('con los oficiales puestos, manda la organización', () => {
    const o = [valen({ finishedAt: T + 7_000, oficial: true, margenMs: 0 }), soriano({ finishedAt: T + 4_000, oficial: true, margenMs: 0 })]
    expect(pendientesDeOficial(o).size).toBe(0)
    const [s] = scoreBets([apuesta], o, T - 13 * 3600_000)
    expect(s.bets[0]).toMatchObject({ state: 'ok', note: 'llegó 2º' })
  })

  it('llegadas separadas de sobra no esperan a nadie', () => {
    expect(pendientesDeOficial([valen(), soriano({ finishedAt: T + 10 * 60_000 })]).size).toBe(0)
  })
})
