/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json, csrfOk } from '../../../../lib/http'
import { getSessionUser } from '../../../../lib/session'
import { puedeOrganizar } from '../../../../lib/organiza'
import { TOKEN_RE } from '../../../../../shared/validate'
import { FOTO_ID_RE } from '../../../../../shared/fotos'
import { bytesDeFoto, claveFoto } from '../../../../lib/fotosEvento'

/**
 * GET    /api/events/:id/fotos/:fotoId — la foto.
 * DELETE /api/events/:id/fotos/:fotoId — borrar una subida (quien la subió u organiza).
 *
 * El GET no pide sesión, como la foto del evento: los dos identificadores son
 * inadivinables y las fotos se ven también por el enlace público.
 */

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id)
  const fotoId = String(params.fotoId)
  if (!TOKEN_RE.test(id) || !FOTO_ID_RE.test(fotoId)) return json({ error: 'bad_id' }, 400)
  const bytes = await bytesDeFoto(env, id, fotoId)
  if (!bytes) return json({ error: 'not_found' }, 404)
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const fotoId = String(params.fotoId)
  if (!TOKEN_RE.test(id) || !FOTO_ID_RE.test(fotoId)) return json({ error: 'bad_id' }, 400)
  // Las de las notas se borran desde la baliza, que es donde se hicieron.
  if (!fotoId.startsWith('s_')) return json({ error: 'from_beacon' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const fila = await env.DB.prepare('SELECT user_id AS autorId FROM event_photos WHERE id = ? AND event_id = ?')
    .bind(fotoId.slice(2), id).first<{ autorId: string }>()
  if (!fila) return json({ error: 'not_found' }, 404)
  if (fila.autorId !== user.id && !(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  await env.SHARE_KV.delete(claveFoto(id, fotoId.slice(2)))
  await env.DB.prepare('DELETE FROM event_photos WHERE id = ? AND event_id = ?').bind(fotoId.slice(2), id).run()
  return new Response(null, { status: 204 })
}
