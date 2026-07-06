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
 *
 * Pinning also keeps the attached ROUTE overlay alive: the plan snapshot in KV
 * is created with a short TTL (~16 h), so without this a pinned session would
 * keep its trail but lose its planned-course overlay. On pin we re-put the blob
 * with a long TTL; on unpin we shrink it back to the retention window.
 */

// ~1 year: "indefinite" for a pinned session, but self-cleaning (avoids KV
// leaks if the session is later deleted). Re-armed each time it's pinned.
const PIN_PLAN_TTL_S = 365 * 24 * 3600
// Back in step with the default retention window once released.
const UNPIN_PLAN_TTL_S = 48 * 3600

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ pinned?: boolean }>(request)) || {}
  const pinned = body.pinned === true ? 1 : 0

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner, plan_share_id AS planShareId FROM tracking_sessions WHERE id=?',
  ).bind(id).first<{ owner: string; planShareId: string | null }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('UPDATE tracking_sessions SET pinned=? WHERE id=? AND owner_user_id=?')
    .bind(pinned, id, user.id).run()

  // Keep the route overlay's lifetime in step with the session. Best-effort:
  // if the blob already expired there's nothing left to preserve (tracking is
  // unaffected). Re-put preserves the raw gzipped bytes as-is.
  if (row.planShareId) {
    try {
      const buf = await env.SHARE_KV.get(row.planShareId, 'arrayBuffer')
      if (buf) {
        await env.SHARE_KV.put(row.planShareId, buf, {
          expirationTtl: pinned ? PIN_PLAN_TTL_S : UNPIN_PLAN_TTL_S,
        })
      }
    } catch { /* overlay preservation is best-effort */ }
  }

  return new Response(null, { status: 204 })
}
