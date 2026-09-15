/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { claveArchivo } from '../../../lib/archivo'
import { PAQUETE_MAX_BYTES, validaPaquete } from '../../../../shared/maquetaPaquete'

/**
 * GET y PUT /api/share/:id/maqueta — el paquete de la maqueta de un recorrido
 * (ver `shared/maquetaPaquete`).
 *
 * No se calcula aquí: leer veinte mosaicos de alturas y otros tantos de mapa
 * es trabajo de navegador, con canvas, y de más CPU de la que un Worker
 * garantiza. Lo calcula el PRIMERO que abre la maqueta con sesión y lo sube;
 * a partir de ahí todos —también quien mira sin cuenta— bajan el fichero.
 *
 * El recorrido compartido no cambia nunca bajo un mismo id, así que su
 * paquete tampoco: se guarda una vez y no se pisa, y se sirve con caché
 * larga. Quien sube tiene que tener sesión y el paquete tiene que estar bien
 * formado y cuadrar con su rejilla; más allá de eso no se puede comprobar
 * que las alturas sean las de verdad, y por eso solo escribe gente con cuenta.
 */

const ID_RE = /^[A-Za-z0-9_-]{8,32}$/
const clave = (id: string) => `maqueta:1:${id}`

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id)
  if (!ID_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const body = await env.SHARE_KV.get(clave(id), 'arrayBuffer')
  if (!body) return json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id)
  if (!ID_RE.test(id)) return json({ error: 'bad_id' }, 400)

  const largo = Number(request.headers.get('Content-Length') ?? 0)
  if (largo > PAQUETE_MAX_BYTES) return json({ error: 'too_large' }, 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > PAQUETE_MAX_BYTES) return json({ error: 'too_large' }, 413)
  if (!validaPaquete(bytes)) return json({ error: 'invalid_request' }, 400)

  // Solo de recorridos que existen: un id inventado no se convierte en sitio
  // donde dejar cosas.
  if (!(await hayRecorrido(env, id))) return json({ error: 'not_found' }, 404)

  // El primero que llega manda; los demás ya lo encuentran hecho.
  const ya = await env.SHARE_KV.list({ prefix: clave(id), limit: 1 })
  if (ya.keys.some((k) => k.name === clave(id))) return json({ ok: true, ya: true })
  await env.SHARE_KV.put(clave(id), bytes)
  return json({ ok: true })
}

async function hayRecorrido(env: Env, id: string): Promise<boolean> {
  const vivo = await env.SHARE_KV.list({ prefix: id, limit: 1 })
  if (vivo.keys.some((k) => k.name === id)) return true
  const ev = await env.DB.prepare('SELECT id FROM events WHERE plan_share_id = ? AND archived_at IS NOT NULL')
    .bind(id).first<{ id: string }>()
  if (!ev) return false
  const archivado = await env.SHARE_KV.list({ prefix: claveArchivo.plan(ev.id), limit: 1 })
  return archivado.keys.some((k) => k.name === claveArchivo.plan(ev.id))
}
