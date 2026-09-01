/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import type { CreateEventResponse, EventsListResponse, EventInfo } from '../../../shared/wireTypes'
import { assignColor, isEventColor } from '../../../shared/eventColors'
import { EMOJI_POOL, emojiOk, foldEmoji } from '../../../shared/emoji'

/**
 * Eventos: una carrera compartida por varios participantes.
 *   POST /api/events → crea uno (solo admin), devuelve { id }.
 *   GET  /api/events → los eventos en los que estoy (creados o unido).
 *
 * Crear queda restringido a administradores a propósito: un evento reparte un
 * código de unión y agrupa las posiciones de varias personas, así que es una
 * decisión de organización, no algo que cada cuenta genere por su cuenta.
 * Unirse, en cambio, lo hace cualquiera con el código.
 */

const NAME_MAX = 80

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const body = await readJson<{ name?: unknown; startsAt?: unknown; join?: unknown }>(request)
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : ''
  if (!name) return json({ error: 'invalid_request' }, 400)
  const startsAt = typeof body?.startsAt === 'number' && Number.isFinite(body.startsAt)
    ? Math.round(body.startsAt)
    : null

  const now = Date.now()
  // 16 bytes como los tokens de seguimiento, y por el mismo motivo: el enlace
  // del evento circula por chats y no puede adivinarse. El código de unión es
  // aparte (12) porque se teclea y se pega a mano.
  const id = genId(16)
  const inviteCode = genId(12)
  await env.DB.prepare(
    'INSERT INTO events (id, created_by, name, invite_code, starts_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, user.id, name, inviteCode, startsAt, now).run()

  // Quien lo crea entra dentro POR DEFECTO: casi siempre corre, y que el evento
  // nazca vacío no ayudaría a nadie. Pero organizar y correr no son lo mismo —y
  // como solo un administrador puede crear eventos, obligarle a figurar en la
  // lista de participantes de cada carrera que monta era falsear quién corre—,
  // así que `join: false` crea el evento sin apuntarse. Se puede apuntar
  // después con el código, y salirse sin dejar de organizar (ver leave.ts).
  const join = body?.join !== false
  if (join) {
    // Y entra con su marca favorita, que en un evento recién hecho está libre
    // por definición.
    const fav = await env.DB.prepare('SELECT fav_emoji AS favEmoji, fav_color AS favColor FROM users WHERE id = ?')
      .bind(user.id).first<{ favEmoji: string | null; favColor: string | null }>()
    const emoji = fav?.favEmoji && emojiOk(fav.favEmoji) ? fav.favEmoji : EMOJI_POOL[0]
    await env.DB.prepare(
      'INSERT INTO event_members (event_id, user_id, color, emoji, emoji_key, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, user.id, isEventColor(fav?.favColor) ? fav!.favColor : assignColor([]), emoji, foldEmoji(emoji), now, now).run()
  }

  const res: CreateEventResponse = { id }
  return json(res, 201)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Los eventos en los que participo, no los que existen: un evento del que no
  // formas parte no es asunto tuyo aunque seas administrador del sitio.
  //
  // `?organising=1` añade además los que YO organizo sin correrlos. Es opcional
  // y no el comportamiento por defecto a propósito: las apps del móvil piden
  // esta lista para saber a qué carrera atribuir la baliza, y ahí un evento que
  // no corro no pinta nada —emitir para él lo rechaza `beacon.ts`, que exige
  // ser participante—. La web sí lo pide, porque necesita poder entrar a
  // organizarlo.
  const organising = new URL(request.url).searchParams.get('organising') === '1'
  const rows = await env.DB.prepare(
    `SELECT e.id, e.name, e.plan_share_id AS planShareId, e.plan_name AS planName,
            e.photo_key AS photoKey, e.photo_at AS photoAt, e.starts_at AS startsAt,
            e.created_at AS createdAt, e.ended_at AS endedAt, e.created_by AS createdBy,
            e.invite_code AS inviteCode, e.public_token AS publicToken, e.colors_locked AS colorsLocked,
            e.bets_enabled AS betsEnabled,
            m.emoji AS myEmoji, m.color AS myColor, m.user_id IS NOT NULL AS isMember
       FROM events e LEFT JOIN event_members m ON m.event_id = e.id AND m.user_id = ?
      WHERE m.user_id IS NOT NULL ${organising ? 'OR e.created_by = ?' : ''}
      ORDER BY COALESCE(e.starts_at, e.created_at) DESC LIMIT 50`,
  ).bind(...(organising ? [user.id, user.id] : [user.id])).all<{
    id: string; name: string; planShareId: string | null; planName: string | null
    photoKey: string | null; photoAt: number | null; startsAt: number | null; createdAt: number
    endedAt: number | null; createdBy: string; inviteCode: string | null; publicToken: string | null
    colorsLocked: number; betsEnabled: number; myEmoji: string | null; myColor: string | null; isMember: number
  }>()

  const events: EventInfo[] = (rows.results ?? []).map((r) => {
    const isOwner = r.createdBy === user.id
    const info: EventInfo = {
      id: r.id,
      name: r.name,
      planShareId: r.planShareId,
      planName: r.planName,
      hasPhoto: r.photoKey !== null,
      photoAt: r.photoAt,
      colorsLocked: !!r.colorsLocked,
      betsEnabled: !!r.betsEnabled,
      // La marca de QUIEN PREGUNTA en cada evento. Va en la lista y no solo en
      // la parrilla porque las apps del móvil no tienen parrilla: es lo único
      // que necesitan para enseñarte, antes de salir, con qué te van a ver los
      // demás. Es dato propio, no de los demás: la lista sigue sin contar quién
      // más está dentro.
      myEmoji: r.myEmoji,
      myColor: r.myColor,
      isMember: !!r.isMember,
      startsAt: r.startsAt,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      isOwner,
    }
    // El código solo al dueño: es la llave de entrada, y repartirla es una
    // decisión suya. Un participante que quiera invitar se lo pide. Lo mismo
    // con el enlace público: publicarlo o no es decisión del organizador.
    if (isOwner) {
      if (r.inviteCode) info.inviteCode = r.inviteCode
      info.publicToken = r.publicToken
    }
    return info
  })
  const res: EventsListResponse = { events }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
