/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../lib/db'
import { json, csrfOk, readJson } from '../lib/http'
import { getSessionUser } from '../lib/session'
import { TOKEN_RE } from '../../shared/validate'
import { genId } from '../../shared/ids'
import type { AvisoDePaso } from '../../shared/wireTypes'

/**
 * Los avisos de paso de quien mira un evento (ver `lib/avisos`).
 *
 *   GET    /api/avisos?evento=<id>|token=<público>  — los míos en ese evento.
 *   POST   /api/avisos  { evento|token, km, nombre, corredor?: nombre|null }
 *   DELETE /api/avisos?id=<aviso>
 *
 * Con cuenta siempre: el aviso llega a TU iPhone, por la app con tu cuenta. Y
 * desde el mapa de los participantes (por id) o desde el enlace público (por
 * su token), que es desde donde mira la familia.
 */

const MAX_AVISOS = 30

async function eventoDe(env: Env, url: URL, body?: { evento?: unknown; token?: unknown }) {
  const id = String(body?.evento ?? url.searchParams.get('evento') ?? '')
  const token = String(body?.token ?? url.searchParams.get('token') ?? '')
  if (TOKEN_RE.test(id)) {
    return env.DB.prepare('SELECT id, ended_at AS endedAt FROM events WHERE id = ?').bind(id).first<{ id: string; endedAt: number | null }>()
  }
  if (TOKEN_RE.test(token)) {
    return env.DB.prepare('SELECT id, ended_at AS endedAt FROM events WHERE public_token = ?').bind(token).first<{ id: string; endedAt: number | null }>()
  }
  return null
}

async function mios(env: Env, eventId: string, userId: string): Promise<AvisoDePaso[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.km, a.nombre, u.username AS corredor, a.disparado_at AS disparadoAt
       FROM event_avisos a LEFT JOIN users u ON u.id = a.corredor_user_id
      WHERE a.event_id = ? AND a.user_id = ?
      ORDER BY a.km`,
  ).bind(eventId, userId).all<AvisoDePaso>()
  return results ?? []
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const ev = await eventoDe(env, new URL(request.url))
  if (!ev) return json({ error: 'not_found' }, 404)
  return json({ avisos: await mios(env, ev.id, user.id) }, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const body = (await readJson<{ evento?: unknown; token?: unknown; km?: unknown; nombre?: unknown; corredor?: unknown }>(request)) || {}
  const ev = await eventoDe(env, new URL(request.url), body)
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.endedAt !== null) return json({ error: 'ended' }, 410)
  if (typeof body.km !== 'number' || !Number.isFinite(body.km) || body.km < 0) return json({ error: 'invalid_request' }, 400)
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 60) : ''
  if (!nombre) return json({ error: 'invalid_request' }, 400)

  let corredorId: string | null = null
  if (typeof body.corredor === 'string' && body.corredor.trim()) {
    const c = await env.DB.prepare(
      `SELECT m.user_id AS id FROM event_members m JOIN users u ON u.id = m.user_id
        WHERE m.event_id = ? AND u.username = ?`,
    ).bind(ev.id, body.corredor.trim()).first<{ id: string }>()
    if (!c) return json({ error: 'not_found' }, 404)
    corredorId = c.id
  }

  const cuantos = await env.DB.prepare('SELECT COUNT(*) AS n FROM event_avisos WHERE event_id = ? AND user_id = ?')
    .bind(ev.id, user.id).first<{ n: number }>()
  if ((cuantos?.n ?? 0) >= MAX_AVISOS) return json({ error: 'too_many' }, 429)

  // El mismo aviso dos veces no: si ya está, se devuelve la lista tal cual.
  const km = Math.round(body.km * 100) / 100
  const ya = await env.DB.prepare(
    `SELECT 1 AS x FROM event_avisos WHERE event_id = ? AND user_id = ? AND ABS(km - ?) < 0.05
       AND ((corredor_user_id IS NULL AND ? IS NULL) OR corredor_user_id = ?) AND disparado_at IS NULL`,
  ).bind(ev.id, user.id, km, corredorId, corredorId).first()
  if (!ya) {
    await env.DB.prepare(
      'INSERT INTO event_avisos (id, event_id, user_id, km, nombre, corredor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(genId(12), ev.id, user.id, km, nombre, corredorId, Date.now()).run()
  }
  return json({ avisos: await mios(env, ev.id, user.id) }, 200)
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return json({ error: 'bad_id' }, 400)
  await env.DB.prepare('DELETE FROM event_avisos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return new Response(null, { status: 204 })
}
