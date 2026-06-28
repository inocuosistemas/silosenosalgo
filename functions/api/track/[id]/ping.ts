/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import type { TrailPoint } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/ping — owner pushes GPS fixes. Accepts a single fix
 * (legacy) OR a batch `{ fixes: [...] }` so the app can buffer positions while
 * offline (mountain dead zones) and flush the whole backlog when coverage
 * returns. Each fix carries its own `fixAt` (device GPS time); the trail is
 * ordered by that time so back-filled points land correctly, and the latest
 * fix by time becomes the live position.
 */

const PATH_MAX = 2000
const MAX_BATCH = 600

interface InFix {
  lat: number; lon: number
  trackKm?: number | null; speed?: number | null; heading?: number | null
  accuracy?: number | null; altitude?: number | null; fixAt?: number | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

interface NormFix { t: number; lat: number; lon: number; trackKm: number | null; speed: number | null; heading: number | null; accuracy: number | null; altitude: number | null }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ fixes?: InFix[] } & Partial<InFix>>(request)
  if (!body) return json({ error: 'invalid_request' }, 400)
  const raw: InFix[] = Array.isArray(body.fixes) ? body.fixes : [body as InFix]

  const now = Date.now()
  const minT = now - 7 * 24 * 3600_000 // ignore absurdly old timestamps
  const incoming: NormFix[] = []
  for (const f of raw.slice(0, MAX_BATCH)) {
    const lat = num(f.lat), lon = num(f.lon)
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    let t = num(f.fixAt)
    if (t === null || t < minT || t > now + 3600_000) t = now
    incoming.push({
      t, lat, lon, trackKm: num(f.trackKm), speed: num(f.speed), heading: num(f.heading),
      accuracy: num(f.accuracy), altitude: num(f.altitude),
    })
  }
  if (incoming.length === 0) return json({ error: 'invalid_coords' }, 400)

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner, status, expires_at AS expiresAt, trail FROM tracking_sessions WHERE id = ?',
  ).bind(id).first<{ owner: string; status: string; expiresAt: number; trail: string | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (row.owner !== user.id) return json({ error: 'forbidden' }, 403)
  if (row.status !== 'active' || now > row.expiresAt) return json({ error: 'ended' }, 410)

  // Merge into the trail, ordered by GPS time, then downsample to bound size.
  let trail: TrailPoint[] = []
  if (row.trail) { try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] } }
  for (const f of incoming) trail.push({ t: f.t, lat: f.lat, lon: f.lon })
  trail.sort((a, b) => a.t - b.t)
  while (trail.length > PATH_MAX) {
    const latest = trail[trail.length - 1]
    trail = trail.filter((_, i) => i % 2 === 0)
    if (trail[trail.length - 1] !== latest) trail.push(latest)
  }

  // Latest fix by time → the live position shown to followers.
  const latest = incoming.reduce((a, b) => (b.t >= a.t ? b : a))

  await env.DB.prepare(
    `UPDATE tracking_sessions
        SET lat=?, lon=?, track_km=?, speed=?, heading=?, accuracy=?, altitude=?, fix_at=?, updated_at=?, trail=?
      WHERE id=?`,
  ).bind(
    latest.lat, latest.lon, latest.trackKm, latest.speed, latest.heading,
    latest.accuracy, latest.altitude, latest.t, now, JSON.stringify(trail), id,
  ).run()

  return new Response(null, { status: 204 })
}
