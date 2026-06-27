/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import type { PlanMeta, PlansListResponse } from '../../../shared/wireTypes'

/** Under D1's ~2 MB row cap. Client mirrors this. */
const MAX_PLAN_BYTES = 1.8 * 1024 * 1024

function decodeHeader(v: string | null): string {
  if (!v) return ''
  try { return decodeURIComponent(v) } catch { return '' }
}
function numOrNull(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** GET /api/plans — list the current user's plans (metadata only, no payloads). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const rows = await env.DB.prepare(
    `SELECT id, name, route_name AS routeName, distance_km AS distanceKm, elev_gain_m AS elevGainM,
            start_time AS startTime, created_at AS createdAt, updated_at AS updatedAt
       FROM plans WHERE user_id=? ORDER BY updated_at DESC LIMIT 200`,
  ).bind(user.id).all<PlanMeta>()
  const res: PlansListResponse = { plans: rows.results ?? [] }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}

/** POST /api/plans — create a plan. Body: gzipped SharePayload (octet-stream); metadata in X-Plan-* headers. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > MAX_PLAN_BYTES) return json({ error: 'too_large' }, 413)

  const name = (decodeHeader(request.headers.get('X-Plan-Name')).slice(0, 120).trim()) || 'Previsión'
  const routeName = decodeHeader(request.headers.get('X-Plan-Route')).slice(0, 120).trim() || null
  const distanceKm = numOrNull(request.headers.get('X-Plan-Distance'))
  const elevGainM = numOrNull(request.headers.get('X-Plan-Elev'))
  const startTime = decodeHeader(request.headers.get('X-Plan-Start')).slice(0, 40) || null
  const now = Date.now()
  const id = genId(8)

  await env.DB.prepare(
    `INSERT INTO plans (id, user_id, name, route_name, distance_km, elev_gain_m, start_time, payload, payload_v, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, user.id, name, routeName, distanceKm, elevGainM, startTime, new Uint8Array(buf), now, now).run()

  const meta: PlanMeta = { id, name, routeName, distanceKm, elevGainM, startTime, createdAt: now, updatedAt: now }
  return json(meta, 201)
}
