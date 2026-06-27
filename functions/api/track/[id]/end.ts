/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/end — owner stops sharing. Immediately nulls the last
 * fix + trail so a leaked link goes dark right away. Ownership is checked with
 * a SELECT (not meta.changes, which is unreliable on production D1).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, lat=NULL, lon=NULL, trail=NULL WHERE id=?",
  ).bind(Date.now(), id).run()
  return new Response(null, { status: 204 })
}
