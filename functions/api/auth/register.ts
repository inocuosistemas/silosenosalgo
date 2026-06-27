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
 * INVITE-ONLY registration. A valid, unused, unexpired invitation code is
 * required. The invite is claimed atomically (single conditional UPDATE → the
 * single-use lock), so a code can create exactly one account. An invite may
 * grant admin (`grants_admin`).
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
  const userId = genId(8)

  // Atomically claim the invite. Setting used_by up-front (to the not-yet-created
  // user id) is the single-use lock: if 0 rows change, the code is unknown,
  // already used, or expired.
  const claim = await env.DB.prepare(
    'UPDATE invitations SET used_by=?, used_at=? WHERE code=? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)',
  ).bind(userId, now, body.invite, now).run()
  if (!(claim.meta?.changes ?? 0)) return json({ error: 'invalid_invite' }, 410)

  const inv = await env.DB.prepare('SELECT grants_admin AS grantsAdmin FROM invitations WHERE code=?')
    .bind(body.invite).first<{ grantsAdmin: number }>()
  const isAdmin = inv?.grantsAdmin ? 1 : 0

  const { hash, salt, iterations } = await hashPassword(body.password)
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, username_ci, password_hash, salt, iterations, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(userId, username, usernameCi, hash, salt, iterations, isAdmin).run()
  } catch {
    // Username already taken → release the invite so it can be reused.
    await env.DB.prepare('UPDATE invitations SET used_by=NULL, used_at=NULL WHERE code=? AND used_by=?')
      .bind(body.invite, userId).run()
    return json({ error: 'username_taken' }, 409)
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
