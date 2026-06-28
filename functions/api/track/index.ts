/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import { PLAN_ID_RE } from '../../../shared/validate'
import type { CreateTrackResponse } from '../../../shared/wireTypes'

/**
 * POST /api/track — create a live-tracking session (owner only). Returns a
 * public unguessable token; the runner shares `/?t=<token>`. Auto-expires.
 */

const MAX_TTL_MS = 1000 * 60 * 60 * 16 // 16 h — covers an ultra; lazy-expired on read.

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body =
    (await readJson<{ title?: string; planId?: string; planShareId?: string; ttlMs?: number }>(request)) || {}
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.slice(0, 80).trim() : null
  const ttl = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? Math.min(body.ttlMs, MAX_TTL_MS) : MAX_TTL_MS

  // Resolve the plan to overlay on the public viewer (nullable):
  //  - planId: copy the owner's saved plan payload into SHARE_KV under a fresh,
  //    TTL-bound id so it's fetchable via the public GET /api/share/:id route.
  //  - planShareId: an existing share id (web broadcaster path) — use as-is.
  let planShareId: string | null = null
  if (typeof body.planId === 'string' && PLAN_ID_RE.test(body.planId)) {
    const row = await env.DB.prepare('SELECT payload FROM plans WHERE id=? AND user_id=?')
      .bind(body.planId, user.id).first<{ payload: unknown }>()
    if (row) {
      // D1 returns BLOB columns as number[]; normalise to raw bytes (handle
      // ArrayBuffer / typed arrays defensively too) — see functions/api/plans/[id].ts.
      const raw = row.payload
      let bytes: Uint8Array
      if (Array.isArray(raw)) bytes = new Uint8Array(raw)
      else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw)
      else if (ArrayBuffer.isView(raw)) bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      else bytes = new Uint8Array(0)
      const kvId = genId(8)
      await env.SHARE_KV.put(kvId, bytes, { expirationTtl: Math.max(60, Math.ceil(ttl / 1000)) })
      planShareId = kvId
    }
  }
  // Fallback (or plan not found/owned): accept a pre-existing share id directly.
  if (!planShareId && typeof body.planShareId === 'string' && PLAN_ID_RE.test(body.planShareId)) {
    planShareId = body.planShareId
  }

  const now = Date.now()
  // One active session per user: end any prior active ones (stop accumulation).
  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, lat=NULL, lon=NULL, trail=NULL WHERE owner_user_id=? AND status='active'",
  ).bind(now, user.id).run()

  const id = genId(16)
  const expiresAt = now + ttl
  await env.DB.prepare(
    "INSERT INTO tracking_sessions (id, owner_user_id, title, plan_share_id, status, started_at, expires_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  ).bind(id, user.id, title, planShareId, now, expiresAt).run()

  const res: CreateTrackResponse = { id, expiresAt }
  return json(res, 201)
}
