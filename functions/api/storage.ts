/// <reference types="@cloudflare/workers-types" />
import { cupoBytes, usoBytes } from '../lib/cuota'
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


export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Lo de sus notas de baliza y lo que ha subido a eventos, sumado. Ver `lib/cuota`.
  const body: StorageInfo = { usedBytes: await usoBytes(env, user.id), quotaBytes: cupoBytes(env) }
  return json(body)
}
