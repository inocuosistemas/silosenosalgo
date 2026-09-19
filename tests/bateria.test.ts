import { describe, it, expect } from 'vitest'
import { estimaBateria } from '../src/lib/bateria'

const h = (hh: number, mm = 0) => Date.UTC(2026, 8, 19, hh - 2, mm) // hora peninsular

describe('cuánto le dura la batería', () => {
  it('Valen en Matxicots 26: 100% a las 05:55, 85% a las 06:22, 40% a las 08:01', () => {
    const e = estimaBateria([[h(5, 55), 100], [h(6, 22), 85], [h(8, 1), 40]], h(6))!
    // Desde la salida: 60 puntos en dos horas.
    expect(e.porHora!).toBeCloseTo(29.75, 1)
    // Y se acababa hacia las 09:22.
    expect(Math.abs(e.agotaMs! - h(9, 22))).toBeLessThan(60_000)
  })

  it('lo gastado antes de la salida no cuenta', () => {
    // En la línea, una hora con la pantalla apagada: 2%. Corriendo, 20%/h.
    const e = estimaBateria([[h(5), 100], [h(5, 30), 99], [h(6), 98], [h(7), 78]], h(6))!
    expect(e.porHora!).toBeCloseTo(20, 5)
  })

  it('si lo enchufa, se empieza a medir de nuevo', () => {
    const cargando = estimaBateria([[h(6), 80], [h(7), 60], [h(7, 10), 65]], h(6))!
    expect(cargando.cargando).toBe(true)
    expect(cargando.agotaMs).toBeNull()
    // Y la descarga siguiente se mide desde el tope de la carga.
    const e = estimaBateria([[h(6), 80], [h(7), 60], [h(7, 10), 65], [h(7, 40), 70], [h(8, 40), 60]], h(6))!
    expect(e.porHora!).toBeCloseTo(10, 5)
  })

  it('sin carrera suficiente no se inventa un ritmo', () => {
    const e = estimaBateria([[h(6), 100], [h(6, 5), 99]], h(6))!
    expect(e.pct).toBe(99)
    expect(e.porHora).toBeNull()
  })

  it('mucho rato sin bajar otro punto rebaja el consumo', () => {
    // Bajó 10 puntos en la primera hora y luego nada durante otra hora entera:
    // no puede estar gastando 10%/h.
    const e = estimaBateria([[h(6), 100], [h(7), 90]], h(6), h(8))!
    expect(e.porHora!).toBeCloseTo(5.5, 5)
  })

  it('sin registro, nada', () => {
    expect(estimaBateria(undefined, null)).toBeNull()
    expect(estimaBateria([], null)).toBeNull()
  })
})
