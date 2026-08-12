/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import { PLAN_ID_RE, isBeaconActivity } from '../../../shared/validate'
import type { BeaconActivity, CreateTrackResponse, TrackSessionsResponse, TrackSessionSummary } from '../../../shared/wireTypes'

/**
 * POST /api/track — create a live-tracking session (owner only). Returns a
 * public unguessable token; the runner shares `/?t=<token>`. Auto-expires.
 * GET /api/track — list the owner's recent sessions (owner only).
 */

const MAX_TTL_MS = 1000 * 60 * 60 * 16 // 16 h — covers an ultra; lazy-expired on read.
// Cierre automatico de la baliza anterior al abrir otra. Mismo plazo que el
// cierre manual (end.ts): el enlace sigue vivo 30 dias para que quepan la
// enhorabuena y las consultas posteriores.
const KEEP_AFTER_END_MS = 24 * 30 * 60 * 60 * 1000

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body =
    (await readJson<{ title?: string; planId?: string; planShareId?: string; ttlMs?: number; startAt?: number; activity?: unknown }>(request)) || {}
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.slice(0, 80).trim() : null
  const ttl = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? Math.min(body.ttlMs, MAX_TTL_MS) : MAX_TTL_MS
  // Movement type (nullable): store only a recognised value, else NULL = auto.
  const activity: BeaconActivity | null = isBeaconActivity(body.activity) ? body.activity : null

  // Resolve the plan to overlay on the public viewer (nullable):
  //  - planId: copy the owner's saved plan payload into SHARE_KV under a fresh,
  //    TTL-bound id so it's fetchable via the public GET /api/share/:id route.
  //  - planShareId: an existing share id (web broadcaster path) — use as-is.
  let planShareId: string | null = null
  let planName: string | null = null
  if (typeof body.planId === 'string' && PLAN_ID_RE.test(body.planId)) {
    const row = await env.DB.prepare('SELECT payload, name FROM plans WHERE id=? AND user_id=?')
      .bind(body.planId, user.id).first<{ payload: unknown; name: string | null }>()
    if (row) {
      planName = typeof row.name === 'string' ? row.name : null
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
  // Reference start = the PLANNED departure time (settable), so the broadcaster
  // can activate tracking before the start (a few minutes — or days — early) and
  // keep paces/predictions anchored to the real start, with a countdown until it.
  // Accept a generous window (up to 14 days ahead, 24 h behind) so a plan whose
  // race is days away is honoured; bad/wild values fall back to now.
  const FUTURE_START_MAX = 14 * 24 * 60 * 60 * 1000
  const PAST_START_MAX = 24 * 60 * 60 * 1000
  const startedAt =
    typeof body.startAt === 'number' && body.startAt <= now + FUTURE_START_MAX && body.startAt >= now - PAST_START_MAX
      ? body.startAt
      : now
  // One active session per user: end any prior active ones (stop accumulation).
  // Keep their data so they stay viewable for 48 h, then they're lazy-purged.
  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, expires_at=? WHERE owner_user_id=? AND status='active'",
  ).bind(now, now + KEEP_AFTER_END_MS, user.id).run()

  const id = genId(16)
  // Expiry anchored to the LATER of now / planned start, so a session activated
  // before the race survives through it (and the retention window after).
  const expiresAt = Math.max(now, startedAt) + ttl
  await env.DB.prepare(
    "INSERT INTO tracking_sessions (id, owner_user_id, title, plan_share_id, plan_name, status, started_at, expires_at, activity) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
  ).bind(id, user.id, title, planShareId, planName, startedAt, expiresAt, activity).run()

  const res: CreateTrackResponse = { id, expiresAt }
  return json(res, 201)
}

/**
 * GET /api/track — list the owner's recent sessions (newest first), so the
 * native app can continue a live one, start a new one, or delete any. Owner
 * only; never cached. Sessions past `expires_at` are projected as 'ended'
 * (their data is lazy-purged on the public read path).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const { results } = await env.DB.prepare(
    `SELECT id, title, plan_name AS planName, status, started_at AS startedAt, expires_at AS expiresAt,
            updated_at AS updatedAt, ended_at AS endedAt, pinned, activity
       FROM tracking_sessions WHERE owner_user_id=? ORDER BY started_at DESC LIMIT 50`,
  ).bind(user.id).all<{
    id: string; title: string | null; planName: string | null; status: string
    startedAt: number; expiresAt: number; updatedAt: number | null; endedAt: number | null
    pinned: number | null; activity: string | null
  }>()

  const now = Date.now()
  const sessions: TrackSessionSummary[] = (results || []).map((r) => {
    const pinned = !!r.pinned
    // A pinned session is never force-expired (kept indefinitely); otherwise a
    // row still marked 'active' but past expiry reads as ended.
    const expired = !pinned && now > r.expiresAt
    return {
      id: r.id,
      title: r.title,
      planName: r.planName,
      status: r.status === 'active' && !expired ? 'active' : 'ended',
      startedAt: r.startedAt,
      expiresAt: r.expiresAt,
      updatedAt: r.updatedAt,
      // A lazily/forced-ended session keeps status 'active' in the row but is past
      // expiry; surface that as ended-at-expiry so the list reads correctly.
      endedAt: r.endedAt ?? (r.status === 'active' && expired ? r.expiresAt : null),
      pinned,
      activity: isBeaconActivity(r.activity) ? r.activity : null,
    }
  })

  const res: TrackSessionsResponse = { sessions }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
