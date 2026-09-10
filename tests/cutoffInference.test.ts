import { describe, it, expect } from 'vitest'
import { inferCutoffDates } from '../src/lib/cutoffInference'

/**
 * De qué día es cada corte.
 *
 * El corte se guarda como una hora de reloj sin fecha (HH:MM), así que el día
 * hay que deducirlo. Equivocarse no da un error: da una tabla que MIENTE, y
 * miente hacia el lado peligroso —"te sobran 24 h" cuando en realidad vas
 * justo—. El caso que trajo esto fue la Canfranc-Canfranc: cada control venía
 * DOS veces en el GPX de la organización (el cierre y su avituallamiento, en
 * las mismas coordenadas), y cada repetición empujaba el corte un día entero.
 */

const salida = new Date(2026, 8, 12, 22, 0, 0, 0) // sábado 22:00

const hhmm = (t: string) => ({ hour: Number(t.slice(0, 2)), minute: Number(t.slice(3, 5)) })

/** Días de ruta que separan un corte de la salida, como los pinta la tabla. */
const dia = (d: Date) => {
  const m = new Date(salida); m.setHours(0, 0, 0, 0)
  const n = new Date(d); n.setHours(0, 0, 0, 0)
  return Math.round((n.getTime() - m.getTime()) / 86_400_000)
}

const reloj = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

describe('el día de cada corte', () => {
  it('pasa al día siguiente en cuanto el reloj da la vuelta', () => {
    const r = inferCutoffDates([
      { key: 'a', km: 16.6, wallClock: hhmm('02:30') },
      { key: 'b', km: 22.1, wallClock: hhmm('06:00') },
      { key: 'c', km: 62.0, wallClock: hhmm('22:00') },
      { key: 'd', km: 72.1, wallClock: hhmm('02:00') },
    ], salida)
    // Salida a las 22:00 del día 0: las 02:30 ya son del día 1.
    expect(dia(r.get('a')!)).toBe(1)
    expect(dia(r.get('b')!)).toBe(1)
    expect(dia(r.get('c')!)).toBe(1)
    // Y las 02:00 después de las 22:00, del día 2.
    expect(dia(r.get('d')!)).toBe(2)
  })

  it('el mismo punto repetido no gasta un día (Canfranc-Canfranc)', () => {
    // El GPX trae el cierre y el avituallamiento en las mismas coordenadas, así
    // que comparten clave y comparten hora. Antes, la segunda copia tenía que
    // caer "después" de la primera y se iba 24 h más allá; al octavo control el
    // margen que se le enseñaba al corredor era de +176 h.
    const r = inferCutoffDates([
      { key: 'canf', km: 16.6, wallClock: hhmm('02:30') },
      { key: 'canf', km: 16.6, wallClock: hhmm('02:30') },
      { key: 'camp', km: 22.1, wallClock: hhmm('06:00') },
      { key: 'camp', km: 22.1, wallClock: hhmm('06:00') },
      { key: 'negr', km: 42.3, wallClock: hhmm('14:30') },
      { key: 'negr', km: 42.3, wallClock: hhmm('14:30') },
      { key: 'anay', km: 50.5, wallClock: hhmm('17:30') },
      { key: 'roya', km: 62.0, wallClock: hhmm('22:00') },
      { key: 'truc', km: 72.1, wallClock: hhmm('02:00') },
      { key: 'cand', km: 82.4, wallClock: hhmm('05:00') },
      { key: 'meta', km: 99.5, wallClock: hhmm('13:00') },
    ], salida)
    expect(dia(r.get('canf')!)).toBe(1)
    expect(dia(r.get('camp')!)).toBe(1)
    expect(dia(r.get('negr')!)).toBe(1)
    expect(dia(r.get('anay')!)).toBe(1)
    expect(dia(r.get('roya')!)).toBe(1)
    expect(dia(r.get('truc')!)).toBe(2)
    expect(dia(r.get('cand')!)).toBe(2)
    expect(dia(r.get('meta')!)).toBe(2)
    // Y la meta cierra 39 h después de dar la salida, no 176 h: 2 h hasta la
    // medianoche, un día entero, y las 13:00 del segundo día.
    expect((r.get('meta')!.getTime() - salida.getTime()) / 3_600_000).toBeCloseTo(2 + 24 + 13, 5)
  })

  it('dos puntos distintos que cierran a la vez cierran el mismo día', () => {
    // Un control y su avituallamiento, a diez metros y con el mismo cierre: son
    // el mismo instante, no dos días.
    const r = inferCutoffDates([
      { key: 'control', km: 42.3, wallClock: hhmm('14:30') },
      { key: 'avit', km: 42.31, wallClock: hhmm('14:30') },
    ], salida)
    expect(dia(r.get('control')!)).toBe(dia(r.get('avit')!))
    expect(r.get('control')!.getTime()).toBe(r.get('avit')!.getTime())
  })

  it('en el mismo punto, un cierre unos minutos antes NO se va a mañana', () => {
    // El avituallamiento recoge cinco minutos antes de que cierre el control.
    // Ir hacia atrás unos minutos en el mismo sitio es eso, no un día entero.
    const r = inferCutoffDates([
      { key: 'control', km: 42.3, wallClock: hhmm('14:30') },
      { key: 'avit', km: 42.3, wallClock: hhmm('14:25') },
    ], salida)
    expect(dia(r.get('avit')!)).toBe(dia(r.get('control')!))
    expect(reloj(r.get('avit')!)).toBe('14:25')
  })

  it('en el mismo punto, cruzar la medianoche sí cambia de día', () => {
    const r = inferCutoffDates([
      { key: 'control', km: 42.3, wallClock: hhmm('23:50') },
      { key: 'avit', km: 42.3, wallClock: hhmm('00:10') },
    ], salida)
    expect(dia(r.get('avit')!)).toBe(dia(r.get('control')!) + 1)
    expect(r.get('avit')!.getTime() - r.get('control')!.getTime()).toBe(20 * 60_000)
  })

  it('un corte anterior a la salida se va al día siguiente', () => {
    // Salida a las 22:00 y corte a las 21:00: es el de mañana, no el de hace
    // una hora.
    const r = inferCutoffDates([{ key: 'a', km: 5, wallClock: hhmm('21:00') }], salida)
    expect(dia(r.get('a')!)).toBe(1)
  })
})
