/**
 * URL-safe random id generator shared by the Cloudflare Pages Functions
 * (server) and the React client. Uses Web Crypto, available in both the
 * Workers runtime and the browser, so the encoding matches the existing
 * `genId` in `functions/api/share/index.ts`.
 *
 * `bytes` controls entropy:
 *  - 8 bytes (64-bit) for non-secret, ownership-scoped ids (users, plans).
 *  - 16 bytes (128-bit) for unguessable secrets (session + live-track tokens).
 */
export function genId(bytes = 8): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
