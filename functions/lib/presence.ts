/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * Lightweight "who's watching" presence for a live session, backed by D1. Each
 * follower's viewer polls the public state endpoint; that call UPSERTs a
 * per-viewer heartbeat row. The active-follower count is how many heartbeats
 * landed within the last WINDOW_MS.
 *
 * Previously this lived in KV (per-viewer keys with a 60 s TTL, counted with
 * list()). But list() ran on every poll AND every ping, and Cloudflare's free
 * tier caps KV list at 1000 ops/day — a single ~1 h session with one follower
 * already blew it. D1 reads/writes are far cheaper on the free tier, so presence
 * moved here (migrations/0010_session_viewers.sql). Stale rows simply age out of
 * the time window; ON DELETE CASCADE clears them when the session is deleted.
 *
 * Callers treat both functions as best-effort: a failure here must never break
 * live tracking, so it's wrapped in try/catch at the call sites.
 */

const WINDOW_MS = 60_000
const VIEWER_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Refresh this viewer's heartbeat for the session. No-op on a malformed id. */
export async function recordViewer(env: Env, sessionId: string, viewerId: string): Promise<void> {
  if (!VIEWER_RE.test(viewerId)) return
  await env.DB.prepare(
    `INSERT INTO session_viewers (session_id, viewer_id, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(session_id, viewer_id) DO UPDATE SET last_seen = excluded.last_seen`,
  ).bind(sessionId, viewerId, Date.now()).run()
}

/** Count viewers whose heartbeat landed within the last WINDOW_MS. */
export async function countViewers(env: Env, sessionId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM session_viewers WHERE session_id = ? AND last_seen > ?',
  ).bind(sessionId, Date.now() - WINDOW_MS).first<{ n: number }>()
  return row?.n ?? 0
}
