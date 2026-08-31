/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'
import { EVENT_TAIL_POINTS } from '../../../../shared/wireTypes'
import type {
  EventLiveResponse, EventLiveRunner, TrackFix, TrailPoint, TrackStatus,
} from '../../../../shared/wireTypes'

/**
 * GET /api/events/:id/live — dónde está cada participante, de una vez.
 *
 * Una sola consulta para todo el evento en vez de que el mapa pregunte por
 * cada baliza: con veinte participantes serían veinte peticiones cada diez
 * segundos, y el visor ya tiene bastante con una.
 *
 * Solo para MIEMBROS. La posición de alguien es suya, y compartirla con el
 * evento no es publicarla en abierto: quien no está dentro no la ve. (El enlace
 * individual de cada baliza sí es público, pero eso lo decide cada uno al
 * repartirlo, que no es lo mismo.)
 *
 * Devuelve la COLA de cada traza, no la traza entera: en el mapa común la traza
 * es contexto —por dónde viene, hacia dónde va—, y el recorrido completo está a
 * un toque en su baliza individual.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT plan_share_id AS planShareId FROM events WHERE id = ?')
    .bind(id).first<{ planShareId: string | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  // Pertenecer es la condición para ver. 404 y no 403: quien no está dentro
  // tampoco tiene por qué saber que ese evento existe.
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  // La sesión MÁS RECIENTE de cada participante en este evento, esté activa o
  // terminada: quien ya ha llegado a meta sigue siendo parte de la carrera y su
  // último punto es justo lo que quieren ver los demás. El GROUP BY sobre
  // started_at máximo evita que una sesión reabierta duplique al corredor.
  const rows = await env.DB.prepare(
    `SELECT t.id, t.owner_user_id AS userId, u.username AS username, m.color AS color, m.bib AS bib,
            t.status, t.activity, t.started_at AS startedAt, t.updated_at AS updatedAt,
            t.lat, t.lon, t.track_km AS trackKm, t.speed, t.heading, t.accuracy,
            t.altitude, t.fix_at AS fixAt, t.trail
       FROM tracking_sessions t
       JOIN event_members m ON m.event_id = t.event_id AND m.user_id = t.owner_user_id
       JOIN users u ON u.id = t.owner_user_id
      WHERE t.event_id = ?
        AND t.started_at = (SELECT MAX(t2.started_at) FROM tracking_sessions t2
                             WHERE t2.event_id = t.event_id AND t2.owner_user_id = t.owner_user_id)
      ORDER BY u.username`,
  ).bind(id).all<{
    id: string; userId: string; username: string; color: string | null; bib: string | null
    status: string; activity: string | null; startedAt: number; updatedAt: number | null
    lat: number | null; lon: number | null; trackKm: number | null; speed: number | null
    heading: number | null; accuracy: number | null; altitude: number | null
    fixAt: number | null; trail: string | null
  }>()

  const runners: EventLiveRunner[] = (rows.results ?? []).map((r) => {
    const fix: TrackFix | null = r.lat !== null && r.lon !== null && r.updatedAt !== null
      ? {
          lat: r.lat, lon: r.lon, trackKm: r.trackKm, speed: r.speed, heading: r.heading,
          accuracy: r.accuracy, altitude: r.altitude, fixAt: r.fixAt, updatedAt: r.updatedAt,
        }
      : null
    let tail: TrailPoint[] = []
    if (r.trail) {
      // Una traza ilegible no puede tumbar el mapa de los demás: se degrada a
      // vacío y ese corredor sale como un punto sin cola.
      try {
        const parsed = JSON.parse(r.trail) as TrailPoint[]
        if (Array.isArray(parsed)) tail = parsed.slice(-EVENT_TAIL_POINTS)
      } catch { tail = [] }
    }
    return {
      userId: r.userId,
      username: r.username,
      color: r.color,
      bib: r.bib,
      sessionId: r.id,
      status: (r.status === 'ended' ? 'ended' : 'active') as TrackStatus,
      activity: isBeaconActivity(r.activity) ? r.activity : null,
      fix,
      tail,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
    }
  })

  const res: EventLiveResponse = { planShareId: ev.planShareId, runners }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
