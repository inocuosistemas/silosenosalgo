/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import type { CreateEventResponse, EventsListResponse, EventInfo } from '../../../shared/wireTypes'
import { firstFreeColor } from '../../../shared/eventColors'

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

  const body = await readJson<{ name?: unknown; startsAt?: unknown }>(request)
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

  // Quien lo crea entra dentro: es el primer participante y casi siempre corre.
  // Si no corre, se sale — pero que el evento nazca vacío no ayuda a nadie.
  await env.DB.prepare(
    'INSERT INTO event_members (event_id, user_id, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, user.id, firstFreeColor([]), now, now).run()

  const res: CreateEventResponse = { id }
  return json(res, 201)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Los eventos en los que participo, no los que existen: un evento del que no
  // formas parte no es asunto tuyo aunque seas administrador del sitio.
  const rows = await env.DB.prepare(
    `SELECT e.id, e.name, e.plan_share_id AS planShareId, e.plan_name AS planName,
            e.photo_key AS photoKey, e.photo_at AS photoAt, e.starts_at AS startsAt,
            e.created_at AS createdAt, e.ended_at AS endedAt, e.created_by AS createdBy,
            e.invite_code AS inviteCode
       FROM events e JOIN event_members m ON m.event_id = e.id
      WHERE m.user_id = ?
      ORDER BY COALESCE(e.starts_at, e.created_at) DESC LIMIT 50`,
  ).bind(user.id).all<{
    id: string; name: string; planShareId: string | null; planName: string | null
    photoKey: string | null; photoAt: number | null; startsAt: number | null; createdAt: number
    endedAt: number | null; createdBy: string; inviteCode: string | null
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
      startsAt: r.startsAt,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      isOwner,
    }
    // El código solo al dueño: es la llave de entrada, y repartirla es una
    // decisión suya. Un participante que quiera invitar se lo pide.
    if (isOwner && r.inviteCode) info.inviteCode = r.inviteCode
    return info
  })
  const res: EventsListResponse = { events }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
