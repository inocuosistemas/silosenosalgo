/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { INVITE_RE } from '../../../../shared/validate'

/**
 * DELETE /api/admin/invites/:code → borrar una invitación. Solo administradores.
 *
 * Hace falta porque una invitación caducada o ya usada se queda en la lista
 * para siempre: no sirve para nada (el registro la rechaza con un 410) y solo
 * estorba entre las que sí valen.
 *
 * Se puede borrar CUALQUIERA, también una usada. No se protege la usada aunque
 * sea el único registro de qué cuenta salió de ella: quien borra es el
 * administrador, la lista dice a la vista quién la usó antes de borrarla, y
 * poner reglas de "esta sí y esta no" en una pantalla de limpieza acaba
 * dejando basura que no hay forma de quitar.
 *
 * Borrar la invitación NO toca la cuenta que se creó con ella: `used_by` es una
 * columna suelta, sin clave foránea ni cascada. Es a propósito — el borrado de
 * una fila de auditoría nunca puede llevarse por delante a un usuario.
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const code = String(params.code)
  // Se valida el formato antes de tocar la base: un código que no puede existir
  // se contesta igual que uno que no existe, sin consultar nada.
  if (!INVITE_RE.test(code)) return json({ error: 'not_found' }, 404)

  const row = await env.DB.prepare('SELECT code FROM invitations WHERE code=?').bind(code).first()
  if (!row) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('DELETE FROM invitations WHERE code=?').bind(code).run()
  return new Response(null, { status: 204 })
}
