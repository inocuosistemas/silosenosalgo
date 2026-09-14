import { describe, it, expect } from 'vitest'
import { flechasDelSentido, extremosDelRecorrido, marcasDeExtremos } from '../src/lib/sentidoRecorrido'

describe('flechasDelSentido', () => {
  it('una cada paso, empezando a medio paso de la salida y sin pasar de medio paso de la meta', () => {
    const f = flechasDelSentido([{ x: 0, y: 0 }, { x: 400, y: 0 }], 100)
    expect(f.map((a) => a.x)).toEqual([50, 150, 250, 350])
    expect(new Set(f.map((a) => a.y))).toEqual(new Set([0]))
    expect(new Set(f.map((a) => Math.round(a.grados)))).toEqual(new Set([0]))
  })

  it('apunta hacia donde se va: abajo 90°, a la izquierda 180°, arriba -90°', () => {
    expect(flechasDelSentido([{ x: 0, y: 0 }, { x: 0, y: 300 }], 100)[0].grados).toBeCloseTo(90)
    expect(Math.abs(flechasDelSentido([{ x: 300, y: 0 }, { x: 0, y: 0 }], 100)[0].grados)).toBeCloseTo(180)
    expect(flechasDelSentido([{ x: 0, y: 300 }, { x: 0, y: 0 }], 100)[0].grados).toBeCloseTo(-90)
  })

  it('sigue las curvas: tras girar, las flechas giran', () => {
    const f = flechasDelSentido([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }], 100)
    expect(Math.round(f[0].grados)).toBe(0)
    expect(Math.round(f[f.length - 1].grados)).toBe(90)
  })

  it('un zigzag del GPS no le da la vuelta a la flecha', () => {
    // Va hacia el este, con un tramito de un píxel hacia atrás justo donde cae la flecha.
    const f = flechasDelSentido([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 49, y: 1 }, { x: 200, y: 0 }], 100)
    expect(Math.abs(f[0].grados)).toBeLessThan(20)
  })

  it('en un recorrido más corto que un paso, ninguna', () => {
    expect(flechasDelSentido([{ x: 0, y: 0 }, { x: 60, y: 0 }], 100)).toEqual([])
    expect(flechasDelSentido([{ x: 0, y: 0 }], 100)).toEqual([])
  })
})

describe('extremosDelRecorrido', () => {
  it('la salida, la meta y cuánto las separa', () => {
    const e = extremosDelRecorrido([[42.7, -0.52], [42.8, -0.5], [42.7005, -0.5205]])!
    expect(e.salida).toEqual([42.7, -0.52])
    expect(e.meta).toEqual([42.7005, -0.5205])
    expect(e.separadasM).toBeGreaterThan(60)
    expect(e.separadasM).toBeLessThan(75)
  })

  it('sin recorrido, nada', () => {
    expect(extremosDelRecorrido([[42.7, -0.52]])).toBeNull()
  })
})

describe('marcasDeExtremos', () => {
  const en = (x: number, y = 0) => ({ x, y })

  it('el mismo sitio de verdad: una marca, se mire como se mire', () => {
    expect(marcasDeExtremos(10, en(0), en(400))).toEqual({ juntas: true })
  })

  it('como UP26, a 150 m: de lejos se pisan y van juntas; de cerca, cada una la suya', () => {
    expect(marcasDeExtremos(150, en(0), en(12))).toEqual({ juntas: true })
    expect(marcasDeExtremos(150, en(0), en(300))).toEqual({ juntas: false, salida: 'derecha', meta: 'derecha' })
  })

  it('cerca en pantalla, los rótulos hacia fuera para que no se monten', () => {
    expect(marcasDeExtremos(150, en(0), en(80))).toEqual({ juntas: false, salida: 'izquierda', meta: 'derecha' })
    expect(marcasDeExtremos(150, en(80), en(0))).toEqual({ juntas: false, salida: 'derecha', meta: 'izquierda' })
  })

  it('dos pueblos a 5 km no se juntan aunque de lejos se pisen', () => {
    expect(marcasDeExtremos(5000, en(0), en(10)).juntas).toBe(false)
  })
})
