/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { cierraEvento } from '../../../lib/eventStats'

/**
 * POST /api/events/:id/oficial — la hora de META OFICIAL de un participante,
 * la del cronometraje de la organización (al segundo).
 *
 * Body: `{ username, at }` (epoch ms) o `{ username, at: null }` para quitarla.
 *
 * Manda sobre la baliza y sobre el paso manual: cuando dos entran pegados, el
 * GPS no sabe quién llegó antes y la alfombra sí. Con la carrera cerrada, los
 * resultados y la porra se rehacen al momento.
 *
 * Solo quien organiza.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ username?: unknown; at?: unknown }>(request)) || {}
  if (typeof body.username !== 'string' || !body.username.trim()) return json({ error: 'invalid_request' }, 400)

  const ev = await env.DB.prepare('SELECT starts_at AS startsAt, ended_at AS endedAt, plan_total_km AS km FROM events WHERE id = ?')
    .bind(id).first<{ startsAt: number | null; endedAt: number | null; km: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  let at: number | null = null
  if (body.at !== null) {
    if (typeof body.at !== 'number' || !Number.isFinite(body.at) || body.at <= 0) return json({ error: 'invalid_request' }, 400)
    at = Math.round(body.at / 1000) * 1000
    // Ni antes de la salida ni en el futuro: es una llegada que ya ha ocurrido.
    if (ev.startsAt !== null && at <= ev.startsAt) return json({ error: 'invalid_request' }, 400)
    if (at > Date.now() + 5 * 60_000) return json({ error: 'invalid_request' }, 400)
  }

  const fila = await env.DB.prepare(
    `SELECT m.user_id AS userId FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = ? AND u.username = ?`,
  ).bind(id, body.username.trim()).first<{ userId: string }>()
  if (!fila) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE event_members SET oficial_meta_at = ? WHERE event_id = ? AND user_id = ?')
    .bind(at, id, fila.userId).run()
  if (ev.endedAt) await cierraEvento(env, id, ev.endedAt, ev.km)
  return new Response(null, { status: 204 })
}
