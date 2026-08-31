/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { genId } from '../../../../shared/ids'

/**
 * POST /api/events/:id/public — publica (o deja de publicar) el evento.
 *
 * `{ share: true }` genera un token de enlace público; llamarlo otra vez genera
 * uno NUEVO, que es la forma de revocar el anterior sin dejar de compartir.
 * `{ share: false }` lo quita del todo: el enlace repartido deja de funcionar
 * al instante.
 *
 * Solo el organizador. Publicar el evento enseña nombres, colores y posiciones
 * de TODOS los participantes a quien tenga el enlace, así que no es una
 * decisión que pueda tomar cualquiera de ellos por su cuenta.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
    .bind(id).first<{ createdBy: string }>()
  if (!ev || ev.createdBy !== user.id) return json({ error: 'not_found' }, 404)

  const body = (await readJson<{ share?: unknown }>(request)) || {}
  const share = body.share !== false
  // 16 bytes como el token de una baliza: el enlace circula por chats de
  // familia y tiene que ser inadivinable.
  const token = share ? genId(16) : null

  await env.DB.prepare('UPDATE events SET public_token = ? WHERE id = ? AND created_by = ?')
    .bind(token, id, user.id).run()

  return json({ publicToken: token }, 200, { 'Cache-Control': 'no-store' })
}
