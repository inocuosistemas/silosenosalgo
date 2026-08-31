/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { INVITE_RE } from '../../../shared/validate'
import { firstFreeColor } from '../../../shared/eventColors'
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
    'SELECT color FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(ev.id, user.id).first<{ color: string | null }>()
  // Volver a usar el código estando dentro no es un error: es lo que pasa
  // cuando alguien vuelve a tocar el enlace del grupo. Se entra y ya está.
  if (already) {
    const res: JoinEventResponse = { id: ev.id, color: already.color }
    return json(res, 200)
  }

  const taken = await env.DB.prepare(
    'SELECT color FROM event_members WHERE event_id = ? AND color IS NOT NULL',
  ).bind(ev.id).all<{ color: string }>()
  const color = firstFreeColor((taken.results ?? []).map((r) => r.color))

  const now = Date.now()
  try {
    await env.DB.prepare(
      'INSERT INTO event_members (event_id, user_id, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)',
    ).bind(ev.id, user.id, color, now, now).run()
  } catch {
    // Dos pestañas a la vez pueden pedir el mismo color libre: el índice único
    // lo impide y se entra sin color, que se elige después en el lobby.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO event_members (event_id, user_id, color, joined_at, last_seen) VALUES (?, ?, NULL, ?, ?)',
    ).bind(ev.id, user.id, now, now).run()
    const res: JoinEventResponse = { id: ev.id, color: null }
    return json(res, 201)
  }

  const res: JoinEventResponse = { id: ev.id, color }
  return json(res, 201)
}
