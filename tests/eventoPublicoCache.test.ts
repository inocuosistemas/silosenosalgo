import { describe, expect, it, vi } from 'vitest'

// Lo caro del mapa público (el evento, sus corredores, el recuento) va a la
// caché y se comparte: aquí se cuenta cuántas veces se pregunta a la base.
vi.mock('../functions/lib/eventStats', () => ({
  cierraSiTocaEvento: async () => null,
  fotoDeResultadosSiToca: async () => {},
  leeStats: async () => null,
  leePasosManuales: () => null,
}))
vi.mock('../functions/lib/puntos', () => ({ leeAjustes: () => null }))

const { onRequestGet } = await import('../functions/api/events/public/[token]')

function cacheDeMentira() {
  const m = new Map<string, Response>()
  return {
    match: async (r: Request) => m.get(r.url)?.clone(),
    put: async (r: Request, res: Response) => { m.set(r.url, res.clone()) },
  }
}

function baseDeMentira() {
  const consultas: string[] = []
  const prep = (sql: string) => {
    const o = {
      bind: () => o,
      first: async () => {
        consultas.push(sql)
        if (sql.includes('FROM events')) {
          return { id: 'ev1', name: 'UP26', planShareId: null, puntosAjustes: null, trackingUrl: null, websiteUrl: null,
            startsAt: 1, photoKey: null, photoAt: null, betsEnabled: 0, endsAt: null, endedAt: null, planTotalKm: null,
            statsAt: null, stats: null, activity: 'run' }
        }
        return { n: 3 }
      },
      all: async () => { consultas.push(sql); return { results: [] } },
      run: async () => { consultas.push(sql); return { meta: {} } },
    }
    return o
  }
  return { consultas, db: { prepare: prep } }
}

const pide = (db: unknown, v: string) => onRequestGet({
  request: new Request(`https://x/api/events/public/jybAgWZpI8dBE0Z9n1hVAg?v=${v}`),
  env: { DB: db }, params: { token: 'jybAgWZpI8dBE0Z9n1hVAg' },
} as never)

describe('el mapa público de una carrera, compartido en caché', () => {
  it('quien llega después no vuelve a leer el evento ni los corredores: solo apunta que mira', async () => {
    ;(globalThis as unknown as { caches: unknown }).caches = { default: cacheDeMentira() }
    const { consultas, db } = baseDeMentira()
    const r1 = await pide(db, 'visor000000000001')
    expect((await r1.json() as { name: string }).name).toBe('UP26')
    const tras1 = consultas.length
    const r2 = await pide(db, 'visor000000000002')
    expect((await r2.json() as { name: string; mirando: number }).mirando).toBe(3)
    const nuevas = consultas.slice(tras1)
    expect(nuevas.some((q) => q.includes('FROM events') || q.includes('FROM event_members'))).toBe(false)
    expect(nuevas.length).toBeLessThanOrEqual(1)
    delete (globalThis as unknown as { caches?: unknown }).caches
  })
})
