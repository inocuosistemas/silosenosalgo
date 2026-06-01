/// <reference types="@cloudflare/workers-types" />

/**
 * POST /api/share — store a gzipped "salida" payload in KV, return a short id.
 *
 * Body: the gzipped bytes (application/octet-stream) produced by the client.
 * The Function stores them opaquely (no (de)compression at the edge) with a
 * TTL, so links self-expire without any cron / cleanup job.
 */

interface Env {
  SHARE_KV: KVNamespace
}

/** Stays under KV's 25 MB per-value cap; mirrors MAX_SHARE_BYTES on the client. */
const MAX_BYTES = 20 * 1024 * 1024
/** Links live 180 days. */
const TTL_SECONDS = 60 * 60 * 24 * 180

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 8 random bytes → base64url → ~11 url-safe chars. Not enumerable. */
function genId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413)

  const id = genId()
  await env.SHARE_KV.put(id, buf, { expirationTtl: TTL_SECONDS })
  return json({ id }, 200)
}
