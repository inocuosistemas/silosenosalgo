/// <reference types="@cloudflare/workers-types" />

/**
 * Password hashing with PBKDF2-HMAC-SHA-256 — the only KDF available in the
 * Workers WebCrypto runtime (no Argon2/scrypt). Iterations are stored per-row
 * so the cost can be raised later and old hashes upgraded on next login.
 */

/**
 * Default iteration count. OWASP's PBKDF2-SHA256 floor is 210k. Login runs a
 * second (dummy) derivation on a miss, so raise toward 600k only after
 * confirming Pages Functions CPU headroom. Stored per user, so changing this
 * only affects new / re-hashed passwords.
 */
export const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const KEY_BITS = 256

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return { hash: toB64(hash), salt: toB64(salt), iterations: PBKDF2_ITERATIONS }
}

/** Constant-time compare (Workers has no crypto.timingSafeEqual). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(
  password: string,
  hashB64: string,
  saltB64: string,
  iterations: number,
): Promise<boolean> {
  const expected = fromB64(hashB64)
  const actual = await derive(password, fromB64(saltB64), iterations)
  return timingSafeEqual(actual, expected)
}
