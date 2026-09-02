/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'
import { EVENT_TAIL_POINTS } from '../../../../shared/wireTypes'
import type {
  EventPublicResponse, EventPublicRunner, TrackFix, TrailPoint, EventRunnerStatus,
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
    `SELECT id, name, plan_share_id AS planShareId, tracking_url AS trackingUrl, website_url AS websiteUrl,
            starts_at AS startsAt, photo_key AS photoKey, photo_at AS photoAt, bets_enabled AS betsEnabled
       FROM events WHERE public_token = ?`,
  ).bind(token).first<{
    id: string; name: string; planShareId: string | null
    trackingUrl: string | null; websiteUrl: string | null
    startsAt: number | null; photoKey: string | null; photoAt: number | null; betsEnabled: number
  }>()
  // Mismo 404 para "no existe" y "ya no se comparte": un enlace revocado es un
  // enlace que no lleva a ningún sitio, y no hay nada que explicarle a quien lo
  // tenga guardado.
  if (!ev) return json({ error: 'not_found' }, 404)

  // Desde la PARRILLA, igual que en `/live`: quien espera en meta también
  // quiere ver al suyo antes de que empiece a emitir, y "no aparece" no puede
  // significar a la vez "no ha empezado" y "no corre". Publicar el evento ya
  // enseña a todos los participantes; esto no amplía a quién, solo deja de
  // esconder a quien todavía no ha abierto la baliza.
  const rows = await env.DB.prepare(
    `SELECT t.id AS sessionId, u.username AS username, m.color AS color, m.emoji AS emoji, m.bib AS bib,
            t.status, t.activity, t.started_at AS startedAt, t.updated_at AS updatedAt,
            t.lat, t.lon, t.track_km AS trackKm, t.speed, t.heading, t.accuracy,
            t.altitude, t.fix_at AS fixAt, t.trail
       FROM event_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN tracking_sessions t
              ON t.id = (SELECT t2.id FROM tracking_sessions t2
                          WHERE t2.event_id = m.event_id AND t2.owner_user_id = m.user_id
                          ORDER BY (t2.status = 'active') DESC,
                                   COALESCE(t2.updated_at, 0) DESC,
                                   t2.started_at DESC,
                                   t2.rowid DESC
                          LIMIT 1)
      WHERE m.event_id = ?
      ORDER BY u.username`,
  ).bind(ev.id).all<{
    sessionId: string | null
    username: string; color: string | null; emoji: string | null; bib: string | null
    status: string | null; activity: string | null
    startedAt: number | null; updatedAt: number | null
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
      emoji: r.emoji,
      bib: r.bib,
      // El id de sesión NO viaja —eso es la baliza de cada uno— pero sí sirve
      // aquí para saber si hay baliza siquiera: sin ella, `idle`.
      status: (r.sessionId === null ? 'idle' : r.status === 'ended' ? 'ended' : 'active') as EventRunnerStatus,
      activity: isBeaconActivity(r.activity) ? r.activity : null,
      fix,
      tail,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
    }
  })

  // El GET de la foto ya es público (el id del evento es inadivinable y un
  // cartel no es un secreto), así que aquí solo se arma la url —con su `?v=`,
  // que es lo que hace que un reencuadre llegue a todo el mundo—.
  const res: EventPublicResponse = {
    id: ev.id,
    name: ev.name,
    betsEnabled: ev.betsEnabled === 1,
    planShareId: ev.planShareId,
    startsAt: ev.startsAt,
    photoUrl: ev.photoKey
      ? `/api/events/${encodeURIComponent(ev.id)}/photo${ev.photoAt ? `?v=${ev.photoAt}` : ''}`
      : null,
    trackingUrl: ev.trackingUrl,
    websiteUrl: ev.websiteUrl,
    runners,
  }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
