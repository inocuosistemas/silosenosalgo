/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/expulsa — sacar a alguien de la parrilla.
 *
 * Es el `leave` de otro, y hace exactamente lo mismo: se va su membresía —y con
 * ella su color, que queda libre— y su planificación personal de este evento.
 * Sus SESIONES DE SEGUIMIENTO no se borran, solo dejan de estar etiquetadas:
 * son suyas, con su traza, sus notas y sus ánimos, y siguen abiertas por su
 * enlace de siempre. Sacar a alguien de una lista no es borrarle la mañana.
 *
 * Quién puede: QUIEN ORGANIZA la carrera, que es quien tiene la lista de
 * inscritos delante, y quien administra la instalación. Nadie más: el código
 * del evento circula por grupos y una expulsión no puede estar al alcance de
 * cualquiera que se haya apuntado.
 *
 * A quién NO: a uno mismo —para eso está `leave`, que dice lo que hace— y a
 * quien organiza, que es de quien cuelga el evento entero; si quiere dejar de
 * figurar entre los que corren, se sale él.
 *
 * Y se van sus PRONÓSTICOS: los que hizo él sobre otros y los que otros
 * hicieron sobre él. Los suyos, porque la porra es de los que corren. Y los que
 * apuntaban a él porque ya no se pueden resolver: se quedarían "por decidir"
 * para siempre, esperando una llegada que no va a ocurrir. Un pronóstico
 * huérfano no es un recuerdo, es una cuenta que no cierra.
 *
 * Body: `{ userId }`.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ userId?: unknown }>(request)) || {}
  const target = typeof body.userId === 'string' && body.userId ? body.userId : null
  if (!target) return json({ error: 'bad_user' }, 400)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy !== user.id && !user.isAdmin) return json({ error: 'forbidden' }, 403)
  if (target === user.id) return json({ error: 'use_leave' }, 400)
  if (target === ev.createdBy) return json({ error: 'is_owner' }, 400)

  // Se comprueba que esté antes de tocar nada: nunca se ramifica sobre
  // `meta.changes`, que en producción no es de fiar.
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, target).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('DELETE FROM event_members WHERE event_id = ? AND user_id = ?')
    .bind(id, target).run()
  await env.DB.prepare('UPDATE tracking_sessions SET event_id = NULL WHERE event_id = ? AND owner_user_id = ?')
    .bind(id, target).run()
  // Sus pronósticos y los que le apuntaban. `target_id` guarda el id de quien
  // corre, y '' es la apuesta a la carrera entera —el ganador—, que no es de
  // nadie en particular y se queda.
  await env.DB.prepare('DELETE FROM event_bets WHERE event_id = ? AND (user_id = ? OR target_id = ?)')
    .bind(id, target, target).run()
  return new Response(null, { status: 204 })
}
