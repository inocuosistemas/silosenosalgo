import { describe, it, expect } from 'vitest'
import { kmEnPolilinea } from '../functions/lib/avisos'

describe('avisos de paso: por dónde va sobre el recorrido', () => {
  // Un recorrido recto hacia el norte, un vértice cada 100 m.
  const linea = Array.from({ length: 101 }, (_, i) => [42 + i * 0.0009, 1, i * 0.1] as [number, number, number])
  it('encima del recorrido, su km', () => {
    expect(kmEnPolilinea(linea, 42 + 50 * 0.0009, 1.0001, 4.8)).toBeCloseTo(5, 1)
  })
  it('lejos del recorrido (otro camino), no dice nada', () => {
    expect(kmEnPolilinea(linea, 42 + 50 * 0.0009, 1.01, 4.8)).toBeNull()
  })
  it('busca cerca de lo último conocido: no salta al otro extremo', () => {
    expect(kmEnPolilinea(linea, 42 + 95 * 0.0009, 1, 2)).toBeNull()
  })
})
