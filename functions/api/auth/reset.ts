/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp, wantsToken, requestHost } from '../../lib/http'
import { hashPassword } from '../../lib/password'
import { createSession } from '../../lib/session'
import { buildSessionCookie } from '../../lib/cookies'
import { passwordOk, INVITE_RE } from '../../../shared/validate'
import type { AuthOkResponse } from '../../../shared/wireTypes'

/**
 * POST /api/auth/reset — canjear un enlace de restablecimiento.
 *
 * La contraseña nueva la elige el DUEÑO de la cuenta con un código que le pasó
 * un administrador (ver admin/users/[id]/reset.ts). Sin correo electrónico en
 * el sistema, este es el único camino honesto: el administrador reparte una
 * llave de un solo uso y no llega a saber la contraseña de nadie.
 *
 * Al cambiarla se cierran TODAS las sesiones de esa cuenta. Es lo que hace que
 * esto sirva también cuando alguien sospecha que su contraseña anda por ahí:
 * cambiarla sin echar a quien ya estaba dentro no arreglaría nada. La sesión
 * que se devuelve es la nueva, la de quien acaba de restablecerla.
 *
 * El mismo protocolo de canje que el registro: validar, aplicar, reclamar
 * condicionalmente y RELEER, porque `meta.changes` de D1 no es de fiar y dos
 * pestañas pueden canjear el mismo código a la vez.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)

  const body = await readJson<{ code?: unknown; password?: unknown }>(request)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!INVITE_RE.test(code)) return json({ error: 'invalid_reset' }, 410)
  if (!passwordOk(password)) return json({ error: 'invalid_password' }, 400)

  // Un código es adivinable a base de fuerza bruta; el freno por IP es lo que
  // lo hace inviable sin molestar a nadie real.
  if (await rateLimited(env, `reset:${clientIp(request)}`, 20, 900)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const now = Date.now()
  const row = await env.DB.prepare(
    `SELECT r.user_id AS userId, r.used_at AS usedAt, r.expires_at AS expiresAt,
            u.username AS username, u.is_admin AS isAdmin
       FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.code = ?`,
  ).bind(code).first<{
    userId: string; usedAt: number | null; expiresAt: number
    username: string; isAdmin: number
  }>()
  // Mismo error para "no existe", "ya usado" y "caducado": un enlace que no
  // vale es un enlace que no vale, y detallar cuál de las tres solo ayuda a
  // quien está probando códigos.
  if (!row || row.usedAt !== null || row.expiresAt <= now) return json({ error: 'invalid_reset' }, 410)

  // Reclamar ANTES de tocar la contraseña: si dos canjes coinciden, solo uno
  // sigue adelante y el otro se encuentra el código consumido.
  await env.DB.prepare('UPDATE password_resets SET used_at=? WHERE code=? AND used_at IS NULL')
    .bind(now, code).run()
  const claimed = await env.DB.prepare('SELECT used_at AS usedAt FROM password_resets WHERE code=?')
    .bind(code).first<{ usedAt: number | null }>()
  if (claimed?.usedAt !== now) return json({ error: 'invalid_reset' }, 410)

  const { hash, salt, iterations } = await hashPassword(password)
  await env.DB.prepare('UPDATE users SET password_hash=?, salt=?, iterations=? WHERE id=?')
    .bind(hash, salt, iterations, row.userId).run()
  // Fuera todas las sesiones vivas de esa cuenta, incluidas las de las apps.
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.userId).run()

  const token = await createSession(env, row.userId)
  const useToken = wantsToken(request)
  const payload: AuthOkResponse = {
    user: { id: row.userId, username: row.username, isAdmin: !!row.isAdmin },
    ...(useToken ? { token } : {}),
  }
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (!useToken) headers['Set-Cookie'] = buildSessionCookie(requestHost(request), token)
  return json(payload, 200, headers)
}
