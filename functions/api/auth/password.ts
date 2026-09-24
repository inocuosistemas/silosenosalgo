/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited } from '../../lib/http'
import { verifyPassword } from '../../lib/password'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'

/**
 * POST /api/auth/password — cambiar la contraseña propia, primer paso.
 *
 * Se comprueba la contraseña ACTUAL y, si vale, se da un código de un solo uso
 * que caduca en diez minutos; con él, la nueva se guarda en `/api/auth/reset`,
 * el mismo canje que usan los enlaces que reparte un administrador. Dos
 * peticiones y no una porque cada derivación de clave se come casi todo el
 * tiempo de CPU que el plan gratuito deja por petición (ver `lib/password`):
 * comprobar la vieja Y derivar la nueva en la misma se pasaba.
 *
 * El canje cierra todas las sesiones de la cuenta —también las de las apps en
 * otros móviles— y devuelve una nueva a quien la ha cambiado: es lo que se
 * quiere si se cambia porque alguien la conoce.
 */

/** Diez minutos: lo que se tarda en escribir la nueva dos veces, y poco más. */
const TTL_MS = 10 * 60 * 1000

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{ current?: unknown }>(request)
  const current = typeof body?.current === 'string' ? body.current : ''
  if (!current) return json({ error: 'invalid_request' }, 400)

  // Con la sesión robada no se prueba la contraseña a lo bruto.
  if (await rateLimited(env, `password:user:${user.id}`, 10, 900)) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '900' })
  }

  const row = await env.DB.prepare(
    'SELECT password_hash AS hash, salt, iterations FROM users WHERE id = ? AND sin_cuenta = 0',
  ).bind(user.id).first<{ hash: string; salt: string; iterations: number }>()
  if (!row || !(await verifyPassword(current, row.hash, row.salt, row.iterations))) {
    return json({ error: 'invalid_credentials' }, 401)
  }

  const now = Date.now()
  const code = genId(12)
  await env.DB.prepare(
    'INSERT INTO password_resets (code, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(code, user.id, user.id, now, now + TTL_MS).run()
  return json({ code, expiresAt: now + TTL_MS }, 200, { 'Cache-Control': 'no-store' })
}
