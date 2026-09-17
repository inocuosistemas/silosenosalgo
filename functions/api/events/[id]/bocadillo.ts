/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, BOCADILLO_MAX } from '../../../../shared/validate'

/**
 * POST /api/events/:id/bocadillo — la frase que cada uno cuelga de su nombre
 * en la parrilla.
 *
 * A diferencia del dorsal o del emoji, esto lo escribe **cada uno el suyo y
 * nadie más**, ni siquiera quien organiza: un dorsal se reparte, pero lo que
 * uno quiere decir no se reparte. Por eso aquí no hay `userId` en el cuerpo.
 *
 * Body: `{ bocadillo }`. Cadena vacía o nula = quitarlo.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ bocadillo?: unknown }>(request)) || {}
  const raw = typeof body.bocadillo === 'string' ? body.bocadillo.trim() : ''
  if (raw.length > BOCADILLO_MAX) return json({ error: 'too_long' }, 400)
  // Los saltos de línea se aplastan: la burbuja es de una o dos líneas y un
  // texto con saltos la rompe sin que quien escribe llegue a verlo.
  const bocadillo = raw ? raw.replace(/\s+/g, ' ') : null

  // La pertenencia se comprueba antes y se repite en el WHERE: nunca se
  // ramifica sobre `meta.changes`, que en producción no es de fiar.
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, user.id).first<{ ok: number }>()
  if (!member) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE event_members SET bocadillo = ? WHERE event_id = ? AND user_id = ?')
    .bind(bocadillo, id, user.id).run()
  return new Response(null, { status: 204 })
}
