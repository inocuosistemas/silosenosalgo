/**
 * Single source of truth for the formats the server validates and the client
 * pre-checks. Dependency-free so both `functions/` and `src/` can import it.
 */

import type { BeaconActivity } from './wireTypes'

/** The movement types a beacon session may declare (see BeaconActivity). */
export const BEACON_ACTIVITIES = ['walk', 'run', 'bike', 'transport'] as const

/** True when `x` is one of the accepted beacon activities. Used server-side to
 *  validate the create/update body (anything else → treated as auto/null). */
export function isBeaconActivity(x: unknown): x is BeaconActivity {
  return typeof x === 'string' && (BEACON_ACTIVITIES as readonly string[]).includes(x)
}

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** Plan / share ids: base64url, 8–32 chars (mirrors functions/api/share). */
export const PLAN_ID_RE = /^[A-Za-z0-9_-]{8,32}$/
/** Session / live-track tokens: 128-bit base64url ≈ 22 chars; allow 16–32. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,32}$/
/** Invitation codes: base64url; wide range so a hand-picked bootstrap code also fits. */
export const INVITE_RE = /^[A-Za-z0-9_-]{8,64}$/

/** Normalise a username for case-insensitive comparison/storage. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function usernameOk(username: string): boolean {
  return USERNAME_RE.test(normalizeUsername(username))
}

export function passwordOk(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX
  )
}
