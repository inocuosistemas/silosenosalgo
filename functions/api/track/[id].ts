/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json } from '../../lib/http'
import { TOKEN_RE } from '../../../shared/validate'
import type { TrackStateResponse, TrackFix, TrailPoint } from '../../../shared/wireTypes'

/**
 * GET /api/track/:id — public, no auth. Returns the latest fix + short trail.
 * Never cached (must reflect a live position). Projects only non-PII fields —
 * never owner_user_id / username. Lazily expires the session on first read past
 * `expires_at` (D1 has no native TTL).
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
            u.username AS username
       FROM tracking_sessions ts LEFT JOIN users u ON u.id = ts.owner_user_id
      WHERE ts.id = ?`,
  ).bind(id).first<{
    status: string; title: string | null; planShareId: string | null
    startedAt: number; expiresAt: number; endedAt: number | null
    lat: number | null; lon: number | null; trackKm: number | null; speed: number | null
    heading: number | null; accuracy: number | null; altitude: number | null
    fixAt: number | null; updatedAt: number | null; trail: string | null
    username: string | null
  }>()
  if (!row) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  let status: 'active' | 'ended' = row.status === 'active' ? 'active' : 'ended'
  if (status === 'active' && now > row.expiresAt) {
    status = 'ended'
    await env.DB.prepare(
      "UPDATE tracking_sessions SET status='ended', ended_at=?, lat=NULL, lon=NULL, trail=NULL WHERE id=?",
    ).bind(now, id).run()
    row.lat = null; row.lon = null; row.trail = null; row.endedAt = now
  }

  let fix: TrackFix | null = null
  if (status === 'active' && row.lat !== null && row.lon !== null && row.updatedAt !== null) {
    fix = {
      lat: row.lat, lon: row.lon, trackKm: row.trackKm, speed: row.speed,
      heading: row.heading, accuracy: row.accuracy, altitude: row.altitude,
      fixAt: row.fixAt, updatedAt: row.updatedAt,
    }
  }

  let trail: TrailPoint[] = []
  if (status === 'active' && row.trail) {
    try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] }
  }

  const body: TrackStateResponse = {
    status, username: row.username, title: row.title, startedAt: row.startedAt, expiresAt: row.expiresAt,
    endedAt: row.endedAt, planShareId: row.planShareId, fix, trail,
  }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}
