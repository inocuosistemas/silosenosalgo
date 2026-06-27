/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp, requestHost, wantsToken } from '../../lib/http'
import { hashPassword } from '../../lib/password'
import { createSession } from '../../lib/session'
import { buildSessionCookie } from '../../lib/cookies'
import { genId } from '../../../shared/ids'
import { usernameOk, passwordOk, normalizeUsername, INVITE_RE } from '../../../shared/validate'
import type { AuthOkResponse } from '../../../shared/wireTypes'

/**
 * INVITE-ONLY registration. A valid, unused, unexpired invitation is required
 * and consumed single-use.
 *
 * Correctness note: D1's `meta.changes` is NOT reliable in production for
 * conditional UPDATEs, so we never branch on it. Instead we (1) validate the
 * invite with a SELECT, (2) create the user, (3) claim the invite, then (4)
 * READ BACK `used_by` to confirm we own it — rolling back the user if we lost a
 * race. This keeps single-use guarantees without depending on `meta.changes`.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  if (await rateLimited(env, `register:ip:${clientIp(request)}`, 20, 600)) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '600' })
  }

  const body = await readJson<{ username?: string; password?: string; invite?: string }>(request)
  if (
    !body ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string' ||
    typeof body.invite !== 'string'
  ) {
    return json({ error: 'invalid_request' }, 400)
  }
  if (!INVITE_RE.test(body.invite)) return json({ error: 'invalid_invite' }, 400)
  if (!usernameOk(body.username)) return json({ error: 'invalid_username' }, 400)
  if (!passwordOk(body.password)) return json({ error: 'invalid_password' }, 400)

  const usernameCi = normalizeUsername(body.username)
  const username = body.username.trim()
  const now = Date.now()

  // 1. Validate the invite (must exist, be unused, and not expired).
  const inv = await env.DB.prepare(
    'SELECT grants_admin AS grantsAdmin, used_by AS usedBy, expires_at AS expiresAt FROM invitations WHERE code=?',
  ).bind(body.invite).first<{ grantsAdmin: number; usedBy: string | null; expiresAt: number | null }>()
  if (!inv || inv.usedBy !== null || (inv.expiresAt !== null && inv.expiresAt <= now)) {
    return json({ error: 'invalid_invite' }, 410)
  }
  const isAdmin = inv.grantsAdmin ? 1 : 0

  // 2. Create the user (fails if the username is taken).
  const userId = genId(8)
  const { hash, salt, iterations } = await hashPassword(body.password)
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, username_ci, password_hash, salt, iterations, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(userId, username, usernameCi, hash, salt, iterations, isAdmin).run()
  } catch {
    return json({ error: 'username_taken' }, 409)
  }

  // 3. Claim the invite atomically, then 4. read back to confirm we own it.
  await env.DB.prepare(
    'UPDATE invitations SET used_by=?, used_at=? WHERE code=? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)',
  ).bind(userId, now, body.invite, now).run()
  const claimed = await env.DB.prepare('SELECT used_by AS usedBy FROM invitations WHERE code=?')
    .bind(body.invite).first<{ usedBy: string | null }>()
  if (claimed?.usedBy !== userId) {
    // Lost a race (or invite became invalid) → roll back the user we created.
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(userId).run()
    return json({ error: 'invalid_invite' }, 410)
  }

  const token = await createSession(env, userId)
  const useToken = wantsToken(request)
  const payload: AuthOkResponse = {
    user: { id: userId, username, isAdmin: !!isAdmin },
    ...(useToken ? { token } : {}),
  }
  const headers = useToken ? undefined : { 'Set-Cookie': buildSessionCookie(requestHost(request), token) }
  return json(payload, 201, headers)
}
