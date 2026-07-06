/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import type { CreateTrackResponse } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/reopen — owner re-activates an ended session so the SAME
 * link keeps working ("dejar de compartir y volver a compartir"). Flips status
 * back to 'active', clears ended_at and extends expiry. Keeps started_at so plan
 * timing / elapsed stays anchored to the original start. Enforces the one-active-
 * session-per-user invariant by ending any other active session first.
 *
 * Note: the last position / trail may already have been lazily purged (data is
 * nulled past expires_at, but the row survives); broadcasting simply resumes
 * fresh. If the linked plan's KV copy has expired the overlay won't reload, but
 * tracking itself is unaffected.
 */

const TTL_MS = 1000 * 60 * 60 * 16 // 16 h, same window as create
const KEEP_AFTER_END_MS = 48 * 60 * 60 * 1000

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  // Keep one active session per user: end any OTHER active one first.
  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='ended', ended_at=?, expires_at=? WHERE owner_user_id=? AND status='active' AND id<>?",
  ).bind(now, now + KEEP_AFTER_END_MS, user.id, id).run()

  const expiresAt = now + TTL_MS
  await env.DB.prepare(
    "UPDATE tracking_sessions SET status='active', ended_at=NULL, expires_at=? WHERE id=? AND owner_user_id=?",
  ).bind(expiresAt, id, user.id).run()

  const res: CreateTrackResponse = { id, expiresAt }
  return json(res, 200)
}
