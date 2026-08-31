/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { isEventColor } from '../../../../shared/eventColors'

/**
 * POST /api/events/:id/color — elegir con qué color se pinta uno en el mapa.
 *
 * El color es lo ÚNICO que distingue un punto de otro cuando hay diez personas
 * en el mismo mapa, así que dos participantes no pueden llevar el mismo. Lo
 * garantiza el índice único de la BD y no la interfaz: dos personas pueden
 * elegir el mismo color en el mismo segundo desde dos móviles, y ahí no hay
 * comprobación previa que valga.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ color?: unknown }>(request)
  // La paleta es cerrada (shared/eventColors.ts): un hex libre acabaría en
  // colores que no se leen sobre el mapa oscuro.
  if (!isEventColor(body?.color)) return json({ error: 'bad_color' }, 400)
  const color = body?.color as string

  const member = await env.DB.prepare(
    'SELECT color FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ color: string | null }>()
  if (!member) return json({ error: 'not_found' }, 404)
  if (member.color === color) return new Response(null, { status: 204 })

  try {
    await env.DB.prepare('UPDATE event_members SET color = ? WHERE event_id = ? AND user_id = ?')
      .bind(color, id, user.id).run()
  } catch {
    // Choque con el índice único: alguien se lo ha quedado antes. El cliente
    // refresca el lobby y ve el color ya ocupado.
    return json({ error: 'color_taken' }, 409)
  }
  return new Response(null, { status: 204 })
}
