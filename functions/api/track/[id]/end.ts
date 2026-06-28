/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * POST /api/track/:id/end — owner stops sharing. Keeps the route + last known
 * position so the viewer can still show them for 24 h; only the status flips to
 * 'ended' and expires_at is reset to now + 24 h (a lazy purge clears the data on
 * the first read past that point). Ownership is checked with a SELECT (not
 * meta.changes, which is unreliable on production D1).
 */

const DEFAULT_RETAIN_HOURS = 24 // viewable after end, then lazy-purged
const MAX_RETAIN_HOURS = 24 * 30 // 30 days

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  // How long the finished route stays viewable (configurable from the app).
  const body = (await readJson<{ retainHours?: number }>(request)) || {}
  const retainHours = typeof body.retainHours === 'number' && body.retainHours > 0
    ? Math.min(body.retainHours, MAX_RETAIN_HOURS)
    : DEFAULT_RETAIN_HOURS
  const now = Date.now()
  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, expires_at=? WHERE id=?",
  ).bind(now, now + retainHours * 3_600_000, id).run()
  return new Response(null, { status: 204 })
}
