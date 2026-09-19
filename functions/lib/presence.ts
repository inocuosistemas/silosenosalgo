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

/**
 * Lo mismo para el MAPA DE UN EVENTO (tabla `event_viewers`): cuánta gente lo
 * está mirando. El mapa sondea cada 10 s; el latido solo se escribe si el
 * anterior tiene más de 25 s, que para una ventana de un minuto sobra y
 * deja las escrituras en una de cada tres sondeos.
 *
 * Devuelve cuántos hay mirando (quien pregunta incluido).
 */
export async function latidoEnEvento(env: Env, eventId: string, viewerId: string | null): Promise<number> {
  const ahora = Date.now()
  if (viewerId && VIEWER_RE.test(viewerId)) {
    await env.DB.prepare(
      `INSERT INTO event_viewers (event_id, viewer_id, last_seen) VALUES (?, ?, ?)
         ON CONFLICT(event_id, viewer_id) DO UPDATE SET last_seen = excluded.last_seen
         WHERE event_viewers.last_seen < excluded.last_seen - 25000`,
    ).bind(eventId, viewerId, ahora).run()
  }
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM event_viewers WHERE event_id = ? AND last_seen > ?',
  ).bind(eventId, ahora - WINDOW_MS).first<{ n: number }>()
  return row?.n ?? 0
}
