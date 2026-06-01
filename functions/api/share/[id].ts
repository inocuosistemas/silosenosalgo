/// <reference types="@cloudflare/workers-types" />

/**
 * GET /api/share/:id — return the gzipped "salida" blob stored under `id`.
 *
 * The content for a given id is immutable (random id → unique payload), so it's
 * safe to cache aggressively. The client gunzips the body (see shareTransport).
 */

interface Env {
  SHARE_KV: KVNamespace
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id)
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return json({ error: 'bad_id' }, 400)

  const body = await env.SHARE_KV.get(id, 'arrayBuffer')
  if (!body) return json({ error: 'not_found' }, 404)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
