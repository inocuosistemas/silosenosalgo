import { describe, it, expect } from 'vitest'
import { rellenaPoligono, trazaLinea } from '../src/lib/maquetaMascara'
import { MASCARA_AGUA, MASCARA_RIO } from '../shared/maquetaPaquete'

const pinta = (m: Uint8Array, cols: number, filas: number) =>
  Array.from({ length: filas }, (_, j) => Array.from({ length: cols }, (_, i) => (m[j * cols + i] ? '#' : '.')).join(''))

describe('rellenaPoligono', () => {
  it('un cuadrado de tres nodos de lado marca tres por tres (semiabierto abajo y a la derecha)', () => {
    const m = new Uint8Array(6 * 6)
    rellenaPoligono(m, 6, 6, [[[1, 1], [4, 1], [4, 4], [1, 4]]], MASCARA_AGUA)
    expect(pinta(m, 6, 6)).toEqual([
      '......',
      '.###..',
      '.###..',
      '.###..',
      '......',
      '......',
    ])
  })

  it('un agujero se queda fuera (par-impar), sin mirar el sentido de los anillos', () => {
    const m = new Uint8Array(7 * 7)
    rellenaPoligono(m, 7, 7, [
      [[0, 0], [6, 0], [6, 6], [0, 6]],
      [[2, 2], [2, 4], [4, 4], [4, 2]],
    ], MASCARA_AGUA)
    expect(pinta(m, 7, 7)).toEqual([
      '######.',
      '######.',
      '##..##.',
      '##..##.',
      '######.',
      '######.',
      '.......',
    ])
  })

  it('lo que cae fuera de la rejilla se recorta y no revienta', () => {
    const m = new Uint8Array(3 * 3)
    rellenaPoligono(m, 3, 3, [[[-5, -5], [10, -5], [10, 1.5], [-5, 1.5]]], MASCARA_AGUA)
    expect(pinta(m, 3, 3)).toEqual(['###', '###', '...'])
    expect(() => rellenaPoligono(m, 3, 3, [], MASCARA_AGUA)).not.toThrow()
  })
})

describe('trazaLinea', () => {
  it('pasa por los nodos de una diagonal, de un nodo de grueso', () => {
    const m = new Uint8Array(4 * 4)
    trazaLinea(m, 4, 4, [[0, 0], [3, 3]], MASCARA_RIO)
    expect(pinta(m, 4, 4)).toEqual(['#...', '.#..', '..#.', '...#'])
  })

  it('un tramo que sale de la rejilla no escribe fuera', () => {
    const m = new Uint8Array(2 * 2)
    trazaLinea(m, 2, 2, [[-3, 0], [5, 0]], MASCARA_RIO)
    expect(pinta(m, 2, 2)).toEqual(['##', '..'])
  })
})
