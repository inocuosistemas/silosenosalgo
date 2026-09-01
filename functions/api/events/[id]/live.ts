/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'
import { EVENT_TAIL_POINTS } from '../../../../shared/wireTypes'
import type {
  EventLiveResponse, EventLiveRunner, TrackFix, TrailPoint, EventRunnerStatus,
} from '../../../../shared/wireTypes'

/**
 * GET /api/events/:id/live — dónde está cada participante, de una vez.
 *
 * Van TODOS los de la parrilla, emitan o no: el mapa distingue a quien no ha
 * empezado de quien no está en la carrera, que es media pregunta antes de la
 * salida.
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

  const ev = await env.DB.prepare(
    'SELECT plan_share_id AS planShareId, starts_at AS startsAt, created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ planShareId: string | null; startsAt: number | null; createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  // Pertenecer es la condición para ver. 404 y no 403: quien no está dentro
  // tampoco tiene por qué saber que ese evento existe. Salvo quien lo organiza,
  // que puede no correr: seguir la carrera que ha montado es media razón de
  // haberla montado.
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member && ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  // Se sale de la PARRILLA y no de las sesiones: quien está apuntado sale
  // aunque no haya emitido nunca (LEFT JOIN, sesión a null). Antes el mapa
  // solo conocía a quien había abierto una baliza, así que media carrera
  // desaparecía de la pantalla justo cuando lo que se pregunta es "¿ya está
  // emitiendo el mío?" — y no salir era indistinguible de no participar.
  //
  // De cada uno, su sesión MÁS RECIENTE, esté activa o terminada: quien ya ha
  // llegado a meta sigue siendo parte de la carrera y su último punto es justo
  // lo que quieren ver los demás. El filtro por started_at máximo evita que una
  // sesión reabierta duplique al corredor.
  const rows = await env.DB.prepare(
    `SELECT t.id, m.user_id AS userId, u.username AS username, m.color AS color, m.emoji AS emoji, m.bib AS bib,
            t.status, t.activity, t.started_at AS startedAt, t.updated_at AS updatedAt,
            t.lat, t.lon, t.track_km AS trackKm, t.speed, t.heading, t.accuracy,
            t.altitude, t.fix_at AS fixAt, t.trail
       FROM event_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN tracking_sessions t
              ON t.event_id = m.event_id AND t.owner_user_id = m.user_id
             AND t.started_at = (SELECT MAX(t2.started_at) FROM tracking_sessions t2
                                  WHERE t2.event_id = m.event_id AND t2.owner_user_id = m.user_id)
      WHERE m.event_id = ?
      ORDER BY u.username`,
  ).bind(id).all<{
    id: string | null; userId: string; username: string; color: string | null; emoji: string | null; bib: string | null
    status: string | null; activity: string | null; startedAt: number | null; updatedAt: number | null
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
      emoji: r.emoji,
      bib: r.bib,
      sessionId: r.id,
      // Sin sesión no hay estado que traducir: está en la parrilla y no ha
      // emitido, que es un tercer estado y no una variante de "activo".
      status: (r.id === null ? 'idle' : r.status === 'ended' ? 'ended' : 'active') as EventRunnerStatus,
      activity: isBeaconActivity(r.activity) ? r.activity : null,
      fix,
      tail,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
    }
  })

  const res: EventLiveResponse = { planShareId: ev.planShareId, startsAt: ev.startsAt, runners }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
