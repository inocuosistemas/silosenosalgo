/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

export function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

/**
 * CSRF guard for state-changing requests. Bearer-token (native) requests are
 * immune to CSRF — an attacker can't read the token — so they pass. For cookie
 * requests we require a same-origin `Sec-Fetch-Site` (or matching `Origin`).
 * Combined with `SameSite=Lax` (cookie not even sent on cross-site POST) this
 * covers the browser case.
 */
export function csrfOk(request: Request): boolean {
  const auth = request.headers.get('Authorization')
  if (auth && auth.startsWith('Bearer ')) return true

  const sfs = request.headers.get('Sec-Fetch-Site')
  if (sfs) return sfs === 'same-origin' || sfs === 'none'

  const origin = request.headers.get('Origin')
  if (!origin) return true // same-origin navigations / native clients may omit Origin
  try {
    const host = request.headers.get('Host') || new URL(request.url).host
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read + parse a JSON body, returning null on any problem (incl. wrong type). */
export async function readJson<T>(request: Request): Promise<T | null> {
  const ct = request.headers.get('Content-Type') || ''
  if (!ct.includes('application/json')) return null
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

/**
 * Best-effort KV rate limiter. Counts attempts under `key` within a TTL window
 * and returns true once over `limit`. KV is eventually consistent, so this is a
 * soft throttle; the PBKDF2 cost + generic errors are the real brute-force
 * defenses.
 */
export async function rateLimited(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const full = `rl:${key}`
  const current = await env.SHARE_KV.get(full)
  const count = current ? parseInt(current, 10) || 0 : 0
  if (count >= limit) return true
  await env.SHARE_KV.put(full, String(count + 1), { expirationTtl: windowSec })
  return false
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown'
}

export function requestHost(request: Request): string {
  return request.headers.get('Host') || new URL(request.url).host
}

/** True when the client wants a bearer token in the body (native apps). */
export function wantsToken(request: Request): boolean {
  return request.headers.get('X-Auth-Mode') === 'token'
}
