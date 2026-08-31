/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/leave — salirse de un evento.
 *
 * Se va la membresía (y con ella el color, que queda libre para otro) y la
 * planificación personal de ese evento. Las sesiones de seguimiento NO se
 * borran: son suyas, con su traza y sus notas, y siguen consultables por su
 * enlace; solo dejan de estar etiquetadas.
 *
 * El dueño del evento no puede salirse: le tocaría borrarlo o dejarlo huérfano
 * sin quien pueda editar la base ni regenerar el código.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy === user.id) return json({ error: 'forbidden' }, 403)

  await env.DB.prepare('DELETE FROM event_members WHERE event_id = ? AND user_id = ?')
    .bind(id, user.id).run()
  await env.DB.prepare('UPDATE tracking_sessions SET event_id = NULL WHERE event_id = ? AND owner_user_id = ?')
    .bind(id, user.id).run()
  return new Response(null, { status: 204 })
}
