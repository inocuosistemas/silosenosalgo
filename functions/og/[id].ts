/// <reference types="@cloudflare/workers-types" />

/**
 * Per-share preview image (Open Graph) for `/?s=<id>` links.
 *
 *  - PUT /og/<id>.png  → store the PNG the browser rendered at share time.
 *  - GET /og/<id>.png  → serve it; falls back to the static brand card
 *                        (`/og-card.png`) when no per-share image exists yet
 *                        (capture failed, old link, or crawler raced the upload).
 *
 * The image is generated client-side (the edge has no DOM/forecast) and stored
 * under `${id}:img` with the same 180-day TTL as the payload, so it self-expires.
 */

interface Env {
  SHARE_KV: KVNamespace
}

const TTL_SECONDS = 60 * 60 * 24 * 180
/** Safety cap — a 1200×630 PNG is ~0.2–0.6 MB; well under KV's 25 MB value limit. */
const MAX_IMG_BYTES = 6 * 1024 * 1024

const imgKey = (id: string) => `${id}:img`
const validId = (id: string) => /^[A-Za-z0-9_-]{8,32}$/.test(id)

/** Strip an optional image extension so `/og/<id>`, `.jpg`, `.png` all resolve. */
function cleanId(raw: unknown): string {
  return String(raw).replace(/\.(jpe?g|png)$/i, '')
}

export const onRequestPut: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = cleanId(params.id)
  if (!validId(id)) return new Response(null, { status: 400 })

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMG_BYTES) {
    return new Response(null, { status: 413 })
  }
  await env.SHARE_KV.put(imgKey(id), buf, { expirationTtl: TTL_SECONDS })
  return new Response(null, { status: 204 })
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = cleanId(params.id)
  if (!validId(id)) return new Response(null, { status: 400 })

  const body = await env.SHARE_KV.get(imgKey(id), 'arrayBuffer')
  if (!body) {
    // No per-share image — serve the brand card so the preview never breaks.
    return fetch(new URL('/og-card.png', request.url).toString())
  }
  // Per-share previews are JPEG (kept small so crawlers don't drop them).
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
