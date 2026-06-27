/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import { genId } from '../../shared/ids'
import { readSessionCookie } from './cookies'

/**
 * Opaque session tokens. The client holds a raw 128-bit token — an HttpOnly
 * cookie for web, an `Authorization: Bearer` token (Keychain) for native apps.
 * The DB stores only SHA-256(token), so a DB dump cannot hijack live sessions.
 * Sessions are revocable (logout deletes the row) and expire via `expires_at`.
 */

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SessionUser {
  id: string
  username: string
}

/** Create a session row, returning the raw token to hand to the client. */
export async function createSession(env: Env, userId: string): Promise<string> {
  const token = genId(16)
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, userId, expiresAt)
    .run()
  return token
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization')
  return auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
}

/** Resolve the logged-in user from a Bearer token or the session cookie. */
export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const host = request.headers.get('Host') || new URL(request.url).host
  const token = bearerToken(request) || readSessionCookie(request, host)
  if (!token) return null

  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  ).bind(tokenHash).first<{ userId: string; expiresAt: string; username: string }>()
  if (!row) return null

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    return null
  }
  return { id: row.userId, username: row.username }
}
