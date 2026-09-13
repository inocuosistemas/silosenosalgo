import { describe, it, expect } from 'vitest'
import { losDeLaCarrera } from '../src/lib/encuadre'

/**
 * Con quién se encuadra el mapa de una carrera.
 *
 * En la CanFranc-CanFranc una baliza siguió emitiendo desde la autovía, a 173
 * km del recorrido, y el mapa se abría con medio Aragón en pantalla y el
 * circuito del tamaño de un sello en una esquina. Mientras el recorrido no
 * llega —son cientos de kilobytes— lo único que se puede mirar es si un punto
 * está con los demás o en otro sitio.
 */

const CANFRANC: [number, number] = [42.752, -0.514]
const VILLANUA: [number, number] = [42.690, -0.530]
const FORMIGAL: [number, number] = [42.779, -0.413]
const MANRESA: [number, number] = [41.656, 1.102]

describe('a quién se mira para encuadrar', () => {
  it('la baliza que sigue emitiendo desde la autovía se queda fuera', () => {
    const dentro = losDeLaCarrera([CANFRANC, VILLANUA, FORMIGAL, MANRESA])
    expect(dentro).toHaveLength(3)
    expect(dentro).not.toContainEqual(MANRESA)
  })

  it('una carrera larga con la gente repartida no se recorta a sí misma', () => {
    // Cuarenta kilómetros de separación entre el primero y el último es una
    // ultra normal, no un corredor perdido: no se descarta a nadie.
    const repartidos: [number, number][] = [
      [42.75, -0.51], [42.85, -0.45], [42.95, -0.40], [43.05, -0.35],
    ]
    expect(losDeLaCarrera(repartidos)).toHaveLength(4)
  })

  it('con dos puntos no se descarta nada: no hay mayoría que consultar', () => {
    // Uno de los dos está lejísimos, pero ¿cuál? Sin un tercero que desempate,
    // quitar uno es elegir a cara o cruz.
    expect(losDeLaCarrera([CANFRANC, MANRESA])).toHaveLength(2)
  })

  it('si al filtrar no queda nadie, se devuelven todos', () => {
    // Un encuadre raro es mejor que un mapa sin encuadrar.
    expect(losDeLaCarrera([])).toHaveLength(0)
  })
})
