/// <reference types="@cloudflare/workers-types" />

/**
 * GET /api/share/:id — return the gzipped "salida" blob stored under `id`.
 *
 * The content for a given id is immutable (random id → unique payload), so it's
 * safe to cache aggressively. The client gunzips the body (see shareTransport).
 */

import type { Env } from '../../lib/db'
import { claveArchivo } from '../../lib/archivo'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id)
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return json({ error: 'bad_id' }, 400)

  // Si ya caducó y es el recorrido de un evento guardado, sale del archivo: el
  // mapa, el replay y los resultados de una carrera no pueden quedarse sin
  // recorrido al año de correrla. Ver `lib/archivo`.
  const body = await env.SHARE_KV.get(id, 'arrayBuffer') ?? await recorridoArchivado(env, id)
  if (!body) return json({ error: 'not_found' }, 404)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

/** El recorrido guardado del evento que usaba este enlace, si lo hay. */
async function recorridoArchivado(env: Env, shareId: string): Promise<ArrayBuffer | null> {
  const ev = await env.DB.prepare('SELECT id FROM events WHERE plan_share_id = ? AND archived_at IS NOT NULL')
    .bind(shareId).first<{ id: string }>()
  return ev ? env.SHARE_KV.get(claveArchivo.plan(ev.id), 'arrayBuffer') : null
}
