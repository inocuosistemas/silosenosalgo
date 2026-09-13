import { describe, it, expect } from 'vitest'
import { tocaRecordVivo } from '../functions/lib/recordVivo'

const H = 3_600_000
const salida = 10 * H

describe('tocaRecordVivo', () => {
  it('con la carrera en marcha y la porra encendida, sí', () => {
    expect(tocaRecordVivo({ betsEnabled: 1, startsAt: salida, endedAt: null }, salida + H)).toBe(true)
  })

  it('antes de la salida no hay kilómetros que medir', () => {
    expect(tocaRecordVivo({ betsEnabled: 1, startsAt: salida, endedAt: null }, salida - 1)).toBe(false)
  })

  it('con la carrera cerrada manda el de los resultados congelados', () => {
    expect(tocaRecordVivo({ betsEnabled: 1, startsAt: salida, endedAt: salida + 5 * H }, salida + 6 * H)).toBe(false)
  })

  it('sin porra, o sin hora de salida, no se calcula', () => {
    expect(tocaRecordVivo({ betsEnabled: 0, startsAt: salida, endedAt: null }, salida + H)).toBe(false)
    expect(tocaRecordVivo({ betsEnabled: 1, startsAt: null, endedAt: null }, salida + H)).toBe(false)
  })
})
