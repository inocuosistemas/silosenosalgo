/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/pin — owner toggles the "chincheta". A pinned session is
 * kept indefinitely: the lazy purge on the public read path skips it, so the
 * route + last position stay viewable regardless of the retain-hours expiry.
 * Body: `{ pinned: boolean }`. Ownership is checked with a SELECT (meta.changes
 * is unreliable on production D1).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ pinned?: boolean }>(request)) || {}
  const pinned = body.pinned === true ? 1 : 0

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE tracking_sessions SET pinned=? WHERE id=? AND owner_user_id=?')
    .bind(pinned, id, user.id).run()
  return new Response(null, { status: 204 })
}
