/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * Lightweight "who's watching" presence for a live session, backed by KV TTLs so
 * there's no table to migrate or clean up. Each follower's viewer polls the
 * public state endpoint; that call refreshes a per-viewer key that expires on its
 * own. The active-follower count is just how many of those keys are still alive.
 *
 * KV's minimum TTL is 60 s, so a viewer who closes the tab drops off within a
 * minute — fine for a "seguidores activos" indicator. `list` is eventually
 * consistent, so the count can lag a few seconds; that's acceptable here.
 */

const TTL_SECONDS = 60
const VIEWER_RE = /^[A-Za-z0-9_-]{1,64}$/

const prefix = (sessionId: string) => `viewer:${sessionId}:`

/** Refresh this viewer's heartbeat for the session. No-op on a malformed id. */
export async function recordViewer(env: Env, sessionId: string, viewerId: string): Promise<void> {
  if (!VIEWER_RE.test(viewerId)) return
  await env.SHARE_KV.put(prefix(sessionId) + viewerId, '1', { expirationTtl: TTL_SECONDS })
}

/** Count viewers whose heartbeat hasn't expired (personal scale ⇒ one page). */
export async function countViewers(env: Env, sessionId: string): Promise<number> {
  const res = await env.SHARE_KV.list({ prefix: prefix(sessionId) })
  return res.keys.length
}
