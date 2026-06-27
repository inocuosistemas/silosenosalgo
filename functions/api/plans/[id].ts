/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { PLAN_ID_RE } from '../../../shared/validate'

const MAX_PLAN_BYTES = 1.8 * 1024 * 1024
const decodeHeader = (v: string | null): string => {
  if (!v) return ''
  try { return decodeURIComponent(v) } catch { return '' }
}
const numOrNull = (v: string | null): number | null => {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** GET /api/plans/:id — return the gzipped payload (owner only). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id)
  if (!PLAN_ID_RE.test(id)) return json({ error: 'bad_id' }, 400)

  const row = await env.DB.prepare('SELECT payload FROM plans WHERE id=? AND user_id=?')
    .bind(id, user.id).first<{ payload: unknown }>()
  if (!row) return json({ error: 'not_found' }, 404)
  // D1 returns BLOB columns as number[] (array of byte values); normalise to
  // raw bytes (handle ArrayBuffer / typed arrays defensively too).
  const raw = row.payload
  let bytes: Uint8Array
  if (Array.isArray(raw)) bytes = new Uint8Array(raw)
  else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw)
  else if (ArrayBuffer.isView(raw)) bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  else bytes = new Uint8Array(0)
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
  })
}

/** PUT /api/plans/:id — rename (JSON {name}) or overwrite payload (octet-stream). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id)
  if (!PLAN_ID_RE.test(id)) return json({ error: 'bad_id' }, 400)

  // Ownership check by SELECT (D1 meta.changes is unreliable on prod).
  const owned = await env.DB.prepare('SELECT id FROM plans WHERE id=? AND user_id=?').bind(id, user.id).first()
  if (!owned) return json({ error: 'not_found' }, 404)
  const now = Date.now()

  const ct = request.headers.get('Content-Type') || ''
  if (ct.includes('application/json')) {
    const body = await readJson<{ name?: string }>(request)
    const name = (body?.name ?? '').slice(0, 120).trim()
    if (!name) return json({ error: 'invalid_request' }, 400)
    await env.DB.prepare('UPDATE plans SET name=?, updated_at=? WHERE id=? AND user_id=?')
      .bind(name, now, id, user.id).run()
    return json({ ok: true }, 200)
  }

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > MAX_PLAN_BYTES) return json({ error: 'too_large' }, 413)
  const name = decodeHeader(request.headers.get('X-Plan-Name')).slice(0, 120).trim()
  const routeName = decodeHeader(request.headers.get('X-Plan-Route')).slice(0, 120).trim() || null
  const distanceKm = numOrNull(request.headers.get('X-Plan-Distance'))
  const elevGainM = numOrNull(request.headers.get('X-Plan-Elev'))
  const startTime = decodeHeader(request.headers.get('X-Plan-Start')).slice(0, 40) || null

  if (name) {
    await env.DB.prepare(
      'UPDATE plans SET name=?, route_name=?, distance_km=?, elev_gain_m=?, start_time=?, payload=?, updated_at=? WHERE id=? AND user_id=?',
    ).bind(name, routeName, distanceKm, elevGainM, startTime, new Uint8Array(buf), now, id, user.id).run()
  } else {
    await env.DB.prepare(
      'UPDATE plans SET route_name=?, distance_km=?, elev_gain_m=?, start_time=?, payload=?, updated_at=? WHERE id=? AND user_id=?',
    ).bind(routeName, distanceKm, elevGainM, startTime, new Uint8Array(buf), now, id, user.id).run()
  }
  return json({ ok: true }, 200)
}

/** DELETE /api/plans/:id — owner only. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id)
  if (!PLAN_ID_RE.test(id)) return json({ error: 'bad_id' }, 400)

  const owned = await env.DB.prepare('SELECT id FROM plans WHERE id=? AND user_id=?').bind(id, user.id).first()
  if (!owned) return json({ error: 'not_found' }, 404)
  await env.DB.prepare('DELETE FROM plans WHERE id=? AND user_id=?').bind(id, user.id).run()
  return new Response(null, { status: 204 })
}
