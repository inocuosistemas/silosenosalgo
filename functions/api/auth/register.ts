/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp, requestHost, wantsToken } from '../../lib/http'
import { hashPassword } from '../../lib/password'
import { createSession } from '../../lib/session'
import { buildSessionCookie } from '../../lib/cookies'
import { genId } from '../../../shared/ids'
import { usernameOk, passwordOk, normalizeUsername } from '../../../shared/validate'
import type { AuthOkResponse } from '../../../shared/wireTypes'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)

  if (await rateLimited(env, `register:ip:${clientIp(request)}`, 20, 600)) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '600' })
  }

  const body = await readJson<{ username?: string; password?: string }>(request)
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json({ error: 'invalid_request' }, 400)
  }
  if (!usernameOk(body.username)) return json({ error: 'invalid_username' }, 400)
  if (!passwordOk(body.password)) return json({ error: 'invalid_password' }, 400)

  const usernameCi = normalizeUsername(body.username)
  const username = body.username.trim()

  const existing = await env.DB.prepare('SELECT 1 FROM users WHERE username_ci = ?').bind(usernameCi).first()
  if (existing) return json({ error: 'username_taken' }, 409)

  const { hash, salt, iterations } = await hashPassword(body.password)
  const userId = genId(8)
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, username_ci, password_hash, salt, iterations) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(userId, username, usernameCi, hash, salt, iterations).run()
  } catch {
    return json({ error: 'username_taken' }, 409) // UNIQUE(username_ci) race
  }

  const token = await createSession(env, userId)
  const useToken = wantsToken(request)
  const payload: AuthOkResponse = { user: { id: userId, username }, ...(useToken ? { token } : {}) }
  const headers = useToken ? undefined : { 'Set-Cookie': buildSessionCookie(requestHost(request), token) }
  return json(payload, 201, headers)
}
