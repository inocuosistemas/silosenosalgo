import { describe, it, expect } from 'vitest'
import { flechasDelSentido, extremosDelRecorrido } from '../src/lib/sentidoRecorrido'

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
  it('sale y llega al mismo sitio: una sola marca', () => {
    expect(extremosDelRecorrido([[42.7, -0.52], [42.8, -0.5], [42.7005, -0.5205]])).toEqual({ tipo: 'circular', punto: [42.7, -0.52] })
  })

  it('de un sitio a otro: salida y meta', () => {
    expect(extremosDelRecorrido([[42.7, -0.52], [42.75, -0.45]])).toEqual({ tipo: 'lineal', salida: [42.7, -0.52], meta: [42.75, -0.45] })
  })

  it('sin recorrido, nada', () => {
    expect(extremosDelRecorrido([[42.7, -0.52]])).toBeNull()
  })
})
