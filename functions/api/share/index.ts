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

/**
 * Parse the optional `X-Share-Meta` header into a small, clamped `{title, desc}`
 * object for the link preview. Best-effort: any problem yields `null` and the
 * share still succeeds (the edge falls back to brand defaults).
 */
function parseMeta(header: string | null): string | null {
  if (!header) return null
  try {
    const raw = JSON.parse(decodeURIComponent(header)) as { title?: unknown; desc?: unknown }
    const title = typeof raw.title === 'string' ? raw.title.slice(0, 120).trim() : ''
    const desc = typeof raw.desc === 'string' ? raw.desc.slice(0, 200).trim() : ''
    if (!title && !desc) return null
    return JSON.stringify({ title, desc })
  } catch {
    return null
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413)

  const id = genId()
  await env.SHARE_KV.put(id, buf, { expirationTtl: TTL_SECONDS })

  // Sidecar for the link preview (Open Graph). Stored under `${id}:og` with the
  // same TTL so it expires together with the blob. Failure here is non-fatal.
  const meta = parseMeta(request.headers.get('X-Share-Meta'))
  if (meta) {
    try {
      await env.SHARE_KV.put(`${id}:og`, meta, { expirationTtl: TTL_SECONDS })
    } catch { /* preview is a nice-to-have — never fail the share for it */ }
  }

  return json({ id }, 200)
}
