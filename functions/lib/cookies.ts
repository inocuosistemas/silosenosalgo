/// <reference types="@cloudflare/workers-types" />

/**
 * Session cookie helpers. In production we use the `__Host-` prefix (browser-
 * enforced Secure + Path=/ + no Domain — strong CSRF/subdomain hardening). Over
 * http://localhost some browsers reject `__Host-`/`Secure`, so we drop both for
 * local hosts, detected from the request Host header.
 */

const PROD_NAME = '__Host-session'
const DEV_NAME = 'session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, matches DB expires_at

function isLocalHost(host: string): boolean {
  const h = host.split(':')[0]
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

export function sessionCookieName(host: string): string {
  return isLocalHost(host) ? DEV_NAME : PROD_NAME
}

export function buildSessionCookie(host: string, token: string): string {
  const secure = isLocalHost(host) ? '' : '; Secure'
  return `${sessionCookieName(host)}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export function clearSessionCookie(host: string): string {
  const secure = isLocalHost(host) ? '' : '; Secure'
  return `${sessionCookieName(host)}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`
}

export function readSessionCookie(request: Request, host: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  const name = sessionCookieName(host)
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim()
  }
  return null
}
