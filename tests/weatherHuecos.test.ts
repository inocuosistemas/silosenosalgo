import { describe, it, expect } from 'vitest'

/**
 * Horas sin datos en la respuesta de Open-Meteo.
 *
 * Más allá de su horizonte la API no falla: responde 200 y rellena con `null`
 * las horas que no tiene. El tipo del cliente dice `number`, así que nada
 * avisa, y esos nulos llegaban intactos hasta la primera pantalla que
 * escribiera un `.toFixed()` — y tiraba la aplicación entera. Pasó al
 * planificar la CanFranc de noviembre a dos meses vista: de las 2328 horas que
 * devolvió, 736 venían vacías.
 *
 * La regla, tal cual la aplica `weather.ts`: si falta cualquiera de las
 * lecturas esenciales, esa hora no tiene previsión.
 */
const falta = (v: unknown) => v == null || (typeof v === 'number' && !Number.isFinite(v))
const hayPrevision = (w: Record<string, unknown>) =>
  !(falta(w.temperatureC) || falta(w.precipMm) || falta(w.windSpeedKmh)
    || falta(w.windDirection) || falta(w.weatherCode))

const buena = {
  temperatureC: 12.4, precipMm: 0, windSpeedKmh: 18, windDirection: 270, weatherCode: 3,
}

describe('una hora sin datos no es una previsión', () => {
  it('una lectura completa vale', () => {
    expect(hayPrevision(buena)).toBe(true)
  })

  it('cero grados sí es una previsión: el cero no es un hueco', () => {
    expect(hayPrevision({ ...buena, temperatureC: 0 })).toBe(true)
    expect(hayPrevision({ ...buena, windSpeedKmh: 0, weatherCode: 0 })).toBe(true)
  })

  it('un null en cualquiera de las esenciales la anula', () => {
    for (const k of ['temperatureC', 'precipMm', 'windSpeedKmh', 'windDirection', 'weatherCode']) {
      expect(hayPrevision({ ...buena, [k]: null })).toBe(false)
    }
  })

  it('y un NaN también, que se cuela igual y rompe lo mismo', () => {
    expect(hayPrevision({ ...buena, temperatureC: NaN })).toBe(false)
  })
})
