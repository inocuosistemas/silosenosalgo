/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'

/**
 * La foto del evento (el cartel de la carrera), en KV como el resto de medios
 * mientras no haya R2. Clave: `eventphoto:<id>`.
 *
 *  PUT /api/events/:id/photo — solo quien creó el evento. JPEG ya reescalado
 *      por el cliente; el tope es el mismo que el de las fotos de nota.
 *  GET /api/events/:id/photo — pública, como el media de las notas: el id del
 *      evento es inadivinable (16 bytes) y una foto de cartel no es un secreto.
 */

const CAP = 1_500_000
const TTL_SECONDS = 365 * 24 * 3600 // un año, como la base del plan

function photoKvKey(id: string): string {
  return `eventphoto:${id}`
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev || ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'invalid_request' }, 400)
  if (buf.byteLength > CAP) return json({ error: 'too_large' }, 413)

  const key = photoKvKey(id)
  await env.SHARE_KV.put(key, buf, { expirationTtl: TTL_SECONDS })
  // `photo_at` es la versión de la URL: sin ella, reencuadrar no cambia nada
  // que las cachés puedan notar y cada uno ve la foto que le tocó.
  await env.DB.prepare('UPDATE events SET photo_key = ?, photo_at = ? WHERE id = ? AND created_by = ?')
    .bind(key, Date.now(), id, user.id).run()
  return new Response(null, { status: 204 })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const body = await env.SHARE_KV.get(photoKvKey(id), 'arrayBuffer')
  if (!body) return json({ error: 'not_found' }, 404)
  // Con versión en la URL (`?v=<photo_at>`) el contenido de ESA url no va a
  // cambiar nunca: se puede cachear a lo bestia, y un reencuadre llega igual
  // porque estrena url. Sin versión —eventos con foto anterior a photo_at— la
  // caché tiene que ser corta o quien mire se quedaría clavado en la vieja.
  const versioned = new URL(request.url).searchParams.has('v')
  return new Response(body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    },
  })
}
