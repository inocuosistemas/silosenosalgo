import { describe, it, expect } from 'vitest'
import { sugiereTipo, tipoDe, paradaDe } from '../src/lib/avituallamientos'

describe('qué es cada punto', () => {
  it('Matxicots 26: lo sugiere bien por la descripción', () => {
    expect(sugiereTipo({ name: 'SOR', desc: 'Sort (CPA) · Líquido' })).toBe('liquido')
    expect(sugiereTipo({ name: 'PUJ', desc: 'Pujalt (CPA) · Líquido + sólido' })).toBe('completo')
    expect(sugiereTipo({ name: 'ESP1730', desc: 'Espot (CPA) · Completo' })).toBe('completo')
    expect(sugiereTipo({ name: 'RIA2230', desc: 'Rialp (CP) · Completo / Meta' })).toBe('meta')
  })

  it('otras formas de escribirlo', () => {
    expect(sugiereTipo({ name: 'Refugio', desc: 'Bolsa de vida' })).toBe('bolsa')
    expect(sugiereTipo({ name: 'Km 12', desc: 'agua' })).toBe('liquido')
    expect(sugiereTipo({ name: 'CP3', sym: 'Water Source' })).toBe('liquido')
    expect(sugiereTipo({ name: 'Collado', desc: 'control de paso' })).toBe('control')
    expect(sugiereTipo({ name: 'Avituallamiento 2' })).toBe('completo')
  })

  it('lo DEFINIDO manda sobre lo que diga el texto', () => {
    expect(tipoDe({ name: 'PUJ', desc: 'Líquido + sólido', aid: 'liquido' })).toBe('liquido')
    expect(paradaDe({ name: 'PUJ', desc: 'Líquido + sólido', aid: 'liquido' })).toBe(1)
    expect(paradaDe({ name: 'ESP', desc: 'Completo', pauseMin: 8 })).toBe(8)
  })

  it('el último punto, en el final del recorrido, es la meta', () => {
    expect(tipoDe({ name: 'Rialp', distanceKm: 57.7 }, 57.72)).toBe('meta')
  })
})
