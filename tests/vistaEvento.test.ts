import { describe, expect, it } from 'vitest'
import { carrerasParaPortada, enlaceDeVista, leeVista, pestanasDelEvento, vistaPorDefecto } from '../src/lib/vistaEvento'

describe('leeVista', () => {
  it('lee la sección de la dirección', () => {
    expect(leeVista('?e=abc&v=porra')).toBe('porra')
    expect(leeVista('?e=abc&v=plan')).toBe('plan')
  })
  it('entiende el mapa=1 de los enlaces de antes', () => {
    expect(leeVista('?e=abc&mapa=1')).toBe('mapa')
  })
  it('sin sección, o con una que no existe, no pide ninguna', () => {
    expect(leeVista('?e=abc')).toBeNull()
    expect(leeVista('?e=abc&v=inventada')).toBeNull()
  })
})

describe('vistaPorDefecto', () => {
  const salida = Date.UTC(2026, 8, 20, 7)
  it('antes de salir abre la parrilla', () => {
    expect(vistaPorDefecto({ startsAt: salida, endedAt: null }, salida - 1)).toBe('parrilla')
    expect(vistaPorDefecto({ startsAt: null, endedAt: null }, salida)).toBe('parrilla')
  })
  it('con la carrera en marcha abre el mapa', () => {
    expect(vistaPorDefecto({ startsAt: salida, endedAt: null }, salida + 60_000)).toBe('mapa')
  })
  it('terminada abre los resultados', () => {
    expect(vistaPorDefecto({ startsAt: salida, endedAt: salida + 3600_000 }, salida + 7200_000)).toBe('meta')
  })
})

describe('pestanasDelEvento', () => {
  const vistas = (o: Parameters<typeof pestanasDelEvento>[0]) => pestanasDelEvento(o).map((p) => p.vista)
  it('antes o durante: lista, y porra y plan solo si tocan', () => {
    expect(vistas({ betsEnabled: true, terminada: false, corro: true })).toEqual(['parrilla', 'mapa', 'lista', 'porra', 'plan'])
    expect(vistas({ betsEnabled: false, terminada: false, corro: false })).toEqual(['parrilla', 'mapa', 'lista'])
  })
  it('terminada: resultados y replay en vez de la lista', () => {
    expect(vistas({ betsEnabled: true, terminada: true, corro: true })).toEqual(['parrilla', 'mapa', 'meta', 'replay', 'porra', 'plan'])
  })
})

describe('enlaceDeVista', () => {
  it('arma la dirección de cada sección', () => {
    expect(enlaceDeVista('abc', 'porra')).toBe('/?e=abc&v=porra')
    expect(enlaceDeVista('abc', null)).toBe('/?e=abc')
  })
})

describe('carrerasParaPortada', () => {
  const ahora = Date.UTC(2026, 8, 15, 12)
  const h = 3600_000
  const ev = (id: string, startsAt: number | null, endedAt: number | null = null) => ({ id, startsAt, endedAt })
  it('primero la que se corre, luego las que vienen por fecha y al final las recién acabadas', () => {
    const lista = carrerasParaPortada([
      ev('acabada-ayer', ahora - 30 * h, ahora - 20 * h),
      ev('sabado', ahora + 72 * h),
      ev('sin-fecha', null),
      ev('corriendo', ahora - h),
      ev('manana', ahora + 20 * h),
      ev('acabada-hoy', ahora - 10 * h, ahora - 2 * h),
    ], ahora)
    expect(lista.map((e) => e.id)).toEqual(['corriendo', 'manana', 'sabado', 'sin-fecha', 'acabada-hoy', 'acabada-ayer'])
  })
  it('las acabadas hace más de una semana no salen', () => {
    expect(carrerasParaPortada([ev('vieja', ahora - 300 * h, ahora - 200 * h)], ahora)).toEqual([])
  })
})
