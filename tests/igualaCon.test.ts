import { describe, it, expect } from 'vitest'
import { referenciaDe } from '../src/lib/igualaCon'
import type { EventLiveRunner } from '../shared/wireTypes'

/** Un circuito de 10 km: 5 hacia el norte y 5 de vuelta por un camino paralelo a 100 m. */
function circuito() {
  const points: { lat: number; lon: number }[] = []
  const cumKm: number[] = []
  for (let i = 0; i <= 50; i++) { points.push({ lat: 42 + i * 0.0009, lon: 1 }); cumKm.push(i / 10) }
  for (let i = 1; i <= 50; i++) { points.push({ lat: 42 + (50 - i) * 0.0009, lon: 1.0012 }); cumKm.push(5 + i / 10) }
  return { points, cumKm }
}

const corredor = (tail: { t: number; lat: number; lon: number; a?: number | null }[], fix: Partial<EventLiveRunner['fix']> | null = null) =>
  ({ username: 'Soriano', tail, fix }) as unknown as EventLiveRunner

describe('igualar con quien lleva baliza', () => {
  it('coge el último fijo PRECISO, no el último', () => {
    const r = corredor([
      { t: 1000, lat: 42 + 20 * 0.0009, lon: 1, a: 8 },
      { t: 2000, lat: 42 + 22 * 0.0009, lon: 1, a: 90 },
    ])
    const ref = referenciaDe(r, circuito(), 0)
    expect(typeof ref).toBe('object')
    expect(ref).toMatchObject({ km: 2, at: 1000, precision: 8 })
  })

  it('en un circuito, lo desempata el último paso anotado: la vuelta, no la ida', () => {
    // Cerca de la salida, en el camino de vuelta (lon 1.0012 está a ~100 m del de ida).
    const r = corredor([{ t: 5000, lat: 42 + 2 * 0.0009, lon: 1.0012, a: 5 }])
    const ref = referenciaDe(r, circuito(), 8)
    expect(ref).toMatchObject({ km: 9.8 })
  })

  it('sin ningún fijo preciso, no se iguala', () => {
    const r = corredor([{ t: 1000, lat: 42, lon: 1, a: 80 }])
    expect(typeof referenciaDe(r, circuito(), 0)).toBe('string')
  })
})
