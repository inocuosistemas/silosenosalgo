import { describe, it, expect } from 'vitest'
import {
  escribeCadencia, leeCadencia, plazosDe, silencioTexto,
  CALLADO_POR_DEFECTO_MS, PERDIDO_POR_DEFECTO_MS,
} from '../shared/cadencia'

/**
 * Los plazos de silencio de cada baliza.
 *
 * Lo que esto evita pasó en la CanFranc: una baliza en "Ahorro · ultra" manda
 * una posición cada 500 metros, así que estar parado en un avituallamiento es
 * no mandar nada. El mapa la anunciaba como "sin cobertura" cada pocos minutos
 * y la baliza estaba perfecta.
 */

const min = (ms: number) => ms / 60_000

describe('la cadencia que promete una baliza', () => {
  it('va y vuelve del texto que viaja en el ping', () => {
    expect(escribeCadencia({ modo: 'distancia', valor: 500 })).toBe('d500')
    expect(escribeCadencia({ modo: 'tiempo', valor: 15 })).toBe('t15')
    expect(leeCadencia('d500')).toEqual({ modo: 'distancia', valor: 500 })
    expect(leeCadencia('t15')).toEqual({ modo: 'tiempo', valor: 15 })
  })

  it('lo que no se entiende se ignora, no se adivina', () => {
    for (const malo of ['', 'x500', 'd', 'd0', '500', 'd-5', 'd999999', null, undefined]) {
      expect(leeCadencia(malo as string)).toBeNull()
    }
  })
})

describe('cuánto silencio es normal', () => {
  it('sin cadencia, los plazos de siempre', () => {
    expect(plazosDe(null)).toEqual({ callado: CALLADO_POR_DEFECTO_MS, perdido: PERDIDO_POR_DEFECTO_MS })
  })

  it('emitiendo cada 15 s, veinte minutos callado ya es un hueco', () => {
    const p = plazosDe({ modo: 'tiempo', valor: 15 })
    expect(min(p.callado)).toBe(3)
    expect(min(p.perdido)).toBe(20)
  })

  it('emitiendo cada dos minutos, los plazos se estiran con ella', () => {
    const p = plazosDe({ modo: 'tiempo', valor: 120 })
    expect(min(p.callado)).toBe(6)
    expect(min(p.perdido)).toBe(20)
  })

  it('cada 500 m —modo ultra— hace falta media hora larga para preocuparse', () => {
    // A kilómetro y medio por hora, 500 m son veinte minutos. Con menos que eso
    // se anunciaba como perdida una baliza que solo estaba subiendo despacio.
    const p = plazosDe({ modo: 'distancia', valor: 500 })
    expect(min(p.callado)).toBe(20)
    expect(min(p.perdido)).toBe(40)
  })

  it('cada 100 m —el modo normal— apenas cambia nada', () => {
    const p = plazosDe({ modo: 'distancia', valor: 100 })
    expect(min(p.callado)).toBe(4)
    expect(min(p.perdido)).toBe(20)
  })

  it('ningún modo justifica hora y media sin noticias', () => {
    expect(min(plazosDe({ modo: 'distancia', valor: 5000 }).perdido)).toBe(90)
  })

  it('por distancia no se dice "sin cobertura", porque no se sabe', () => {
    // Puede estar sentado en una silla con cuatro rayas de cobertura.
    expect(silencioTexto({ modo: 'distancia', valor: 500 })).toBe('sin moverse 500 m')
    expect(silencioTexto({ modo: 'distancia', valor: 1000 })).toBe('sin moverse 1.0 km')
    expect(silencioTexto({ modo: 'tiempo', valor: 15 })).toBe('sin cobertura')
    expect(silencioTexto(null)).toBe('sin cobertura')
  })
})
