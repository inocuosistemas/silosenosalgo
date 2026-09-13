import { describe, it, expect } from 'vitest'
import { losDeLaCarrera } from '../src/lib/encuadre'
import { reglaDelPerfil } from '../src/lib/perfilTramo'
import { ultimoControl } from '../src/components/EventResults'

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

/**
 * La regla del perfil de un tramo.
 *
 * Sin ella cada tramo se estira hasta llenar su caja, y una subida de 300 m
 * impacta igual que una de 1400: el dibujo es idéntico y solo cambia el número
 * de al lado. Con una escala común a toda la carrera, el de 300 ocupa un quinto
 * de lo que ocupa el de 1400, y las rayas dicen cuánto es eso en metros.
 */
describe('la regla del desnivel', () => {
  it('redondea hacia arriba a un número que se pueda leer', () => {
    // Una regla marcada cada 347 m no se lee.
    expect(reglaDelPerfil(1478)).toEqual({ escalaM: 1500, pasoM: 500 })
    expect(reglaDelPerfil(300)).toEqual({ escalaM: 300, pasoM: 100 })
    expect(reglaDelPerfil(90)).toEqual({ escalaM: 100, pasoM: 25 })
  })

  it('deja entre tres y cinco rayas, ni rejilla ni nada', () => {
    for (const rango of [80, 300, 740, 1478, 2600]) {
      const { escalaM, pasoM } = reglaDelPerfil(rango)
      expect(escalaM / pasoM).toBeGreaterThanOrEqual(2)
      expect(escalaM / pasoM).toBeLessThanOrEqual(5)
    }
  })

  it('la caja nunca es más pequeña que el tramo que tiene que caber', () => {
    for (const rango of [10, 137, 499, 1478, 3000]) {
      expect(reglaDelPerfil(rango).escalaM).toBeGreaterThanOrEqual(rango)
    }
  })

  it('una carrera llana no se dibuja como una montaña', () => {
    // Treinta metros de desnivel en todo el recorrido: la escala mínima es de
    // veinticinco, así que el dibujo ocupa lo que le toca y no se estira.
    expect(reglaDelPerfil(30).escalaM).toBe(50)
  })
})

/**
 * Dónde CONSTA que lo dejó, y hasta dónde llegó.
 *
 * Son dos formas distintas de decir lo mismo y las dos son verdad: la
 * organización solo puede acreditar lo que ha cronometrado —el último control
 * que pisó— y nosotros vemos por dónde iba de verdad. En la CanFranc, Soriano
 * consta en Canfranc Pueblo (km 16) y se paró en el km 22, seis más arriba.
 */
describe('el último control pasado', () => {
  const controles = [
    { nombre: 'Paso del Sarrio', km: 6.8 },
    { nombre: 'Canfranc Pueblo', km: 16.0 },
    { nombre: 'Collarada', km: 23.3 },
    { nombre: 'Ibón de Bucuesa', km: 27.2 },
  ]

  it('el último que queda por debajo de donde llegó', () => {
    expect(ultimoControl(21.96, controles)?.nombre).toBe('Canfranc Pueblo')
    expect(ultimoControl(18.85, controles)?.nombre).toBe('Canfranc Pueblo')
    expect(ultimoControl(27.2, controles)?.nombre).toBe('Ibón de Bucuesa')
  })

  it('pisar el control cuenta como pasarlo', () => {
    // Cincuenta metros de margen: el GPS no clava el arco y quedarse a treinta
    // metros de un control que sí te cronometró sería negarte el paso.
    expect(ultimoControl(16.03, controles)?.nombre).toBe('Canfranc Pueblo')
  })

  it('quien no llega al primero no consta en ninguno', () => {
    expect(ultimoControl(3.2, controles)).toBeNull()
  })

  it('sin kilómetro conocido no se acredita nada', () => {
    expect(ultimoControl(null, controles)).toBeNull()
  })

  it('el orden de la lista da igual: manda el kilómetro', () => {
    const desordenados = [...controles].reverse()
    expect(ultimoControl(21.96, desordenados)?.nombre).toBe('Canfranc Pueblo')
  })
})
