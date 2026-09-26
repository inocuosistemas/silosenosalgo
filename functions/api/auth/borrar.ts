/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp, requestHost } from '../../lib/http'
import { verifyPassword, PBKDF2_ITERATIONS } from '../../lib/password'
import { getSessionUser } from '../../lib/session'
import { clearSessionCookie } from '../../lib/cookies'
import { normalizeUsername } from '../../../shared/validate'
import { borraCuenta } from '../../lib/borrarCuenta'

/**
 * POST /api/auth/borrar — borrar la cuenta propia, para siempre (ver
 * `lib/borrarCuenta`). Siempre con la contraseña: es lo único que no se puede
 * deshacer, y con una sesión robada no debería bastar.
 *
 * Dos formas de llegar:
 * - con la sesión abierta (las apps y la web): `{ password }`;
 * - sin ella, desde la página pública `/borrar-cuenta.html`, que Google Play
 *   pide para quien ya no tiene la app: `{ username, password }`.
 */

// Mismo truco que en el login: sin usuario, la misma derivación, para que el
// tiempo de respuesta no diga qué cuentas existen.
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA=='

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const body = await readJson<{ username?: unknown; password?: unknown }>(request)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) return json({ error: 'invalid_request' }, 400)

  const sesion = await getSessionUser(request, env)
  const usernameCi = sesion ? null : typeof body?.username === 'string' ? normalizeUsername(body.username) : ''
  if (!sesion && !usernameCi) return json({ error: 'invalid_request' }, 400)

  if (
    (await rateLimited(env, `borrar:ip:${clientIp(request)}`, 20, 900)) ||
    (await rateLimited(env, `borrar:user:${sesion?.id ?? usernameCi}`, 5, 900))
  ) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '900' })
  }

  const row = sesion
    ? await env.DB.prepare('SELECT id, username, password_hash AS hash, salt, iterations FROM users WHERE id = ? AND sin_cuenta = 0')
      .bind(sesion.id).first<{ id: string; username: string; hash: string; salt: string; iterations: number }>()
    : await env.DB.prepare('SELECT id, username, password_hash AS hash, salt, iterations FROM users WHERE username_ci = ? AND sin_cuenta = 0')
      .bind(usernameCi).first<{ id: string; username: string; hash: string; salt: string; iterations: number }>()
  if (!row) {
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT, PBKDF2_ITERATIONS)
    return json({ error: 'invalid_credentials' }, 401)
  }
  if (!(await verifyPassword(password, row.hash, row.salt, row.iterations))) {
    return json({ error: 'invalid_credentials' }, 401)
  }

  const r = await borraCuenta(env, row.id, row.username)
  return json({ ok: true, ...r }, 200, { 'Set-Cookie': clearSessionCookie(requestHost(request)), 'Cache-Control': 'no-store' })
}
