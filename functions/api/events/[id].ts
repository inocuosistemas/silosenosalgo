/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { TOKEN_RE } from '../../../shared/validate'
import type { EventDetailResponse, EventInfo, EventMember } from '../../../shared/wireTypes'

/**
 * El lobby de un evento.
 *   GET    /api/events/:id → evento + participantes (solo miembros).
 *   DELETE /api/events/:id → borrarlo (solo quien lo creó).
 *
 * Mirar el lobby cuenta como presencia: se refresca `last_seen` del que
 * consulta, igual que `session_viewers` hace con los seguidores de una baliza.
 * Sin cron que limpie nada: quien no vuelve, deja de estar "conectado" solo.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare(
    `SELECT id, name, plan_share_id AS planShareId, plan_name AS planName, photo_key AS photoKey,
            photo_at AS photoAt, starts_at AS startsAt, created_at AS createdAt, colors_locked AS colorsLocked,
            ended_at AS endedAt, created_by AS createdBy, invite_code AS inviteCode, public_token AS publicToken,
            tracking_url AS trackingUrl, website_url AS websiteUrl
       FROM events WHERE id = ?`,
  ).bind(id).first<{
    id: string; name: string; planShareId: string | null; planName: string | null
    photoKey: string | null; photoAt: number | null; startsAt: number | null; createdAt: number; colorsLocked: number
    endedAt: number | null; createdBy: string; inviteCode: string | null; publicToken: string | null
    trackingUrl: string | null; websiteUrl: string | null
  }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  // Pertenecer es la condición para ver: un evento del que no formas parte
  // responde 404 y no 403, para no confirmar que ese id existe.
  const me = await env.DB.prepare(
    'SELECT color, plan_overlay AS planOverlay FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ color: string | null; planOverlay: string | null }>()
  if (!me) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  await env.DB.prepare('UPDATE event_members SET last_seen = ? WHERE event_id = ? AND user_id = ?')
    .bind(now, id, user.id).run()

  // Una sola consulta para los participantes y su sesión activa en el evento:
  // el LEFT JOIN trae el token público de quien está emitiendo ahora mismo, que
  // es lo que convierte un nombre del lobby en un punto del mapa.
  const rows = await env.DB.prepare(
    `SELECT m.user_id AS userId, u.username AS username, m.color AS color, m.bib AS bib,
            m.emoji AS emoji, m.emoji_key AS emojiKey, m.joined_at AS joinedAt, m.last_seen AS lastSeen,
            m.plan_overlay IS NOT NULL AS hasPlan,
            (SELECT t.id FROM tracking_sessions t
              WHERE t.event_id = m.event_id AND t.owner_user_id = m.user_id
                AND t.status = 'active' AND t.expires_at > ?
              ORDER BY t.started_at DESC LIMIT 1) AS sessionId
       FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = ?
      ORDER BY m.joined_at ASC`,
  ).bind(now, id).all<{
    userId: string; username: string; color: string | null; bib: string | null
    emoji: string | null; emojiKey: string | null
    joinedAt: number; lastSeen: number | null; hasPlan: number; sessionId: string | null
  }>()

  const members: EventMember[] = (rows.results ?? []).map((r) => ({
    userId: r.userId,
    username: r.username,
    color: r.color,
    emoji: r.emoji,
    bib: r.bib,
    joinedAt: r.joinedAt,
    lastSeen: r.lastSeen,
    hasPlan: !!r.hasPlan,
    sessionId: r.sessionId,
  }))

  const isOwner = ev.createdBy === user.id
  const event: EventInfo = {
    id: ev.id,
    name: ev.name,
    planShareId: ev.planShareId,
    planName: ev.planName,
    hasPhoto: ev.photoKey !== null,
    photoAt: ev.photoAt,
    // Los enlaces oficiales los ve todo el mundo: son de la carrera. Ponerlos,
    // solo el organizador (ver links.ts).
    trackingUrl: ev.trackingUrl,
    websiteUrl: ev.websiteUrl,
    colorsLocked: !!ev.colorsLocked,
    startsAt: ev.startsAt,
    createdAt: ev.createdAt,
    endedAt: ev.endedAt,
    isOwner,
  }
  if (isOwner) {
    if (ev.inviteCode) event.inviteCode = ev.inviteCode
    event.publicToken = ev.publicToken
  }

  const res: EventDetailResponse = {
    event,
    members,
    // Lo que llevan LOS OTROS; lo propio no, que si no el selector saldría sin
    // nada marcado. Los colores solo avisan de con quién se va a coincidir
    // (repetir se puede); los emojis, plegados, sí están vetados.
    takenColors: members.filter((m) => m.userId !== user.id && m.color).map((m) => m.color as string),
    takenEmojis: (rows.results ?? [])
      .filter((r) => r.userId !== user.id && r.emojiKey)
      .map((r) => r.emojiKey as string),
    myPlanOverlay: me.planOverlay,
  }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // La propiedad se comprueba con un SELECT y se repite en el WHERE: nunca se
  // ramifica sobre `meta.changes`, que en producción no es de fiar.
  const ev = await env.DB.prepare('SELECT created_by AS createdBy, photo_key AS photoKey FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string; photoKey: string | null }>()
  if (!ev || ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('DELETE FROM events WHERE id = ? AND created_by = ?').bind(id, user.id).run()
  // Las membresías caen por ON DELETE CASCADE. Las sesiones de los
  // participantes NO se tocan: son suyas, con sus notas y sus enlaces, y
  // sobreviven al evento; solo se quedan sin etiqueta.
  await env.DB.prepare('UPDATE tracking_sessions SET event_id = NULL WHERE event_id = ?').bind(id).run()
  if (ev.photoKey) await env.SHARE_KV.delete(ev.photoKey)
  // El blob del plan base se queda en KV hasta que caduque solo: puede estar
  // referenciado por las sesiones que ya arrancaron con él.
  return new Response(null, { status: 204 })
}
