/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { cierraEvento } from '../../../lib/eventStats'

/**
 * POST /api/events/:id/retirado — dar a alguien por retirado, a mano.
 *
 * La detección automática solo puede mirar lo que llega, y lo que llega miente
 * a veces: una baliza sin cobertura tres horas se parece mucho a una que se ha
 * bajado. Por eso esa regla es prudente y se calla en cuanto hay duda —dar por
 * retirado a quien sigue en el monte es el peor error que puede cometer esto,
 * porque su gente lo lee—.
 *
 * Quien organiza sí lo sabe: se lo ha dicho el corredor por teléfono, o lo ha
 * visto subir a la furgoneta. Esto es esa vía. Manda sobre la traza.
 *
 * Body: `{ username, at? }` para marcarlo —`at` en epoch ms, y si no viene, la
 * hora de ahora— y `{ username, at: null }` para deshacerlo. Lo segundo importa
 * tanto como lo primero: alguien se marca por error y tiene que poder volver a
 * la carrera sin que quede rastro.
 *
 * También puede MARCARSE UNO MISMO. Es la forma más honesta de bajarse: la
 * baliza se apaga cuando uno se acuerda —en el coche, al día siguiente— y esto
 * dice a qué hora se dejó de verdad.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ username?: unknown; at?: unknown }>(request)) || {}
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  if (!username) return json({ error: 'invalid_request' }, 400)

  // `at` ausente = ahora. `at: null` = deshacerlo. Un número = esa hora, que es
  // lo que permite decir "se bajó a las once" tres horas después.
  const quitar = body.at === null
  let at: number | null = null
  if (!quitar) {
    if (body.at === undefined) at = Date.now()
    else if (typeof body.at === 'number' && Number.isFinite(body.at) && body.at > 0) at = Math.round(body.at)
    else return json({ error: 'invalid_request' }, 400)
  }

  const ev = await env.DB.prepare(
    'SELECT starts_at AS startsAt, ended_at AS endedAt, plan_total_km AS km FROM events WHERE id = ?',
  ).bind(id).first<{ startsAt: number | null; endedAt: number | null; km: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  // Nadie se retira antes de salir: una hora anterior al pistoletazo no es un
  // abandono, es un dedo que se ha equivocado de día.
  if (at !== null && ev.startsAt !== null && at < ev.startsAt) return json({ error: 'invalid_request' }, 400)

  const fila = await env.DB.prepare(
    `SELECT m.user_id AS userId FROM event_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.event_id = ? AND u.username = ?`,
  ).bind(id, username).first<{ userId: string }>()
  if (!fila) return json({ error: 'not_found' }, 404)

  // Uno mismo siempre; a otro, solo quien organiza.
  if (fila.userId !== user.id && !(await puedeOrganizar(env, id, user))) {
    return json({ error: 'forbidden' }, 403)
  }

  await env.DB.prepare('UPDATE event_members SET retired_at = ? WHERE event_id = ? AND user_id = ?')
    .bind(at, id, fila.userId).run()

  // Si la carrera ya está cerrada, sus resultados se congelaron sin esto. Se
  // rehacen: marcar un abandono que no cambia la clasificación no sirve de nada.
  if (ev.endedAt) await cierraEvento(env, id, ev.endedAt, ev.km)

  return new Response(null, { status: 204 })
}
