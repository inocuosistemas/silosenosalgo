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
