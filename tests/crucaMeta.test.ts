import { describe, it, expect } from 'vitest'
import { crucaMeta } from '../shared/cruceMeta'

/**
 * El cronómetro de meta, con el caso real del Desafío Urbión.
 *
 * Su baliza se calló 97 segundos justo al cruzar. Repartir ese hueco a
 * velocidad constante da por hecho que siguió a su ritmo hasta la lectura
 * siguiente, y esa lectura era la de alguien ya parado en meta: los últimos
 * 36 metros le costaban minuto y medio. La alfombra oficial decía 15:44:22 y
 * nosotros 15:45:19.
 */

const T0 = 0
const s = (n: number) => T0 + n * 1000
/** Una lectura: [hora, km de recorrido, metros de suelo desde la anterior]. */
type L = [number, number, number]

describe('cruzar la meta con un silencio justo en la línea', () => {
  // Los últimos metros de verdad de aquella carrera, con el reloj a cero en su
  // penúltima lectura buena y la meta en el km 37.7.
  const finReal: L[] = [
    [s(0), 37.50, 0],
    [s(50), 37.58, 100],   // 2,0 m/s
    [s(60), 37.60, 14],
    [s(100), 37.664, 87],  // a 36 m de la línea, viniendo a 2,18 m/s
    [s(197), 37.70, 50],   // 97 s después, ya dentro y parado
  ]

  it('usa el ritmo que traía en vez de repartir el silencio', () => {
    const c = crucaMeta(finReal, 37.7, 0.5, false)!
    // A ~2 m/s, los 36 metros que le quedaban son unos 18 segundos.
    expect((c.ms - s(100)) / 1000).toBeGreaterThan(10)
    expect((c.ms - s(100)) / 1000).toBeLessThan(30)
  })

  it('y eso lo acerca a la alfombra en vez de alejarlo', () => {
    // La alfombra estuvo 13 s después de su última lectura buena.
    const alfombra = s(113)
    const c = crucaMeta(finReal, 37.7, 0.5, false)!
    expect(Math.abs(c.ms - alfombra) / 1000).toBeLessThan(20)
  })

  it('nunca coloca el cruce después de la lectura siguiente', () => {
    // Si venía arrastrándose, la cuenta se pasaría de largo: entonces no vale.
    const lento: L[] = [
      [s(0), 37.50, 0],
      [s(90), 37.55, 50],     // 0,55 m/s
      [s(100), 37.60, 5],
      [s(160), 37.70, 40],
    ]
    const c = crucaMeta(lento, 37.7, 0.5, false)!
    expect(c.ms).toBeLessThanOrEqual(s(160))
    expect(c.ms).toBeGreaterThan(s(100))
  })

  it('lejos de la línea no se estira nada', () => {
    // Su última lectura queda a 400 m: ahí caben una cuesta y un
    // avituallamiento, y el ritmo de hace un minuto ya no dice nada.
    const lejos: L[] = [
      [s(0), 36.90, 0],
      [s(50), 37.10, 200],
      [s(100), 37.30, 200],
      [s(400), 37.70, 400],
    ]
    const c = crucaMeta(lejos, 37.7, 0.5, false)!
    // El reparto de siempre: proporcional dentro del hueco.
    expect(c.ms).toBeGreaterThan(s(100))
    expect(c.ms).toBeLessThanOrEqual(s(400))
  })

  it('si ya venía parado tampoco: no hay ritmo que estirar', () => {
    const parado: L[] = [
      [s(0), 37.66, 0],
      [s(60), 37.66, 2],      // quieto en un avituallamiento
      [s(100), 37.664, 1],
      [s(200), 37.70, 40],
    ]
    const c = crucaMeta(parado, 37.7, 0.5, false)!
    expect(c.ms).toBeGreaterThan(s(100))
  })

  it('el margen sigue cubriendo el hueco entero', () => {
    const c = crucaMeta(finReal, 37.7, 0.5, false)!
    // Lo único cierto es que cruzó entre las dos lecturas: el margen tiene que
    // alcanzar el extremo más lejano de ese hueco.
    expect(c.ms - c.margenMs).toBeLessThanOrEqual(s(100) + 1)
    expect(c.ms + c.margenMs).toBeGreaterThanOrEqual(s(197) - 1)
  })

  it('quien no llega a la línea no tiene cruce', () => {
    const corto: L[] = [[s(0), 30, 0], [s(60), 31, 1000]]
    expect(crucaMeta(corto, 37.7, 0.5, false)).toBe(null)
  })
})
