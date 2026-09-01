/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json, csrfOk } from '../../../../lib/http'
import { getSessionUser } from '../../../../lib/session'
import { genId } from '../../../../../shared/ids'
import type { CreateResetResponse } from '../../../../../shared/wireTypes'

/**
 * POST /api/admin/users/:id/reset — genera un enlace para que esa persona
 * elija una contraseña nueva.
 *
 * El administrador reparte la llave; la contraseña la pone su dueño. Si la
 * pusiera el administrador tendría que hacérsela llegar por algún chat —donde
 * queda escrita— y además sabría la contraseña de otro, que es justo lo que no
 * debe pasar.
 *
 * Generar uno nuevo invalida los anteriores de esa cuenta: dos enlaces vivos a
 * la vez son dos llaves sueltas, y quien pide uno nuevo es porque el anterior
 * ya no sirve.
 */

/** Corto a propósito: una llave para entrar en la cuenta de alguien no debe
 *  quedarse dando vueltas por un chat una semana. */
const TTL_MS = 24 * 60 * 60 * 1000

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const id = String(params.id)
  const target = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first<{ id: string }>()
  if (!target) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  await env.DB.prepare('DELETE FROM password_resets WHERE user_id=? AND used_at IS NULL')
    .bind(id).run()

  const code = genId(12)
  await env.DB.prepare(
    'INSERT INTO password_resets (code, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(code, id, user.id, now, now + TTL_MS).run()

  const res: CreateResetResponse = { code, expiresAt: now + TTL_MS }
  return json(res, 201, { 'Cache-Control': 'no-store' })
}
