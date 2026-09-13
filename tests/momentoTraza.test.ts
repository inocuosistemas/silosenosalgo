import { describe, it, expect } from 'vitest'
import { momentoEnLaTraza } from '../functions/lib/eventStats'

const M = 60_000
/** Una traza proyectada: [hora, km del recorrido, …]. Llega al 49,83 y se vuelve. */
const serie: [number, number, number][] = [
  [0, 0, 0], [60 * M, 10, 0], [120 * M, 20, 0], [180 * M, 49.83, 0], [240 * M, 45, 0],
]
const masLejos = 180 * M

describe('momentoEnLaTraza', () => {
  it('con un sitio que alcanzó, la primera vez que llegó ahí', () => {
    expect(momentoEnLaTraza(serie, masLejos, 20)).toBe(120 * M)
  })

  it('con un sitio al que la traza se queda corta —el GPS a metros del control—, cuando llegó más lejos y no nunca', () => {
    // JM en Formigal: señalado en el km 49,85 y su traza se quedó en el 49,83.
    expect(momentoEnLaTraza(serie, masLejos, 49.85)).toBe(masLejos)
  })

  it('sin sitio, cuando llegó más lejos: la vuelta atrás ya no es la carrera', () => {
    expect(momentoEnLaTraza(serie, masLejos, null)).toBe(masLejos)
  })
})
