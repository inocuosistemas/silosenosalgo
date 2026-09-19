import { describe, it, expect } from 'vitest'
import { betMedal, puestosDePorra, scoreBets } from '../shared/bets'
import type { RunnerOutcome } from '../shared/bets'
import type { EventBet } from '../shared/wireTypes'

/**
 * El podio de la porra.
 *
 * Con la carrera sin decidir todo el mundo va a cero, y la lista queda ordenada
 * POR NOMBRE — que es lo único que queda cuando no hay puntos ni aciertos que
 * comparar—. Repartir oro, plata y bronce ahí es anunciar un ganador que no
 * existe, y encima elegido por la primera letra de su apodo.
 */
describe('las medallas de la porra', () => {
  it('sin puntos no hay medalla, aunque se esté el primero de la lista', () => {
    expect(betMedal(0, 0)).toBe('·')
    expect(betMedal(1, 0)).toBe('·')
  })

  it('con puntos, bola de cristal, plata y bronce', () => {
    expect(betMedal(0, 30)).toBe('🔮')
    expect(betMedal(1, 20)).toBe('🥈')
    expect(betMedal(2, 10)).toBe('🥉')
    expect(betMedal(3, 5)).toBe('·')
  })

  it('los mismos puntos son el mismo puesto', () => {
    const ranking = [{ points: 40 }, { points: 40 }, { points: 10 }]
    expect(puestosDePorra(ranking)).toEqual([0, 0, 2])
    // Y por tanto la misma medalla: dos bolas de cristal y nada de plata.
    const medallas = puestosDePorra(ranking).map((p, i) => betMedal(p, ranking[i].points))
    expect(medallas).toEqual(['🔮', '🔮', '🥉'])
  })

  it('todos a cero es todos sin medalla, no un podio alfabético', () => {
    const ranking = [{ points: 0 }, { points: 0 }, { points: 0 }]
    const medallas = puestosDePorra(ranking).map((p, i) => betMedal(p, ranking[i].points))
    expect(medallas).toEqual(['·', '·', '·'])
  })
})

/**
 * El orden de la lista de oráculos.
 *
 * Es una lista con dos vidas: durante la espera ordena por quién acaba de
 * mojarse, y cuando la carrera reparte puntos pasa a ser una clasificación. La
 * segunda no es cosmética —los puestos se reparten RECORRIENDO la lista—, así
 * que un orden por fecha con puntos ya repartidos no desordena un poco: corona
 * al que apostó el último y manda al que más puntos tiene al tercer puesto.
 * Pasó en una carrera de verdad y se veía en pantalla.
 */
describe('el orden de los oráculos', () => {
  const apuesta = (author: string, value: string, createdAt: number): EventBet =>
    ({ author, target: 'Soriano', kind: 'finish', value, createdAt })

  const acabo: RunnerOutcome[] = [
    { username: 'Soriano', tracked: true, finished: true, finishedAt: 5_000, settled: true },
  ]
  const enCarrera: RunnerOutcome[] = [
    { username: 'Soriano', tracked: true, finished: false, finishedAt: null, settled: false },
  ]

  it('sin puntos manda la hora: el último en apostar, arriba', () => {
    const orden = scoreBets([
      apuesta('primero', 'si', 1_000),
      apuesta('ultimo', 'si', 3_000),
      apuesta('enmedio', 'si', 2_000),
    ], enCarrera).map((s) => s.author)
    expect(orden).toEqual(['ultimo', 'enmedio', 'primero'])
  })

  it('con puntos manda el marcador, aunque haya apostado el primero', () => {
    const tabla = scoreBets([
      apuesta('tarde', 'no', 3_000),      // falla: dijo que no acababa
      apuesta('pronto', 'si', 1_000),     // acierta
    ], acabo)
    expect(tabla.map((s) => s.author)).toEqual(['pronto', 'tarde'])
    expect(tabla[0].points).toBeGreaterThan(tabla[1].points)
  })

  it('y entonces las medallas caen donde deben', () => {
    const tabla = scoreBets([
      apuesta('falla', 'no', 3_000),
      apuesta('acierta', 'si', 1_000),
    ], acabo)
    const medallas = puestosDePorra(tabla).map((p, i) => betMedal(p, tabla[i].points))
    expect(medallas[0]).toBe('🔮')
    // Quien no sumó no lleva medalla: el bronce no es un premio de asistencia.
    expect(medallas[1]).toBe('·')
  })
})

