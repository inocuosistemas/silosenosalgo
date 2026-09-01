/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { INVITE_RE } from '../../../shared/validate'
import { assignColor, isEventColor } from '../../../shared/eventColors'
import { emojiOk, firstFreeEmoji, foldEmoji } from '../../../shared/emoji'
import type { JoinEventResponse } from '../../../shared/wireTypes'

/**
 * POST /api/events/join — unirse a un evento con su código.
 *
 * El código es MULTIUSO, al revés que las invitaciones de cuenta: se pega una
 * vez en el grupo del club y lo usan los treinta. Por eso aquí sí hace falta
 * un freno: un código multiuso es adivinable a base de fuerza bruta de una
 * forma que uno de un solo uso no lo es.
 *
 * Unirse exige tener cuenta. El alta sigue siendo por invitación de
 * administrador, así que quien llega con el código y sin cuenta primero se
 * registra y luego entra.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ code?: unknown }>(request)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!INVITE_RE.test(code)) return json({ error: 'invalid_request' }, 400)

  // Freno por cuenta, no por IP: la IP de un club entero es la misma y no
  // queremos que el primero que entra deje fuera a los demás.
  if (await rateLimited(env, `evjoin:${user.id}`, 20, 600)) return json({ error: 'rate_limited' }, 429)
  if (await rateLimited(env, `evjoinip:${clientIp(request)}`, 60, 600)) return json({ error: 'rate_limited' }, 429)

  const ev = await env.DB.prepare('SELECT id, ended_at AS endedAt FROM events WHERE invite_code = ?')
    .bind(code).first<{ id: string; endedAt: number | null }>()
  // Mismo error para "no existe" y "caducado" que en el registro: un código que
  // ya no vale es un código que ya no vale.
  if (!ev) return json({ error: 'invalid_invite' }, 410)
  if (ev.endedAt !== null) return json({ error: 'ended' }, 410)

  const already = await env.DB.prepare(
    'SELECT color, emoji FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(ev.id, user.id).first<{ color: string | null; emoji: string | null }>()
  // Volver a usar el código estando dentro no es un error: es lo que pasa
  // cuando alguien vuelve a tocar el enlace del grupo. Se entra y ya está.
  if (already) {
    const res: JoinEventResponse = { id: ev.id, color: already.color, emoji: already.emoji }
    return json(res, 200)
  }

  // Se entra con la MARCA FAVORITA de la cuenta: quien es 🦊 en su club quiere
  // ser 🦊 en todas las carreras, y elegirlo otra vez en cada evento es el
  // trámite que se salta la gente. El color siempre se puede (repetirlo está
  // permitido); el emoji solo si nadie lo lleva ya en este evento.
  const fav = await env.DB.prepare('SELECT fav_emoji AS favEmoji, fav_color AS favColor FROM users WHERE id = ?')
    .bind(user.id).first<{ favEmoji: string | null; favColor: string | null }>()

  const taken = await env.DB.prepare(
    'SELECT color, emoji_key AS emojiKey FROM event_members WHERE event_id = ?',
  ).bind(ev.id).all<{ color: string | null; emojiKey: string | null }>()
  const rows = taken.results ?? []
  const takenColors = rows.map((r) => r.color).filter((c): c is string => !!c)
  const takenEmojis = rows.map((r) => r.emojiKey).filter((k): k is string => !!k)

  const color = isEventColor(fav?.favColor) ? (fav!.favColor as string) : assignColor(takenColors)
  const favEmoji = fav?.favEmoji && emojiOk(fav.favEmoji) ? fav.favEmoji : null
  const favLibre = favEmoji !== null && !takenEmojis.includes(foldEmoji(favEmoji))
  // Si el favorito está pillado se entra con otro del repertorio, no sin marca:
  // llegar al lobby ya identificado y cambiarlo si apetece es mejor que llegar
  // en gris con un deber pendiente.
  const emoji = favLibre ? favEmoji : firstFreeEmoji(takenEmojis)
  const emojiTaken = favEmoji !== null && !favLibre

  const now = Date.now()
  const key = emoji ? foldEmoji(emoji) : null
  try {
    await env.DB.prepare(
      'INSERT INTO event_members (event_id, user_id, color, emoji, emoji_key, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(ev.id, user.id, color, emoji, key, now, now).run()
  } catch {
    // Dos personas entrando a la vez pueden pedir el mismo emoji libre: el
    // índice único lo impide y se entra sin marca, que se elige en el lobby.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO event_members (event_id, user_id, color, emoji, emoji_key, joined_at, last_seen) VALUES (?, ?, ?, NULL, NULL, ?, ?)',
    ).bind(ev.id, user.id, color, now, now).run()
    const res: JoinEventResponse = { id: ev.id, color, emoji: null, emojiTaken: true }
    return json(res, 201)
  }

  const res: JoinEventResponse = { id: ev.id, color, emoji, ...(emojiTaken ? { emojiTaken: true } : {}) }
  return json(res, 201)
}
