/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import type { AdminUserInfo, AdminUsersResponse } from '../../../../shared/wireTypes'

/**
 * GET /api/admin/users — las cuentas del sitio, para administrarlas.
 *
 * Va con el recuento de lo que tiene cada una (seguimientos, previsiones,
 * eventos organizados) porque es lo que hay que saber ANTES de borrar: una
 * cuenta vacía se borra sin pensar, y una con veinte salidas y dos eventos
 * suyos merece una conversación antes. Nunca se devuelven hashes ni sales.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.is_admin AS isAdmin, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM tracking_sessions t WHERE t.owner_user_id = u.id) AS sessions,
            (SELECT COUNT(*) FROM plans p WHERE p.user_id = u.id) AS plans,
            (SELECT COUNT(*) FROM events e WHERE e.created_by = u.id) AS events,
            (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS lastLogin
       FROM users u ORDER BY u.created_at DESC LIMIT 200`,
  ).all<{
    id: string; username: string; isAdmin: number; createdAt: string
    sessions: number; plans: number; events: number; lastLogin: string | null
  }>()

  const users: AdminUserInfo[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    username: r.username,
    isAdmin: !!r.isAdmin,
    createdAt: r.createdAt,
    sessions: r.sessions,
    plans: r.plans,
    events: r.events,
    lastLogin: r.lastLogin,
  }))
  const res: AdminUsersResponse = { users }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
