/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'

/**
 * DELETE /api/admin/users/:id — borra una cuenta.
 *
 * Se lleva por delante TODO lo suyo por las claves foráneas en cascada: sus
 * seguimientos con sus notas, sus previsiones, sus membresías de evento y
 * —esto sorprende— los eventos que haya creado, con sus participantes. Por eso
 * la lista de cuentas enseña esos recuentos: para decidir con datos y no a
 * ciegas.
 *
 * Lo que NO se borra es la invitación que usó: no tiene clave foránea a
 * propósito, así que queda en el registro como "usada por una cuenta que ya no
 * existe", que es exactamente lo que pasó.
 *
 * Nadie puede borrarse a sí mismo. No es paternalismo: si el único
 * administrador se borra, no queda quien invite ni quien administre, y eso no
 * se arregla desde la aplicación.
 */

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!user.isAdmin) return json({ error: 'forbidden' }, 403)

  const id = String(params.id)
  if (id === user.id) return json({ error: 'cannot_delete_self' }, 409)

  // La existencia se comprueba con un SELECT y no con `meta.changes`, que en
  // producción no es de fiar (misma regla que en todo el proyecto).
  const target = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first<{ id: string }>()
  if (!target) return json({ error: 'not_found' }, 404)

  await env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run()
  return new Response(null, { status: 204 })
}