/**
 * Las dos mitades de cada pronóstico.
 *
 * "¿Acaba?" es cara o cruz y vale poco: es la apuesta con la que entra quien no
 * sabe nada de la carrera. La segunda mitad es la que pide saber: quien dice
 * que sí acaba, dice a qué hora; quien dice que no, dice en qué kilómetro se
 * baja. Las dos pagan igual porque las dos son igual de difíciles — adivinar
 * dónde se rompe alguien no es más fácil que su hora de meta.
 */
describe('el kilómetro del abandono', () => {
  const apuesta = (author: string, km: string): EventBet =>
    ({ author, target: 'Soriano', kind: 'abandon_km', value: km, createdAt: 1_000 })
  /** Se retiró en el km 22 de una de cien. */
  const seRetiro: RunnerOutcome[] = [
    { username: 'Soriano', tracked: true, finished: false, finishedAt: null, settled: true, kmAbandono: 22 },
  ]
  const cien = { totalKm: 100 }

  it('clavarlo vale más que acertar el binario de "acaba"', () => {
    const [clavada] = scoreBets([apuesta('a', '22')], seRetiro, null, null, cien)
    const [binaria] = scoreBets(
      [{ author: 'b', target: 'Soriano', kind: 'finish', value: 'no', createdAt: 1_000 }],
      seRetiro,
    )
    expect(clavada.points).toBeGreaterThan(binaria.points * 2)
    expect(clavada.bets[0].note).toContain('clavado')
  })

  it('se puntúa lo cerca que se quedó, no el sí o no', () => {
    const cerca = scoreBets([apuesta('a', '25')], seRetiro, null, null, cien)[0].points
    const lejos = scoreBets([apuesta('a', '35')], seRetiro, null, null, cien)[0].points
    expect(cerca).toBeGreaterThan(lejos)
    expect(lejos).toBe(0)
  })

  it('el margen es del RECORRIDO: tres kilómetros no valen igual en un 10K', () => {
    const enCien = scoreBets([apuesta('a', '25')], seRetiro, null, null, cien)[0].points
    const enDiez = scoreBets([apuesta('a', '25')], seRetiro, null, null, { totalKm: 10 })[0].points
    expect(enCien).toBeGreaterThan(0)
    expect(enDiez).toBe(0)
  })

  it('si acabó llegando, el pronóstico se cae pero no resta', () => {
    const llego: RunnerOutcome[] = [
      { username: 'Soriano', tracked: true, finished: true, finishedAt: 9_000, settled: true },
    ]
    const s = scoreBets([apuesta('a', '22')], llego, null, null, cien)[0]
    expect(s.points).toBe(0)
    expect(s.bets[0].state).toBe('ko')
    expect(s.bets[0].note).toBe('llegó a meta')
  })

  it('mientras no se sepa, ni suma ni resta: queda pendiente', () => {
    const corriendo: RunnerOutcome[] = [
      { username: 'Soriano', tracked: true, finished: false, finishedAt: null, settled: false },
    ]
    const s = scoreBets([apuesta('a', '22')], corriendo, null, null, cien)[0]
    expect(s.bets[0].state).toBe('pending')
    expect(s.pending).toBe(1)
  })
})

