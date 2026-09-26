import { describe, expect, it } from 'vitest'
import { EXTRA_MAX_S, FOTO_S, MOVER_S, PAUSA_S, guionDeSalida, momentoDelGuion, posicionEn, rotuloDePausa, type FotoGuion } from '../src/lib/guionSalida'

const H = 3_600_000
const MIN = 60_000
const t0 = Date.UTC(2026, 8, 24, 13, 0)
const foto = (id: string, en: number): FotoGuion => ({ id, en, lat: 41, lon: 29, url: `/f/${id}` })

describe('rotuloDePausa', () => {
  it('con nombre siempre; sin nombre, solo si es larga', () => {
    expect(rotuloDePausa({ desde: 0, hasta: 45 * MIN, nombre: 'Cena', emoji: '🍽️' })).toBe('🍽️ Cena · 45 min')
    expect(rotuloDePausa({ desde: 0, hasta: 8 * MIN })).toBeNull()
    expect(rotuloDePausa({ desde: 0, hasta: 80 * MIN })).toBe('Parada · 1h 20m')
  })
})

describe('guionDeSalida', () => {
  it('sin pausas ni fotos: el movimiento entero en MOVER_S', () => {
    const g = guionDeSalida(t0, t0 + 2 * H, [], [])
    expect(g.segundos).toBeCloseTo(MOVER_S)
    expect(momentoDelGuion(g, MOVER_S / 2, t0).instante).toBeCloseTo(t0 + H)
  })

  it('el reloj salta las pausas: una hora parado no gasta vídeo, y la de nombre se rotula', () => {
    // 1 h andando, 1 h cenando, 1 h andando.
    const g = guionDeSalida(t0, t0 + 3 * H, [{ desde: t0 + H, hasta: t0 + 2 * H, nombre: 'Cena', emoji: '🍽️' }], [])
    expect(g.segundos).toBeCloseTo(MOVER_S + PAUSA_S)
    expect(g.pasos.map((p) => p.tipo)).toEqual(['mover', 'pausa', 'mover'])
    const enLaPausa = momentoDelGuion(g, MOVER_S / 2 + PAUSA_S / 2, t0)
    expect(enLaPausa.rotulo).toBe('🍽️ Cena · 1h 00m')
    expect(enLaPausa.instante).toBe(t0 + H)
    // Justo después, ya al otro lado de la cena.
    expect(momentoDelGuion(g, MOVER_S / 2 + PAUSA_S + 0.001, t0).instante).toBeGreaterThanOrEqual(t0 + 2 * H)
  })

  it('una pausa corta sin nombre se salta sin rótulo', () => {
    const g = guionDeSalida(t0, t0 + 2 * H, [{ desde: t0 + H, hasta: t0 + H + 10 * MIN }], [])
    expect(g.pasos.map((p) => p.tipo)).toEqual(['mover', 'mover'])
    expect(g.segundos).toBeCloseTo(MOVER_S)
  })

  it('cada foto para el reloj en su hora; una hecha durante la cena sale tras el rótulo', () => {
    const g = guionDeSalida(t0, t0 + 3 * H,
      [{ desde: t0 + H, hasta: t0 + 2 * H, nombre: 'Cena', emoji: '🍽️' }],
      [foto('a', t0 + 30 * MIN), foto('b', t0 + 90 * MIN)])
    expect(g.pasos.map((p) => p.tipo)).toEqual(['mover', 'foto', 'mover', 'pausa', 'foto', 'mover'])
    expect(g.segundos).toBeCloseTo(MOVER_S + PAUSA_S + 2 * FOTO_S)
    const m = momentoDelGuion(g, MOVER_S / 4 + FOTO_S / 2, t0)
    expect(m.foto?.foto.id).toBe('a')
    expect(m.foto?.fase).toBeCloseTo(0.5)
  })

  it('con muchas fotos elige unas cuantas repartidas y no pasa del tope', () => {
    const fotos = Array.from({ length: 139 }, (_, i) => foto(String(i), t0 + i * MIN))
    const g = guionDeSalida(t0, t0 + 3 * H, [], fotos)
    expect(g.fotos.length).toBe(Math.floor(EXTRA_MAX_S / FOTO_S))
    expect(g.fotos[0].id).toBe('0')
    expect(g.fotos.at(-1)!.id).toBe('138')
    expect(g.segundos).toBeLessThanOrEqual(MOVER_S + EXTRA_MAX_S + 1e-9)
  })

  it('las fotos de fuera de la salida no salen', () => {
    const g = guionDeSalida(t0, t0 + H, [], [foto('antes', t0 - MIN), foto('dentro', t0 + MIN)])
    expect(g.fotos.map((f) => f.id)).toEqual(['dentro'])
  })
})

describe('posicionEn', () => {
  it('interpola entre las dos lecturas más cercanas', () => {
    const trail = [{ t: 0, lat: 0, lon: 0 }, { t: 10, lat: 1, lon: 2 }]
    expect(posicionEn(trail, 5)).toEqual([0.5, 1])
    expect(posicionEn(trail, -3)).toEqual([0, 0])
    expect(posicionEn(trail, 99)).toEqual([1, 2])
  })
})
