/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, BIB_RE } from '../../../../shared/validate'

/**
 * POST /api/events/:id/bib — el dorsal de la carrera.
 *
 * Cada uno pone el suyo, y el ORGANIZADOR el de cualquiera: los dorsales se
 * reparten todos juntos en la recogida, y quien los tiene delante en una lista
 * es quien organiza. Sin eso, un evento de treinta personas se convierte en
 * treinta recordatorios de "ponte el dorsal en la app".
 *
 * Body: `{ bib }` para el propio, `{ bib, userId }` para el de otro (solo el
 * organizador). Cadena vacía o nula = quitarlo.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ bib?: unknown; userId?: unknown }>(request)) || {}
  const raw = typeof body.bib === 'string' ? body.bib.trim() : ''
  // Vacío = quitar. Con contenido, tiene que parecer un dorsal: es un dato que
  // ven los demás y que la organización usa para identificarte.
  if (raw && !BIB_RE.test(raw)) return json({ error: 'bad_bib' }, 400)
  const bib = raw || null

  const target = typeof body.userId === 'string' && body.userId ? body.userId : user.id
  if (target !== user.id) {
    const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
      .bind(id).first<{ createdBy: string }>()
    if (!ev || ev.createdBy !== user.id) return json({ error: 'forbidden' }, 403)
  }

  // La propiedad se comprueba antes y se repite en el WHERE: nunca se ramifica
  // sobre `meta.changes`, que en producción no es de fiar.
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, target).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE event_members SET bib = ? WHERE event_id = ? AND user_id = ?')
    .bind(bib, id, target).run()
  return new Response(null, { status: 204 })
}