describe('el kilómetro más rápido de la carrera', () => {
  // Quién, en `target`: por el cable no viaja ningún id de cuenta.
  const apuesta = (author: string, quien: string): EventBet =>
    ({ author, target: quien, kind: 'fastest_km', value: '1', createdAt: 1_000 })
  const decidida: RunnerOutcome[] = [
    { username: 'JM', tracked: true, finished: true, finishedAt: 5_000, settled: true },
    { username: 'Soriano', tracked: true, finished: false, finishedAt: null, settled: true, kmAbandono: 22 },
  ]

  it('acertarlo vale más que el binario y menos que el ganador', () => {
    const s = scoreBets([apuesta('a', 'JM')], decidida, null, null, { recordKm: 'JM' })[0]
    expect(s.points).toBe(25)
    expect(s.bets[0].note).toBe('el más rápido')
  })

  it('fallarlo dice quién lo hizo, que es medio chiste de la porra', () => {
    const s = scoreBets([apuesta('a', 'Soriano')], decidida, null, null, { recordKm: 'JM' })[0]
    expect(s.points).toBe(0)
    expect(s.bets[0].note).toBe('lo hizo JM')
  })

  it('no se resuelve hasta que la carrera está decidida', () => {
    // Mientras quede alguien corriendo, el kilómetro más rápido puede hacerlo
    // cualquiera: anunciarlo antes es contar el final a media película.
    const enCarrera: RunnerOutcome[] = [
      { username: 'JM', tracked: true, finished: false, finishedAt: null, settled: false },
    ]
    const s = scoreBets([apuesta('a', 'JM')], enCarrera, null, null, { recordKm: 'JM' })[0]
    expect(s.bets[0].state).toBe('pending')
  })
})

/**
 * El empate: con los mismos puntos se comparte el puesto, pero alguien tiene
 * que ir primero en la lista.
 */
describe('quién va delante con los mismos puntos', () => {
  const acierta = (author: string, createdAt: number): EventBet =>
    ({ author, target: 'Soriano', kind: 'finish', value: 'si', createdAt })
  const acabo: RunnerOutcome[] = [
    { username: 'Soriano', tracked: true, finished: true, finishedAt: 5_000, settled: true },
  ]

  it('el que se mojó ANTES, que se arriesgó con menos información', () => {
    // La porra cierra en la salida: quien la echó una semana antes apostó a
    // ciegas y quien la echó diez minutos antes ya había visto el parte, a los
    // rivales calentando y quién no se había presentado.
    const tabla = scoreBets([acierta('tarde', 9_000), acierta('pronto', 1_000)], acabo)
    expect(tabla.map((s) => s.author)).toEqual(['pronto', 'tarde'])
    // Pero el PUESTO lo comparten: ir delante en la lista no es ganar.
    expect(puestosDePorra(tabla)).toEqual([0, 0])
  })

  it('mientras nadie tiene puntos, manda el último que se mojó', () => {
    // Ahí la lista no es una clasificación: es quién acaba de apuntarse.
    const enCarrera: RunnerOutcome[] = [
      { username: 'Soriano', tracked: true, finished: false, finishedAt: null, settled: false },
    ]
    const tabla = scoreBets([acierta('pronto', 1_000), acierta('tarde', 9_000)], enCarrera)
    expect(tabla.map((s) => s.author)).toEqual(['tarde', 'pronto'])
  })
})

describe('la porra con alguien en modo manual', () => {
  // Matxicots 26: la baliza de Valen se quedó sin batería y pasó a manual.
  const bet = (author: string, target: string): EventBet => ({ author, target, kind: 'fastest_km', value: target, createdAt: 1 })
  const corredores: RunnerOutcome[] = [
    { username: 'Soriano', tracked: true, finished: true, finishedAt: 100, settled: true, kmAbandono: null },
    { username: 'Valen', tracked: true, finished: true, finishedAt: 120, settled: true, kmAbandono: null, manual: true },
  ]

  it('el km más rápido apostado a quien va en manual no computa: ni suma ni es fallo', () => {
    const tabla = scoreBets([bet('Ana', 'Valen'), bet('Luis', 'Soriano')], corredores, 0, null, { recordKm: 'Soriano' })
    const ana = tabla.find((s) => s.author === 'Ana')!
    expect(ana.bets[0].state).toBe('nula')
    expect(ana.points).toBe(0)
    expect(ana.pending).toBe(0)
    const luis = tabla.find((s) => s.author === 'Luis')!
    expect(luis.bets[0].state).toBe('ok')
  })

  it('se sabe desde que pasa a manual, sin esperar al cierre', () => {
    const enCarrera = corredores.map((o) => ({ ...o, finished: false, finishedAt: null, settled: false }))
    const tabla = scoreBets([bet('Ana', 'Valen')], enCarrera, 0, null, { recordKm: null })
    expect(tabla[0].bets[0].state).toBe('nula')
  })
})
