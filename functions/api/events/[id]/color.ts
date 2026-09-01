/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { isEventColor } from '../../../../shared/eventColors'

/**
 * POST /api/events/:id/color — con qué color se pinta uno en el mapa.
 *
 * El color YA NO es el identificador: eso es el emoji, que sí es único. Aquí el
 * color separa grupos de un vistazo, así que puede repetirse —con cien
 * participantes y doce colores no queda otra— y dos personas en azul se
 * distinguen igual porque una es 🦊 y la otra 🐢.
 *
 * Dos formas de repartirlo, según el evento (`events.colors_locked`):
 *  · libre (por defecto): cada uno elige el suyo;
 *  · reservado: solo el organizador, porque ahí el color ya significa algo —el
 *    club, el relevo, la categoría— y no puede depender de que a alguien se le
 *    antoje cambiárselo la víspera.
 *
 * Body: `{ color }` para el propio, `{ color, userId }` para el de otro (solo el
 * organizador).
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ color?: unknown; userId?: unknown }>(request)
  // La paleta es cerrada (shared/eventColors.ts): un hex libre acabaría en
  // colores que no se leen sobre el mapa oscuro.
  if (!isEventColor(body?.color)) return json({ error: 'bad_color' }, 400)
  const color = body?.color as string

  const ev = await env.DB.prepare('SELECT created_by AS createdBy, colors_locked AS locked FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string; locked: number }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  const isOwner = ev.createdBy === user.id

  const target = typeof body?.userId === 'string' && body.userId ? body.userId : user.id
  if (target !== user.id && !isOwner) return json({ error: 'forbidden' }, 403)
  // Con los colores reservados, ni el propio: el reparto es del organizador.
  if (ev.locked && !isOwner) return json({ error: 'colors_locked' }, 403)

  const member = await env.DB.prepare(
    'SELECT color FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, target).first<{ color: string | null }>()
  if (!member) return json({ error: 'not_found' }, 404)
  if (member.color === color) return new Response(null, { status: 204 })

  await env.DB.prepare('UPDATE event_members SET color = ? WHERE event_id = ? AND user_id = ?')
    .bind(color, id, target).run()
  return new Response(null, { status: 204 })
}
