/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/rename — owner relabels a session so it stays
 * identifiable later in "Mis seguimientos" (paired with the "chincheta" to keep
 * it around). Body: `{ title: string }`; a blank title clears the name (stored
 * NULL → shown as "Sin nombre"). Same 80-char cap as create. Ownership is
 * checked with a SELECT (meta.changes is unreliable on production D1).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ title?: string }>(request)) || {}
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.slice(0, 80).trim() : null

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE tracking_sessions SET title=? WHERE id=? AND owner_user_id=?')
    .bind(title, id, user.id).run()
  return new Response(null, { status: 204 })
}
