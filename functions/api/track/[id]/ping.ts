/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import type { TrailPoint } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/ping — owner pushes one GPS fix. Updates the latest fix
 * inline and appends to a capped breadcrumb trail (one row write per ping).
 */

const MIN_PING_INTERVAL_MS = 4000
/**
 * Max stored path points. The full traveled path IS the route the viewer draws
 * when no plan is linked, so we keep the whole thing — but downsample (drop
 * every other point) once over the cap to bound size while preserving the
 * overall shape. ~2000 pts ≈ a long race at coarse resolution, well under D1's
 * row limit.
 */
const PATH_MAX = 2000

interface PingBody {
  lat: number; lon: number
  trackKm?: number | null; speed?: number | null; heading?: number | null
  accuracy?: number | null; altitude?: number | null; fixAt?: number | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<PingBody>(request)
  if (!body) return json({ error: 'invalid_request' }, 400)
  const lat = num(body.lat)
  const lon = num(body.lon)
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: 'invalid_coords' }, 400)
  }

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner, status, expires_at AS expiresAt, updated_at AS updatedAt, trail FROM tracking_sessions WHERE id = ?',
  ).bind(id).first<{ owner: string; status: string; expiresAt: number; updatedAt: number | null; trail: string | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (row.owner !== user.id) return json({ error: 'forbidden' }, 403)

  const now = Date.now()
  if (row.status !== 'active' || now > row.expiresAt) return json({ error: 'ended' }, 410)
  // Server-side throttle: silently accept pings that arrive too fast.
  if (row.updatedAt && now - row.updatedAt < MIN_PING_INTERVAL_MS) return new Response(null, { status: 204 })

  let trail: TrailPoint[] = []
  if (row.trail) { try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] } }
  trail.push({ t: now, lat, lon })
  if (trail.length > PATH_MAX) {
    // Halve by keeping every other point; always retain the most recent fix.
    const latest = trail[trail.length - 1]
    trail = trail.filter((_, i) => i % 2 === 0)
    if (trail[trail.length - 1] !== latest) trail.push(latest)
  }

  await env.DB.prepare(
    `UPDATE tracking_sessions
        SET lat=?, lon=?, track_km=?, speed=?, heading=?, accuracy=?, altitude=?, fix_at=?, updated_at=?, trail=?
      WHERE id=?`,
  ).bind(
    lat, lon, num(body.trackKm), num(body.speed), num(body.heading),
    num(body.accuracy), num(body.altitude), num(body.fixAt) ?? now, now, JSON.stringify(trail), id,
  ).run()

  return new Response(null, { status: 204 })
}
