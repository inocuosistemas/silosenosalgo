/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp, requestHost, wantsToken } from '../../lib/http'
import { verifyPassword, hashPassword, PBKDF2_ITERATIONS } from '../../lib/password'
import { createSession } from '../../lib/session'
import { buildSessionCookie } from '../../lib/cookies'
import { normalizeUsername } from '../../../shared/validate'
import type { AuthOkResponse } from '../../../shared/wireTypes'

// Fixed dummy hash/salt so a missing user still costs ~one PBKDF2 derivation
// (timing parity → no user enumeration). Decodes to 32/16 zero bytes; never matches.
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA=='

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)

  const body = await readJson<{ username?: string; password?: string }>(request)
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json({ error: 'invalid_request' }, 400)
  }
  const usernameCi = normalizeUsername(body.username)

  if (
    (await rateLimited(env, `login:ip:${clientIp(request)}`, 30, 600)) ||
    (await rateLimited(env, `login:user:${usernameCi}`, 10, 900))
  ) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '600' })
  }

  const row = await env.DB.prepare(
    'SELECT id, username, password_hash AS hash, salt, iterations FROM users WHERE username_ci = ?',
  ).bind(usernameCi).first<{ id: string; username: string; hash: string; salt: string; iterations: number }>()

  if (!row) {
    await verifyPassword(body.password, DUMMY_HASH, DUMMY_SALT, PBKDF2_ITERATIONS) // timing parity
    return json({ error: 'invalid_credentials' }, 401)
  }

  if (!(await verifyPassword(body.password, row.hash, row.salt, row.iterations))) {
    return json({ error: 'invalid_credentials' }, 401)
  }

  // Upgrade-on-login if the stored cost is below the current default.
  if (row.iterations < PBKDF2_ITERATIONS) {
    try {
      const fresh = await hashPassword(body.password)
      await env.DB.prepare('UPDATE users SET password_hash=?, salt=?, iterations=? WHERE id=?')
        .bind(fresh.hash, fresh.salt, fresh.iterations, row.id).run()
    } catch { /* non-fatal */ }
  }

  const token = await createSession(env, row.id)
  const useToken = wantsToken(request)
  const payload: AuthOkResponse = { user: { id: row.id, username: row.username }, ...(useToken ? { token } : {}) }
  const headers = useToken ? undefined : { 'Set-Cookie': buildSessionCookie(requestHost(request), token) }
  return json(payload, 200, headers)
}
