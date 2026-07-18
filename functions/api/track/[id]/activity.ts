/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE, isBeaconActivity } from '../../../../shared/validate'
import type { BeaconActivity } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/activity — owner sets/changes the beacon's movement type
 * while a session runs (the selector is available before AND during sharing).
 * Body: `{ activity: BeaconActivity | null }`; `null` (or an unrecognised value)
 * stores NULL = auto, so the viewer falls back to inferring it from the trail.
 * Ownership is checked with a SELECT (meta.changes is unreliable on prod D1).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ activity?: unknown }>(request)) || {}
  const activity: BeaconActivity | null = isBeaconActivity(body.activity) ? body.activity : null

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE tracking_sessions SET activity=? WHERE id=? AND owner_user_id=?')
    .bind(activity, id, user.id).run()
  return new Response(null, { status: 204 })
}
