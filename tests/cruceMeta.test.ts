import { describe, it, expect } from 'vitest'
import { cruceEnTraza, toleranciaMeta } from '../src/lib/cruceMeta'

/**
 * Haber llegado no se deshace.
 *
 * El caso que hay que blindar es el de siempre: alguien cruza, no apaga la
 * baliza y se va al bar. Media hora después su posición no dice nada de la
 * meta, y hasta ahora eso bastaba para que la llegada desapareciera.
 */

/** Una traza: kilómetros por los que fue pasando, un punto por minuto. */
const traza = (kms: number[]) => kms.map((km, i) => ({ km, t: i * 60_000 }))

describe('el cruce de meta en una traza', () => {
  it('lo encuentra en el primer punto que pisa el final', () => {
    const c = cruceEnTraza(traza([0, 10, 20, 30, 37.7, 37.7]), 37.7)!
    expect(c.i).toBe(4)
    expect(c.t).toBe(4 * 60_000)
  })

  it('sigue encontrándolo aunque después se vaya lejos', () => {
    // Cruzó, siguió emitiendo desde el bar y su última posición ya no dice
    // nada del recorrido. Llegó igual.
    const c = cruceEnTraza(traza([0, 20, 37.7, 30, 12, 4]), 37.7)!
    expect(c.i).toBe(2)
  })

  it('no da por llegado a quien acaba de salir de un circuito', () => {
    // En un circuito la meta y la salida son el mismo sitio, así que la primera
    // posición de alguien parado en la línea se engancha igual de bien al final
    // del trazado. Sin haberle visto antes en la primera mitad, eso no es una
    // llegada: es alguien que todavía no ha echado a andar.
    expect(cruceEnTraza(traza([37.6, 37.7, 37.7]), 37.7)).toBe(null)
  })

  it('pero sí a quien salió del principio y llegó al final', () => {
    expect(cruceEnTraza(traza([0, 1, 37.6]), 37.7)).not.toBe(null)
  })

  it('no da por llegado a quien se quedó a las puertas', () => {
    // Con 37,7 km la tolerancia son 565 m: el km 36,5 no es meta.
    expect(cruceEnTraza(traza([0, 20, 36.5]), 37.7)).toBe(null)
  })

  it('perdona el último tramo, que el GPS no clava la línea', () => {
    expect(cruceEnTraza(traza([0, 20, 37.3]), 37.7)).not.toBe(null)
  })

  it('la tolerancia no se queda en nada ni se dispara', () => {
    expect(toleranciaMeta(5)).toBe(0.25)      // suelo: una ruta corta
    expect(toleranciaMeta(37.7)).toBeCloseTo(0.5655, 3)
    expect(toleranciaMeta(400)).toBe(1)       // techo: una ultra
  })

  it('sin recorrido ni traza no se inventa una llegada', () => {
    expect(cruceEnTraza(traza([0, 20, 40]), 0)).toBe(null)
    expect(cruceEnTraza([], 37.7)).toBe(null)
  })
})
