/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../../lib/db'
import { json } from '../../../../../lib/http'
import { TOKEN_RE } from '../../../../../../shared/validate'
import { FOTO_ID_RE } from '../../../../../../shared/fotos'
import { bytesDeFoto } from '../../../../../lib/fotosEvento'

/** GET /api/events/public/:token/fotos/:fotoId — una foto del evento, por el enlace público. */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = String(params.token)
  const fotoId = String(params.fotoId)
  if (!TOKEN_RE.test(token) || !FOTO_ID_RE.test(fotoId)) return json({ error: 'bad_id' }, 400)
  const ev = await env.DB.prepare('SELECT id FROM events WHERE public_token = ?').bind(token).first<{ id: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  const bytes = await bytesDeFoto(env, ev.id, fotoId)
  if (!bytes) return json({ error: 'not_found' }, 404)
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  })
}
