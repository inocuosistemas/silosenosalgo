/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/settings — los ajustes del evento que decide quien organiza.
 *
 * De momento uno solo: `{ colorsLocked }`. Con los colores reservados, el
 * reparto lo hace el organizador y los participantes no pueden cambiarse el
 * suyo; es lo que hace falta cuando el color significa algo (el club, el
 * relevo, la categoría) en vez de ser un gusto. Por defecto está suelto.
 *
 * Reservarlos NO revuelve lo ya elegido: cada uno se queda con el color que
 * tenía y el organizador cambia los que quiera. Quitar el candado tampoco
 * borra nada. Un ajuste que reorganizase el evento al tocarlo sería un ajuste
 * que nadie se atreve a tocar.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ colorsLocked?: unknown }>(request)) || {}
  if (typeof body.colorsLocked !== 'boolean') return json({ error: 'invalid_request' }, 400)

  // La propiedad se comprueba con un SELECT y se repite en el WHERE: nunca se
  // ramifica sobre `meta.changes`, que en producción no es de fiar.
  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy !== user.id) return json({ error: 'forbidden' }, 403)

  await env.DB.prepare('UPDATE events SET colors_locked = ? WHERE id = ? AND created_by = ?')
    .bind(body.colorsLocked ? 1 : 0, id, user.id).run()
  return new Response(null, { status: 204 })
}
