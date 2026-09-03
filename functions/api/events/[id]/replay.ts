/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { construyeReplay } from '../../../lib/replay'

/**
 * GET /api/events/:id/replay — la carrera entera, para verla otra vez.
 *
 * Solo para miembros, como el mapa en directo: las posiciones de alguien son
 * suyas y que la carrera haya terminado no las hace públicas.
 *
 * Se pide UNA vez y se guarda en el navegador de quien lo mira; por eso puede
 * traer trazas enteras donde el directo solo manda la cola.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member && ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  return json(await construyeReplay(env, id), 200, { 'Cache-Control': 'no-store' })
}
