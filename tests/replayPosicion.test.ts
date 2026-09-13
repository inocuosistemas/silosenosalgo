import { describe, it, expect } from 'vitest'
import { preparaCorredor, estadoEn } from '../src/lib/replayPosicion'

const M = 60_000

/** Un recorrido recto hacia el norte, con un punto cada 0,1 km. */
const N = 201
const trazado = {
  pts: Array.from({ length: N }, (_, i) => [42 + i * 0.0009, -0.5] as [number, number]),
  cumKm: Array.from({ length: N }, (_, i) => i * 0.1),
}
const en = (i: number, t: number) => ({ t, lat: trazado.pts[i][0], lon: trazado.pts[i][1] })

// Emite seguido los primeros minutos, se queda media hora sin cobertura entre el
// km 1 y el 10, y vuelve a emitir.
const puntos = [en(0, 0), en(5, 2 * M), en(10, 4 * M), en(100, 34 * M), en(105, 36 * M)]
const corredor = preparaCorredor(puntos, trazado)

describe('estadoEn', () => {
  it('antes de su primera lectura no está', () => {
    expect(estadoEn(corredor, -M, trazado).pos).toBeNull()
  })

  it('entre dos lecturas seguidas va interpolado, y no es una estimación', () => {
    const e = estadoEn(corredor, 3 * M, trazado)
    expect(e.estimada).toBe(false)
    expect(e.pos![0]).toBeCloseTo(42 + 7.5 * 0.0009, 6)
  })

  it('en un hueco sin cobertura no desaparece: avanza por el recorrido, marcado como estimado', () => {
    // A mitad de un hueco de 30 min entre el km 1 y el 10: por el km 5,5.
    const e = estadoEn(corredor, 19 * M, trazado)
    expect(e.estimada).toBe(true)
    expect(e.terminado).toBe(false)
    expect(e.pos![0]).toBeCloseTo(42 + 55 * 0.0009, 6)
    expect(e.pos![1]).toBeCloseTo(-0.5, 6)
  })

  it('lo que no se vio se dibuja aparte, siguiendo el recorrido y no en línea recta', () => {
    const e = estadoEn(corredor, 19 * M, trazado)
    expect(e.tramos.map((x) => x.estimado)).toEqual([false, true])
    const supuesto = e.tramos[1].pts
    expect(supuesto.length).toBeGreaterThan(10)
    expect(supuesto[supuesto.length - 1][0]).toBeCloseTo(42 + 55 * 0.0009, 6)
    // Pasado el hueco, el tramo supuesto queda entero y le sigue lo que se vio.
    expect(estadoEn(corredor, 35 * M, trazado).tramos.map((x) => x.estimado)).toEqual([false, true, false])
  })

  it('después de su última lectura se queda donde acabó hasta el final', () => {
    const e = estadoEn(corredor, 5 * 60 * M, trazado)
    expect(e.terminado).toBe(true)
    expect(e.pos).toEqual(trazado.pts[105])
  })

  it('si el hueco no cae sobre el recorrido, se queda quieto en la última lectura, estimado', () => {
    const fuera = [en(0, 0), en(10, 4 * M), { t: 34 * M, lat: 42.05, lon: -0.44 }, { t: 36 * M, lat: 42.051, lon: -0.44 }]
    const e = estadoEn(preparaCorredor(fuera, trazado), 19 * M, trazado)
    expect(e.estimada).toBe(true)
    expect(e.pos).toEqual(trazado.pts[10])
  })

  it('sin recorrido, igual: quieto en la última lectura', () => {
    const e = estadoEn(preparaCorredor(puntos, null), 19 * M, null)
    expect(e.estimada).toBe(true)
    expect(e.pos).toEqual(trazado.pts[10])
  })

  it('quien vuelve hacia atrás en un hueco, retrocede por el recorrido', () => {
    const vuelta = [en(0, 0), en(80, 20 * M), en(40, 50 * M)]
    const e = estadoEn(preparaCorredor(vuelta, trazado), 35 * M, trazado)
    expect(e.estimada).toBe(true)
    expect(e.pos![0]).toBeCloseTo(42 + 60 * 0.0009, 6)
  })
})
