/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../lib/db'
import { json } from '../lib/http'
import { getSessionUser } from '../lib/session'
import type { StorageInfo } from '../../shared/wireTypes'

/**
 * GET /api/storage — the authenticated user's media storage use.
 *
 * Note media (photos/voice memos) lives in KV as a stop-gap (no R2 yet), whose
 * capacity is small, so the app shows a budget meter. We sum the per-note byte
 * sizes recorded on upload (track_notes.audio_bytes/photo_bytes) — a deleted
 * note cascades away, so the sum tracks what's actually stored. The budget is a
 * per-user soft cap (env MEDIA_QUOTA_BYTES, default 100 MB); it's informational
 * only — uploads aren't blocked here (the per-file cap in media.ts still applies).
 */

const DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024

function quotaBytes(env: Env): number {
  const n = parseInt(env.MEDIA_QUOTA_BYTES ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUOTA_BYTES
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(audio_bytes, 0) + COALESCE(photo_bytes, 0)), 0) AS used
       FROM track_notes WHERE owner_user_id = ?`,
  ).bind(user.id).first<{ used: number }>()

  const body: StorageInfo = { usedBytes: row?.used ?? 0, quotaBytes: quotaBytes(env) }
  return json(body)
}
