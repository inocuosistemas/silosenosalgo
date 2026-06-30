/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { TOKEN_RE } from '../../../shared/validate'
import type { TrackStateResponse, TrackFix, TrailPoint } from '../../../shared/wireTypes'

/**
 * GET /api/track/:id — public, no auth. Returns the last known fix + short
 * trail for BOTH active and ended sessions (so a route stays viewable for 24 h
 * after the share ends). Never cached (must reflect a live position). Projects
 * only non-PII fields — never owner_user_id / username. Lazily purges the
 * session on first read past `expires_at`, whatever its status (D1 has no
 * native TTL): the data is nulled and the link goes dark.
 */

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)

  const row = await env.DB.prepare(
    `SELECT ts.status AS status, ts.title AS title, ts.plan_share_id AS planShareId,
            ts.started_at AS startedAt, ts.expires_at AS expiresAt, ts.ended_at AS endedAt,
            ts.lat AS lat, ts.lon AS lon, ts.track_km AS trackKm, ts.speed AS speed,
            ts.heading AS heading, ts.accuracy AS accuracy, ts.altitude AS altitude,
            ts.fix_at AS fixAt, ts.updated_at AS updatedAt, ts.trail AS trail,
            ts.pinned AS pinned, u.username AS username
       FROM tracking_sessions ts LEFT JOIN users u ON u.id = ts.owner_user_id
      WHERE ts.id = ?`,
  ).bind(id).first<{
    status: string; title: string | null; planShareId: string | null
    startedAt: number; expiresAt: number; endedAt: number | null
    lat: number | null; lon: number | null; trackKm: number | null; speed: number | null
    heading: number | null; accuracy: number | null; altitude: number | null
    fixAt: number | null; updatedAt: number | null; trail: string | null
    pinned: number | null; username: string | null
  }>()
  if (!row) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  let status: 'active' | 'ended' = row.status === 'active' ? 'active' : 'ended'
  // Past expires_at the session is over. Normally we lazy-purge the data (the
  // link goes dark, so 24 h after an end the route disappears too). Pinned
  // sessions ("chincheta") are exempt: they read as ended but keep their data
  // viewable indefinitely.
  if (now > row.expiresAt) {
    status = 'ended'
    if (!row.pinned) {
      await env.DB.prepare(
        "UPDATE tracking_sessions SET status='ended', ended_at=COALESCE(ended_at, ?), lat=NULL, lon=NULL, trail=NULL WHERE id=?",
      ).bind(now, id).run()
      row.lat = null; row.lon = null; row.trail = null; row.endedAt = row.endedAt ?? now
    }
  }

  // Keep showing the last known fix + trail whenever present, for active AND
  // ended sessions (until the lazy purge above clears them).
  let fix: TrackFix | null = null
  if (row.lat !== null && row.lon !== null && row.updatedAt !== null) {
    fix = {
      lat: row.lat, lon: row.lon, trackKm: row.trackKm, speed: row.speed,
      heading: row.heading, accuracy: row.accuracy, altitude: row.altitude,
      fixAt: row.fixAt, updatedAt: row.updatedAt,
    }
  }

  let trail: TrailPoint[] = []
  if (row.trail) {
    try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] }
  }

  const body: TrackStateResponse = {
    status, username: row.username, title: row.title, startedAt: row.startedAt, expiresAt: row.expiresAt,
    endedAt: row.endedAt, planShareId: row.planShareId, fix, trail,
  }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}

/**
 * DELETE /api/track/:id — owner-only "eliminar de forma total": hard-delete the
 * row so nothing remains (unlike /end, which keeps the data for 24 h). Ownership
 * is checked with a SELECT (not meta.changes, unreliable on production D1).
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('DELETE FROM tracking_sessions WHERE id=? AND owner_user_id=?')
    .bind(id, user.id).run()
  return new Response(null, { status: 204 })
}
