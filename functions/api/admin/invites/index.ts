/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { genId } from '../../../../shared/ids'
import type { CreateInviteResponse, InvitesListResponse, InviteInfo } from '../../../../shared/wireTypes'

/**
 * Admin-only invitation management.
 *   POST   /api/admin/invites        → create a single-use invite, returns { code }.
 *   GET    /api/admin/invites        → list invites (newest first) with their status.
 *   DELETE /api/admin/invites/:code  → remove one (see `[code].ts`).
 */

const MAX_TTL_DAYS = 90
const DEFAULT_TTL_DAYS = 7

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ grantsAdmin?: boolean; expiresInDays?: number }>(request)) || {}
  const grantsAdmin = body.grantsAdmin ? 1 : 0
  const now = Date.now()
  let expiresAt: number | null = now + DEFAULT_TTL_DAYS * 86_400_000
  if (typeof body.expiresInDays === 'number') {
    expiresAt = body.expiresInDays <= 0 ? null : now + Math.min(body.expiresInDays, MAX_TTL_DAYS) * 86_400_000
  }

  const code = genId(12)
  await env.DB.prepare(
    'INSERT INTO invitations (code, created_by, grants_admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(code, user.id, grantsAdmin, now, expiresAt).run()

  const res: CreateInviteResponse = { code }
  return json(res, 201)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  // LEFT JOIN, no INNER: `used_by` is NULL for every unused invite, and it is
  // NOT a foreign key — a deleted account would otherwise make its invitation
  // vanish from the list, which is the opposite of what an audit list is for.
  // `usedByUsername` then stays null and the UI says "usada por una cuenta que
  // ya no existe" instead of hiding the row.
  const rows = await env.DB.prepare(
    `SELECT i.code, i.grants_admin AS grantsAdmin, i.created_at AS createdAt, i.expires_at AS expiresAt,
            i.used_by AS usedBy, i.used_at AS usedAt, u.username AS usedByUsername
       FROM invitations i LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC LIMIT 100`,
  ).all<{ code: string; grantsAdmin: number; createdAt: number; expiresAt: number | null; usedBy: string | null; usedAt: number | null; usedByUsername: string | null }>()

  const invites: InviteInfo[] = (rows.results ?? []).map((r) => ({
    code: r.code,
    grantsAdmin: !!r.grantsAdmin,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    used: r.usedBy !== null,
    usedAt: r.usedAt,
    // El NOMBRE, nunca el id: es lo único que el administrador reconoce, y el
    // id de usuario no le dice nada a nadie. `used` sigue saliendo de `used_by`
    // y no de esto, para que una cuenta borrada no resucite la invitación.
    usedByUsername: r.usedByUsername,
  }))
  const res: InvitesListResponse = { invites }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
