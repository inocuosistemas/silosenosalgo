/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import type { CreateInviteResponse, InvitesListResponse, InviteInfo } from '../../../shared/wireTypes'

/**
 * Admin-only invitation management.
 *   POST /api/admin/invites  → create a single-use invite, returns { code }.
 *   GET  /api/admin/invites  → list invites (newest first) with their status.
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

  const rows = await env.DB.prepare(
    `SELECT code, grants_admin AS grantsAdmin, created_at AS createdAt, expires_at AS expiresAt,
            used_by AS usedBy, used_at AS usedAt
       FROM invitations ORDER BY created_at DESC LIMIT 100`,
  ).all<{ code: string; grantsAdmin: number; createdAt: number; expiresAt: number | null; usedBy: string | null; usedAt: number | null }>()

  const invites: InviteInfo[] = (rows.results ?? []).map((r) => ({
    code: r.code,
    grantsAdmin: !!r.grantsAdmin,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    used: r.usedBy !== null,
    usedAt: r.usedAt,
  }))
  const res: InvitesListResponse = { invites }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
