import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { NOMBRE_BORRADO, borraCuenta, renombra } from '../functions/lib/borrarCuenta'

// node:sqlite: el esquema de verdad, con todas las migraciones, y las claves
// ajenas encendidas como en D1.
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
  return db
}

/** Lo justo de D1 sobre SQLite. */
function d1(db: Sqlite) {
  const prep = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => prep(sql, p),
    first: async () => (db.prepare(sql).get(...params) as unknown) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { db.prepare(sql).run(...params); return { meta: {} } },
  })
  return {
    prepare: (sql: string) => prep(sql),
    batch: async (ss: { run: () => Promise<unknown> }[]) => { for (const x of ss) await x.run() },
  }
}

function kv() {
  const m = new Map<string, string>()
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v) },
    delete: async (k: string) => { m.delete(k) },
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  }
}

/** Una fila con lo que se diga y, en lo obligatorio que no se diga, algo que valga. */
function inserta(db: Sqlite, tabla: string, v: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string; notnull: number; dflt_value: unknown; type: string; pk: number }[]
  const fila = { ...v }
  for (const c of cols) {
    if (c.name in fila || !c.notnull || c.dflt_value !== null) continue
    fila[c.name] = /INT/i.test(c.type) ? 1 : `${c.name}-${Math.random().toString(36).slice(2, 8)}`
  }
  const nombres = Object.keys(fila)
  db.prepare(`INSERT INTO ${tabla} (${nombres.join(',')}) VALUES (${nombres.map(() => '?').join(',')})`).run(...nombres.map((n) => fila[n] as never))
}

describe('renombra', () => {
  it('cambia el nombre en valores y claves, a cualquier profundidad', () => {
    const r = renombra({ ana: 1, filas: [{ username: 'ana', puesto: 2 }, { username: 'beto' }] }, 'ana', 'X')
    expect(r.cambio).toBe(true)
    expect(r.valor).toEqual({ X: 1, filas: [{ username: 'X', puesto: 2 }, { username: 'beto' }] })
    expect(renombra({ a: 'anabel' }, 'ana', 'X').cambio).toBe(false)
  })
})

