/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { genId } from '../../../../shared/ids'
import type { CreateInviteResponse } from '../../../../shared/wireTypes'

/**
 * POST /api/events/:id/invite — regenera el código de unión del evento.
 *
 * Es la única forma de revocar: el código es multiuso y ya está pegado en algún
 * chat, así que "borrarlo" no significa nada — lo que se hace es cambiarlo, y
 * el viejo deja de valer al instante. Quien ya está dentro sigue dentro: el
 * código solo sirve para entrar.
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

  const code = genId(12)
  await env.DB.prepare('UPDATE events SET invite_code = ? WHERE id = ? AND created_by = ?')
    .bind(code, id, user.id).run()

  const res: CreateInviteResponse = { code }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
