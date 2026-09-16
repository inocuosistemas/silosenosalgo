import { describe, it, expect } from 'vitest'
import {
  CORREDORES_CARRERITA, MINUTOS_POR_SEGUNDO, VUELTA_S,
  avanceEn, finDeCarrera, instanteDe, preparaCarril, puntoDelCarril, repartoCarrerita,
} from '../src/lib/carrerita'

describe('repartoCarrerita', () => {
  it('siempre reparte igual: la misma maqueta enseña la misma carrerita', () => {
    expect(repartoCarrerita()).toEqual(repartoCarrerita())
  })

  it('todos avanzan y todos salen después de darse la salida', () => {
    for (const c of reparteDePrueba()) {
      expect(c.velocidad).toBeGreaterThan(0)
      expect(c.salidaS).toBeGreaterThanOrEqual(0)
    }
  })

  it('el primero es el más rápido y la cola sale más tarde', () => {
    const gente = reparteDePrueba()
    expect(gente[0].velocidad).toBeGreaterThan(gente[gente.length - 1].velocidad)
    expect(gente[0].salidaS).toBeLessThan(gente[gente.length - 1].salidaS)
  })

  it('por defecto corren los que dice la constante', () => {
    expect(repartoCarrerita()).toHaveLength(CORREDORES_CARRERITA)
  })
})

describe('avanceEn', () => {
  const uno = { velocidad: 1, salidaS: 2 }

  it('antes de su salida se queda en la línea', () => {
    expect(avanceEn(uno, 0)).toBe(0)
    expect(avanceEn(uno, 1.9)).toBe(0)
  })

  it('a media vuelta va por la mitad del recorrido', () => {
    expect(avanceEn(uno, 2 + VUELTA_S / 2)).toBeCloseTo(0.5)
  })

  it('al llegar a la meta se queda en ella: no vuelve a empezar', () => {
    expect(avanceEn(uno, 2 + VUELTA_S)).toBe(1)
    expect(avanceEn(uno, 2 + VUELTA_S * 1.25)).toBe(1)
    expect(avanceEn(uno, 2 + VUELTA_S * 10)).toBe(1)
  })

  it('el que va más lento lleva menos recorrido en el mismo instante', () => {
    const lento = { velocidad: 0.5, salidaS: 2 }
    expect(avanceEn(lento, 2 + VUELTA_S / 2)).toBeLessThan(avanceEn(uno, 2 + VUELTA_S / 2))
  })

  it('se van estirando: la distancia entre el primero y el último crece', () => {
    const gente = reparteDePrueba()
    const hueco = (s: number) => avanceEn(gente[0], s) - avanceEn(gente[gente.length - 1], s)
    expect(hueco(VUELTA_S * 0.4)).toBeGreaterThan(hueco(VUELTA_S * 0.1))
  })
})

describe('finDeCarrera', () => {
  it('es cuando cruza la meta el último, no el primero', () => {
    const gente = reparteDePrueba()
    const fin = finDeCarrera(gente)
    for (const c of gente) expect(avanceEn(c, fin)).toBe(1)
  })

  it('un poco antes todavía queda alguien corriendo', () => {
    const gente = reparteDePrueba()
    const fin = finDeCarrera(gente)
    expect(gente.some((c) => avanceEn(c, fin - 1) < 1)).toBe(true)
  })
})

describe('preparaCarril', () => {
  it('sin dos puntos no hay carril', () => {
    expect(preparaCarril([])).toBeNull()
    expect(preparaCarril([[0, 0, 0]])).toBeNull()
  })

  it('un recorrido que no se mueve tampoco es carril', () => {
    expect(preparaCarril([[1, 0, 1], [1, 0, 1]])).toBeNull()
  })

  it('mide en planta: la altura no alarga el recorrido', () => {
    const llano = preparaCarril([[0, 0, 0], [3, 0, 4]])!
    const empinado = preparaCarril([[0, 0, 0], [3, 9, 4]])!
    expect(llano.largo).toBeCloseTo(5)
    expect(empinado.largo).toBeCloseTo(5)
  })
})

describe('puntoDelCarril', () => {
  const carril = preparaCarril([[0, 0, 0], [10, 2, 0], [10, 2, 10]])!

  it('en la salida y en la meta, los extremos', () => {
    const a = puntoDelCarril(carril, 0)
    expect([a.x, a.z]).toEqual([0, 0])
    const b = puntoDelCarril(carril, 1)
    expect([b.x, b.z]).toEqual([10, 10])
  })

  it('interpola por distancia, no por punto', () => {
    // El carril mide 20: la mitad cae justo al final del primer tramo.
    const medio = puntoDelCarril(carril, 0.5)
    expect(medio.x).toBeCloseTo(10)
    expect(medio.z).toBeCloseTo(0)
  })

  it('coge la altura del tramo por el que va', () => {
    expect(puntoDelCarril(carril, 0.25).y).toBeCloseTo(1)
  })

  it('el rumbo dice hacia dónde va', () => {
    // Primer tramo: hacia +X. Segundo: hacia +Z.
    expect(puntoDelCarril(carril, 0.25).rumbo).toBeCloseTo(Math.PI / 2)
    expect(puntoDelCarril(carril, 0.75).rumbo).toBeCloseTo(0)
  })

  it('un avance fuera de rango se queda en los extremos', () => {
    expect(puntoDelCarril(carril, -5).x).toBe(0)
    expect(puntoDelCarril(carril, 5).x).toBe(10)
  })
})

describe('instanteDe', () => {
  it('sin hora de salida no hay nada que simular', () => {
    expect(instanteDe(null, 30)).toBeNull()
  })

  it('arranca en la hora de salida', () => {
    const salida = Date.UTC(2026, 8, 16, 7, 0, 0)
    expect(instanteDe(salida, 0)!.getTime()).toBe(salida)
  })

  it('el reloj corre mucho más rápido que el de verdad', () => {
    const salida = Date.UTC(2026, 8, 16, 7, 0, 0)
    const pasado = instanteDe(salida, 60)!.getTime() - salida
    expect(pasado).toBe(60 * MINUTOS_POR_SEGUNDO * 60_000)
    expect(pasado).toBeGreaterThan(60_000)
  })
})

/** El reparto de siempre, que es con el que corre la maqueta. */
function reparteDePrueba() {
  return repartoCarrerita()
}
