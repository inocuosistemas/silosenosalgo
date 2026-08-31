/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/beacon — "estoy corriendo esto".
 *
 * Une al evento la baliza que YA se está emitiendo, en vez de exigir que se
 * empiece a compartir desde dentro del evento. Es lo que hace que un evento
 * funcione con las apps tal y como están hoy: se sale a correr como siempre y
 * desde el lobby se dice a qué carrera pertenece esta salida. (Cuando las apps
 * nativas manden el evento al crear la sesión, este botón seguirá valiendo para
 * quien se acuerde a mitad de camino, que es lo normal.)
 *
 * Con `{ attach: false }` se deshace: la sesión sigue siendo suya, con su traza
 * y su enlace, y solo deja de aparecer en el mapa del evento.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ attach?: unknown }>(request)) || {}
  const attach = body.attach !== false

  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  if (!attach) {
    await env.DB.prepare('UPDATE tracking_sessions SET event_id = NULL WHERE event_id = ? AND owner_user_id = ?')
      .bind(id, user.id).run()
    return new Response(null, { status: 204 })
  }

  // La sesión viva del usuario. El backend ya garantiza que solo hay una activa
  // por cuenta (crear una cierra la anterior), así que "la más reciente" es
  // exactamente la que se está emitiendo.
  const now = Date.now()
  const sess = await env.DB.prepare(
    `SELECT id, plan_share_id AS planShareId FROM tracking_sessions
      WHERE owner_user_id = ? AND status = 'active' AND expires_at > ?
      ORDER BY started_at DESC LIMIT 1`,
  ).bind(user.id, now).first<{ id: string; planShareId: string | null }>()
  if (!sess) return json({ error: 'no_session' }, 409)

  const ev = await env.DB.prepare('SELECT plan_share_id AS planShareId, plan_name AS planName FROM events WHERE id = ?')
    .bind(id).first<{ planShareId: string | null; planName: string | null }>()

  // Si la baliza salió sin ruta, hereda la del evento: quien te sigue por tu
  // enlace individual verá el recorrido de la carrera y tus cortes, no un
  // trazado suelto. Si ya llevaba una, no se toca — puede ser su planificación
  // personal, y eso es suyo.
  if (ev?.planShareId && !sess.planShareId) {
    await env.DB.prepare(
      'UPDATE tracking_sessions SET event_id = ?, plan_share_id = ?, plan_name = ? WHERE id = ? AND owner_user_id = ?',
    ).bind(id, ev.planShareId, ev.planName, sess.id, user.id).run()
  } else {
    await env.DB.prepare('UPDATE tracking_sessions SET event_id = ? WHERE id = ? AND owner_user_id = ?')
      .bind(id, sess.id, user.id).run()
  }
  return json({ sessionId: sess.id }, 200)
}
