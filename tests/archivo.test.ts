import { describe, it, expect } from 'vitest'
import { fusionaReplay } from '../functions/lib/archivo'
import type { EventReplay, EventReplayRunner } from '../shared/wireTypes'

const M = 60_000

function corredor(username: string, puntos: number): EventReplayRunner {
  return {
    username, bib: null, emoji: null, color: null, final: null,
    points: Array.from({ length: puntos }, (_, i) => ({ t: i * M, lat: 42 + i * 0.001, lon: -0.5 })),
  }
}
const replay = (runners: EventReplayRunner[], from = 0, to = 60 * M): EventReplay => ({ from, to, runners })

describe('fusionaReplay', () => {
  it('sin archivo, el replay de ahora tal cual', () => {
    const ahora = replay([corredor('JM', 10)])
    expect(fusionaReplay(ahora, null)).toBe(ahora)
  })

  it('quien ya no tiene traza sale del archivo, y quien la tiene sale de ella', () => {
    // Soriano dejó el plazo corto y su traza ya se purgó; JM la conserva y además
    // se le recortó al corregir su abandono.
    const ahora = replay([corredor('JM', 10)])
    const guardado = replay([corredor('JM', 14), corredor('Soriano', 12)])
    const r = fusionaReplay(ahora, guardado)
    expect(r.runners.map((c) => [c.username, c.points.length])).toEqual([['JM', 10], ['Soriano', 12]])
  })

  it('con todas las trazas purgadas, el archivo entero', () => {
    const guardado = replay([corredor('JM', 14), corredor('Soriano', 12)])
    expect(fusionaReplay(replay([]), guardado)).toBe(guardado)
  })

  it('el reloj es el de ahora: de la salida al cierre vigentes', () => {
    const ahora = replay([corredor('JM', 10)], 5 * M, 40 * M)
    const guardado = replay([corredor('Soriano', 12)], 0, 48 * 60 * M)
    const r = fusionaReplay(ahora, guardado)
    expect([r.from, r.to]).toEqual([5 * M, 40 * M])
  })

  it('guardar otra vez sin trazas nuevas no vacía nada', () => {
    const guardado = replay([corredor('JM', 14), corredor('Soriano', 12)])
    expect(fusionaReplay(replay([]), guardado).runners).toHaveLength(2)
  })
})