describe('borraCuenta', () => {
  it('se lleva lo suyo, pasa sus eventos a otro y borra los que se quedan vacíos', async () => {
    const db = base()
    const almacen = kv()
    const env = { DB: d1(db), SHARE_KV: almacen } as never
    for (const [id, nombre] of [['ana00001', 'ana'], ['beto0001', 'beto'], ['carla001', 'carla']]) {
      inserta(db, 'users', { id, username: nombre, username_ci: nombre })
    }
    // Su salida, con una nota con foto, y la copia de su plan.
    inserta(db, 'tracking_sessions', { id: 's1', owner_user_id: 'ana00001', plan_share_id: 'plan0001' })
    inserta(db, 'track_notes', { id: 'n1', session_id: 's1', owner_user_id: 'ana00001', photo_key: 'notemedia:s1:n1:photo' })
    almacen.m.set('notemedia:s1:n1:photo', 'jpg')
    almacen.m.set('plan0001', 'plan')
    // Una salida suya en un evento arranca con la base del evento, que se queda.
    inserta(db, 'tracking_sessions', { id: 's3', owner_user_id: 'ana00001', plan_share_id: 'base0001' })
    inserta(db, 'tracking_sessions', { id: 's4', owner_user_id: 'beto0001', plan_share_id: 'base0001' })
    almacen.m.set('base0001', 'plan')
    // La salida de otro no se toca.
    inserta(db, 'tracking_sessions', { id: 's2', owner_user_id: 'beto0001' })
    almacen.m.set('notemedia:s2:n9:photo', 'jpg')

    // e1: suyo, con Beto y con Carla de organizadora → pasa a Carla.
    inserta(db, 'events', { id: 'e1', created_by: 'ana00001', stats: JSON.stringify({ corredores: [{ username: 'ana', puesto: 1 }, { username: 'beto', puesto: 2 }] }) })
    inserta(db, 'event_members', { event_id: 'e1', user_id: 'ana00001', joined_at: 1 })
    inserta(db, 'event_members', { event_id: 'e1', user_id: 'beto0001', joined_at: 2 })
    inserta(db, 'event_members', { event_id: 'e1', user_id: 'carla001', joined_at: 3, organizer: 1 })
    almacen.m.set('archivo:e1:replay', JSON.stringify({ runners: [{ username: 'ana' }, { username: 'beto' }] }))
    almacen.m.set('archivo:e1:notas', JSON.stringify([{ id: 'n1', autorId: 'ana00001' }, { id: 'n7', autorId: 'beto0001' }]))
    almacen.m.set('archivo:e1:nota:n1', 'jpg')
    almacen.m.set('archivo:e1:nota:n7', 'jpg')
    // e2: suyo y solo con ella → se va.
    inserta(db, 'events', { id: 'e2', created_by: 'ana00001', photo_key: 'eventphoto:e2' })
    inserta(db, 'event_members', { event_id: 'e2', user_id: 'ana00001', joined_at: 1 })
    almacen.m.set('eventphoto:e2', 'jpg')
    // e3: de Beto; ella subió una foto.
    inserta(db, 'events', { id: 'e3', created_by: 'beto0001' })
    inserta(db, 'event_members', { event_id: 'e3', user_id: 'beto0001', joined_at: 1 })
    inserta(db, 'event_members', { event_id: 'e3', user_id: 'ana00001', joined_at: 2 })
    inserta(db, 'event_photos', { id: 'f1', event_id: 'e3', user_id: 'ana00001' })
    almacen.m.set('eventfoto:e3:f1', 'jpg')

    const r = await borraCuenta(env, 'ana00001', 'ana')

    expect(r).toEqual({ salidas: 2, eventosTraspasados: 1, eventosBorrados: 1 })
    expect(almacen.m.has('plan0001')).toBe(false)
    expect(almacen.m.has('base0001')).toBe(true)
    const uno = (sql: string) => db.prepare(sql).get() as Record<string, unknown> | undefined
    expect(uno("SELECT id FROM users WHERE id = 'ana00001'")).toBeUndefined()
    expect(uno("SELECT id FROM tracking_sessions WHERE id = 's1'")).toBeUndefined()
    expect(uno("SELECT id FROM track_notes WHERE id = 'n1'")).toBeUndefined()
    expect(uno("SELECT id FROM tracking_sessions WHERE id = 's2'")).toBeDefined()
    // e1 sigue, de Carla, y sin su nombre.
    expect(uno("SELECT created_by AS c FROM events WHERE id = 'e1'")?.c).toBe('carla001')
    expect(JSON.parse(uno("SELECT stats FROM events WHERE id = 'e1'")!.stats as string).corredores[0].username).toBe(NOMBRE_BORRADO)
    expect(JSON.parse(almacen.m.get('archivo:e1:replay')!).runners.map((x: { username: string }) => x.username)).toEqual([NOMBRE_BORRADO, 'beto'])
    expect(JSON.parse(almacen.m.get('archivo:e1:notas')!)).toEqual([{ id: 'n7', autorId: 'beto0001' }])
    expect(almacen.m.has('archivo:e1:nota:n1')).toBe(false)
    expect(almacen.m.has('archivo:e1:nota:n7')).toBe(true)
    // e2, fuera, con su cartel.
    expect(uno("SELECT id FROM events WHERE id = 'e2'")).toBeUndefined()
    expect(almacen.m.has('eventphoto:e2')).toBe(false)
    // e3 sigue, sin ella ni su foto.
    expect(uno("SELECT id FROM events WHERE id = 'e3'")).toBeDefined()
    expect(uno("SELECT user_id FROM event_members WHERE event_id = 'e3' AND user_id = 'ana00001'")).toBeUndefined()
    expect(uno("SELECT id FROM event_photos WHERE id = 'f1'")).toBeUndefined()
    expect(almacen.m.has('eventfoto:e3:f1')).toBe(false)
    // Lo suyo en KV, fuera; lo de los demás, intacto.
    expect(almacen.m.has('notemedia:s1:n1:photo')).toBe(false)
    expect(almacen.m.has('notemedia:s2:n9:photo')).toBe(true)
  })
})
