import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// El usuario de la petición, sin sesión de verdad: lo que se prueba es el alta.
vi.mock('../functions/lib/session', () => ({ getSessionUser: async () => ({ id: 'ana00001', username: 'ana' }) }))
const { onRequestPost } = await import('../functions/api/track/importa')

interface Sqlite {
  exec(sql: string): void
  prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string) => Sqlite }

function base(): Sqlite {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const dir = join(__dirname, '..', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'))
  db.prepare("INSERT INTO users (id, username, username_ci, password_hash, salt, iterations) VALUES ('ana00001','ana','ana','x','s',1)").run()
  return db
}
function d1(db: Sqlite) {
  const prep = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => prep(sql, p),
    first: async () => (db.prepare(sql).get(...params) as unknown) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { db.prepare(sql).run(...params); return { meta: {} } },
  })
  return { prepare: (sql: string) => prep(sql) }
}

const pide = (db: Sqlite, cuerpo: unknown) => onRequestPost({
  request: new Request('https://x/api/track/importa', {
    method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  }),
  env: { DB: d1(db), SHARE_KV: { put: async () => {} } },
} as never)

describe('subir a la cuenta una salida grabada sin ella', () => {
  it('nace terminada, con chincheta, con su fecha real y sin tocar la baliza en marcha', async () => {
    const db = base()
    // Una baliza en marcha ahora mismo: no se puede cortar.
    db.prepare("INSERT INTO tracking_sessions (id, owner_user_id, status, started_at, expires_at) VALUES ('viva00000000000001','ana00001','active',?,?)")
      .run(Date.now() - 60_000, Date.now() + 3_600_000)
    const hace60dias = Date.now() - 60 * 86_400_000
    const trail = Array.from({ length: 30 }, (_, i) => ({ t: hace60dias + i * 60_000, lat: 41.39 + i * 0.001, lon: 2.17, a: 5 }))
    const r = await pide(db, { title: 'Montseny', startAt: hace60dias - 5 * 60_000, endedAt: hace60dias + 40 * 60_000, activity: 'walk', trail })
    expect(r.status).toBe(201)
    const { id } = await r.json() as { id: string }
    const fila = db.prepare('SELECT * FROM tracking_sessions WHERE id=?').get(id) as Record<string, unknown>
    expect(fila).toMatchObject({ status: 'ended', pinned: 1, title: 'Montseny', activity: 'walk', started_at: hace60dias - 5 * 60_000 })
    expect(JSON.parse(fila.trail as string)).toHaveLength(30)
    expect((db.prepare("SELECT status FROM tracking_sessions WHERE id='viva00000000000001'").get() as { status: string }).status).toBe('active')
  })

  it('rechaza una traza vacía o sin puntos válidos', async () => {
    const db = base()
    expect((await pide(db, { trail: [] })).status).toBe(400)
    expect((await pide(db, { trail: [{ t: 1, lat: 999, lon: 0 }] })).status).toBe(400)
  })

  it('recorta la traza como la de siempre', async () => {
    const db = base()
    const t0 = Date.now() - 86_400_000
    const trail = Array.from({ length: 5000 }, (_, i) => ({ t: t0 + i * 1000, lat: 41, lon: 2 + i * 1e-5 }))
    const { id } = await (await pide(db, { trail })).json() as { id: string }
    const fila = db.prepare('SELECT trail FROM tracking_sessions WHERE id=?').get(id) as { trail: string }
    expect(JSON.parse(fila.trail).length).toBeLessThanOrEqual(2001)
  })
})
