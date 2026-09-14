import { describe, it, expect } from 'vitest'
import { agrupaFotos } from '../src/lib/agrupaFotos'

describe('agrupaFotos', () => {
  it('las que se pisan en pantalla van juntas; las demás, solas', () => {
    const puntos = [{ indice: 0, x: 0, y: 0 }, { indice: 1, x: 10, y: 12 }, { indice: 2, x: 200, y: 0 }]
    expect(agrupaFotos(puntos, 34)).toEqual([[0, 1], [2]])
  })

  it('manda la primera de cada grupo: no se encadenan', () => {
    const puntos = [{ indice: 0, x: 0, y: 0 }, { indice: 1, x: 30, y: 0 }, { indice: 2, x: 60, y: 0 }]
    expect(agrupaFotos(puntos, 34)).toEqual([[0, 1], [2]])
  })

  it('conserva el orden: el primer índice de cada grupo es la foto más temprana', () => {
    const puntos = [{ indice: 3, x: 0, y: 0 }, { indice: 5, x: 100, y: 0 }, { indice: 7, x: 5, y: 5 }]
    expect(agrupaFotos(puntos, 34)).toEqual([[3, 7], [5]])
  })

  it('sin fotos, sin grupos', () => {
    expect(agrupaFotos([], 34)).toEqual([])
  })
})
