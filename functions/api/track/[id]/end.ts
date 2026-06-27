/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/end — owner stops sharing. Immediately nulls the last
 * fix + trail so a leaked link goes dark right away.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const res = await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, lat=NULL, lon=NULL, trail=NULL WHERE id=? AND owner_user_id=?",
  ).bind(Date.now(), id, user.id).run()

  if (!(res.meta?.changes ?? 0)) return json({ error: 'not_found' }, 404)
  return new Response(null, { status: 204 })
}
