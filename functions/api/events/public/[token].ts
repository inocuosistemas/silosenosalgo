/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'
import { EVENT_TAIL_POINTS } from '../../../../shared/wireTypes'
import type {
  EventPublicResponse, EventPublicRunner, TrackFix, TrailPoint, TrackStatus,
} from '../../../../shared/wireTypes'

/**
 * GET /api/events/public/:token — el evento para quien no participa.
 *
 * Sin sesión, como el visor de una baliza: quien espera en meta no tiene
 * cuenta ni tiene por qué hacerse una. El token es inadivinable y el
 * organizador puede revocarlo cuando quiera (ver `[id]/public.ts`).
 *
 * Lo que sale por aquí es un RECORTE del `/live` de los participantes: van los
 * nombres, los colores y las posiciones, y NO van los ids de cuenta ni los
 * tokens de las balizas individuales. Publicar el evento es cosa del
 * organizador; publicar la propia baliza es de cada uno, y esto no lo decide
 * por ellos.
 */

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = String(params.token)
  if (!TOKEN_RE.test(token)) return json({ error: 'bad_id' }, 400)

  const ev = await env.DB.prepare(
    'SELECT id, name, plan_share_id AS planShareId FROM events WHERE public_token = ?',
  ).bind(token).first<{ id: string; name: string; planShareId: string | null }>()
  // Mismo 404 para "no existe" y "ya no se comparte": un enlace revocado es un
  // enlace que no lleva a ningún sitio, y no hay nada que explicarle a quien lo
  // tenga guardado.
  if (!ev) return json({ error: 'not_found' }, 404)

  const rows = await env.DB.prepare(
    `SELECT u.username AS username, m.color AS color, t.status, t.activity,
            t.started_at AS startedAt, t.updated_at AS updatedAt,
            t.lat, t.lon, t.track_km AS trackKm, t.speed, t.heading, t.accuracy,
            t.altitude, t.fix_at AS fixAt, t.trail
       FROM tracking_sessions t
       JOIN event_members m ON m.event_id = t.event_id AND m.user_id = t.owner_user_id
       JOIN users u ON u.id = t.owner_user_id
      WHERE t.event_id = ?
        AND t.started_at = (SELECT MAX(t2.started_at) FROM tracking_sessions t2
                             WHERE t2.event_id = t.event_id AND t2.owner_user_id = t.owner_user_id)
      ORDER BY u.username`,
  ).bind(ev.id).all<{
    username: string; color: string | null; status: string; activity: string | null
    startedAt: number; updatedAt: number | null
    lat: number | null; lon: number | null; trackKm: number | null; speed: number | null
    heading: number | null; accuracy: number | null; altitude: number | null
    fixAt: number | null; trail: string | null
  }>()

  const runners: EventPublicRunner[] = (rows.results ?? []).map((r) => {
    const fix: TrackFix | null = r.lat !== null && r.lon !== null && r.updatedAt !== null
      ? {
          lat: r.lat, lon: r.lon, trackKm: r.trackKm, speed: r.speed, heading: r.heading,
          accuracy: r.accuracy, altitude: r.altitude, fixAt: r.fixAt, updatedAt: r.updatedAt,
        }
      : null
    let tail: TrailPoint[] = []
    if (r.trail) {
      try {
        const parsed = JSON.parse(r.trail) as TrailPoint[]
        if (Array.isArray(parsed)) tail = parsed.slice(-EVENT_TAIL_POINTS)
      } catch { tail = [] }
    }
    return {
      username: r.username,
      color: r.color,
      status: (r.status === 'ended' ? 'ended' : 'active') as TrackStatus,
      activity: isBeaconActivity(r.activity) ? r.activity : null,
      fix,
      tail,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
    }
  })

  const res: EventPublicResponse = { name: ev.name, planShareId: ev.planShareId, runners }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
