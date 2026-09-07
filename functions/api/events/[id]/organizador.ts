/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/organizador — nombrar (o quitar) a un organizador.
 *
 * En una carrera real hay más de una persona al cargo: quien reparte los
 * enlaces, quien va escribiendo en el tablón lo que la organización anuncia. Y
 * hasta ahora todo eso colgaba de una sola cuenta —la de quien creó el evento—
 * que además suele estar corriendo, con el móvil en el bolsillo y sin cobertura.
 *
 * Un organizador puede, DE MOMENTO: repartir el enlace de invitación y escribir
 * en el tablón. Nada de lo que toca la carrera en sí —el recorrido, la hora, el
 * cierre, borrarla— ni nombrar a otros organizadores: eso sigue siendo del
 * dueño, que es de quien cuelga el evento entero.
 *
 * Quién nombra: el DUEÑO del evento y quien administra la instalación. No un
 * organizador, que si no el permiso se propaga solo y nadie sabe ya quién dio
 * qué a quién.
 *
 * Body: `{ userId, organizer }`.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ userId?: unknown; organizer?: unknown }>(request)) || {}
  const target = typeof body.userId === 'string' && body.userId ? body.userId : null
  if (!target) return json({ error: 'bad_user' }, 400)
  const quiero = body.organizer === true

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy !== user.id && !user.isAdmin) return json({ error: 'forbidden' }, 403)
  // Al dueño no se le nombra ni se le quita: ya lo puede todo por ser el dueño,
  // y una marca que no cambia nada solo confunde a quien la ve.
  if (target === ev.createdBy) return json({ error: 'is_owner' }, 400)

  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, target).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE event_members SET organizer = ? WHERE event_id = ? AND user_id = ?')
    .bind(quiero ? 1 : 0, id, target).run()
  return new Response(null, { status: 204 })
}
