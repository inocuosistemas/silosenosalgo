import { describe, expect, it } from 'vitest'
import { corredoresCerca, type CorredorEnCarrera } from '../functions/lib/corredoresCerca'

// Quién va cerca, para la tarjeta de la pantalla de bloqueo: la posición
// propia, los de alrededor y el primero.

const c = (userId: string, km: number | null, extra: Partial<CorredorEnCarrera> = {}): CorredorEnCarrera => ({
  userId, nombre: userId, emoji: '🦊', km, retirado: false, ...extra,
})

const parrilla = [
  c('lider', 31.2),
  c('lejos', 27),
  c('delante', 22.4),
  c('yo', 21.3),
  c('detras', 21.0),
  c('muyDetras', 12),
  c('sinEmpezar', null),
  c('retirado', 25, { retirado: true }),
]

describe('corredores cerca', () => {
  it('la posición se cuenta por km, sin los que no han empezado ni los retirados', () => {
    const r = corredoresCerca(parrilla, 'yo', 21.3, 1)
    expect(r.posicion).toBe(4)
    expect(r.total).toBe(6)
  })

  it('van el primero y los de alrededor, no los de lejos', () => {
    const r = corredoresCerca(parrilla, 'yo', 21.3, 1)
    const nombres = r.corredores.map((x) => x.nombre)
    expect(nombres[0]).toBe('lider')
    expect(r.corredores[0].lider).toBe(true)
    expect(nombres).toContain('delante')
    expect(nombres).toContain('detras')
    expect(nombres).not.toContain('lejos')       // a 5,7 km
    expect(nombres).not.toContain('muyDetras')
    expect(nombres).not.toContain('retirado')
    expect(nombres).not.toContain('yo')
  })

  it('el km propio que manda la app gana al guardado, que puede ir atrasado', () => {
    const r = corredoresCerca(parrilla, 'yo', 23, 1)
    expect(r.posicion).toBe(3)
  })

  it('sin km de la app, se usa el guardado', () => {
    expect(corredoresCerca(parrilla, 'yo', null, 1).posicion).toBe(4)
  })

  it('si el primero soy yo, no sale como otro', () => {
    const r = corredoresCerca(parrilla, 'yo', 40, 1)
    expect(r.posicion).toBe(1)
    expect(r.corredores.some((x) => x.lider)).toBe(false)
  })

  it('como mucho seis alrededor, los más cercanos', () => {
    const muchos = [c('yo', 10), ...Array.from({ length: 12 }, (_, i) => c(`c${i}`, 10 + (i - 6) * 0.3))]
    const r = corredoresCerca(muchos, 'yo', 10, 1)
    expect(r.corredores.filter((x) => !x.lider).length).toBe(6)
  })

  it('sin emoji, uno de corredor', () => {
    const r = corredoresCerca([c('yo', 5), c('otro', 5.5, { emoji: null })], 'yo', 5, 1)
    expect(r.corredores.find((x) => x.nombre === 'otro')?.emoji).toBe('🏃')
  })
})
