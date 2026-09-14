import { describe, it, expect } from 'vitest'
import { puntoEnKm, resuelveSitio } from '../functions/lib/fotosEvento'
import { cercaDe } from '../src/lib/fotoSitio'

/** Un trazado de dos km hacia el norte: [lat, lon, km]. */
const linea: [number, number, number][] = [[42, -0.5, 0], [42.01, -0.5, 1], [42.02, -0.5, 2]]

describe('puntoEnKm', () => {
  it('interpola entre los puntos del trazado', () => {
    const p = puntoEnKm(linea, 1.5)!
    expect(p[0]).toBeCloseTo(42.015, 6)
    expect(p[1]).toBeCloseTo(-0.5, 6)
  })
  it('fuera del recorrido, se queda en sus extremos', () => {
    expect(puntoEnKm(linea, -3)).toEqual([42, -0.5])
    expect(puntoEnKm(linea, 9)).toEqual([42.02, -0.5])
  })
})

describe('resuelveSitio', () => {
  it('con coordenadas, las de la propia foto', () => {
    expect(resuelveSitio({ lat: 42.7, lon: -0.36 }, null)).toEqual({ lat: 42.7, lon: -0.36, km: null, posicion: 'foto' })
  })

  it('con un km, el punto del recorrido en ese km', () => {
    const s = resuelveSitio({ km: 1.5 }, linea)
    expect(s).not.toBe('bad')
    if (s === 'bad') return
    expect(s.posicion).toBe('recorrido')
    expect(s.km).toBe(1.5)
    expect(s.lat!).toBeCloseTo(42.015, 6)
  })

  it('un km más allá de la meta se queda en la meta', () => {
    const s = resuelveSitio({ km: 50 }, linea)
    expect(s !== 'bad' && s.km).toBe(2)
  })

  it('sin nada, sin sitio: la foto no sale en el mapa', () => {
    expect(resuelveSitio({}, null)).toEqual({ lat: null, lon: null, km: null, posicion: null })
  })

  it('media coordenada, un km negativo o un km sin recorrido no valen', () => {
    expect(resuelveSitio({ lat: 42 }, null)).toBe('bad')
    expect(resuelveSitio({ lat: 95, lon: 0 }, null)).toBe('bad')
    expect(resuelveSitio({ km: -1 }, linea)).toBe('bad')
    expect(resuelveSitio({ km: 1 }, null)).toBe('bad')
  })
})

describe('cercaDe', () => {
  const puntos = [{ name: 'Formigal', km: 49.9 }, { name: 'Meta', km: 99.5 }, { name: 'Sin km', km: null }]
  it('el punto con nombre más cercano, si está a mano', () => {
    expect(cercaDe(49.2, puntos)).toEqual({ name: 'Formigal', km: 49.9 })
  })
  it('lejos de todos, nada', () => {
    expect(cercaDe(70, puntos)).toBeNull()
  })
})
