/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'

/**
 * POST /api/push/register — este aparato quiere que le avisen.
 *
 * Lo llama la app nativa en cuanto iOS le da su token de APNs, que es en cada
 * arranque: el token puede cambiar —reinstalar, restaurar una copia de
 * seguridad— y quien lo tiene fresco es el sistema, no nosotros. Por eso es un
 * `INSERT ... ON CONFLICT` y no un alta de una vez: llamar mil veces con el
 * mismo token solo refresca `last_seen_at`.
 *
 * El token va atado al USUARIO de la sesión, no al aparato a secas: si dos
 * personas comparten un iPad, los ánimos de cada una tienen que sonar mientras
 * sea ella la que está dentro, y por eso al cambiar de cuenta se sobreescribe el
 * dueño del token en vez de duplicar la fila.
 *
 * DELETE con el mismo token lo da de baja, que es lo que hay que hacer al salir
 * de la cuenta: si no, el móvil seguiría recibiendo los ánimos de quien ya no lo
 * usa.
 */

const TOKEN_APNS_RE = /^[0-9a-f]{64,200}$/i

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ token?: unknown; platform?: unknown }>(request)) || {}
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!TOKEN_APNS_RE.test(token)) return json({ error: 'bad_token' }, 400)
  // Hoy solo iOS. Se valida en vez de aceptar cualquier cosa para que el envío
  // no tenga que adivinar a qué servicio llamar.
  const platform = body.platform === 'ios' ? 'ios' : 'ios'

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO push_devices (token, user_id, platform, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, last_seen_at = excluded.last_seen_at`,
  ).bind(token, user.id, platform, now, now).run()

  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ token?: unknown }>(request)) || {}
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return json({ error: 'bad_token' }, 400)

  // Con el dueño en el WHERE: nadie da de baja el aparato de otro por tener su
  // token.
  await env.DB.prepare('DELETE FROM push_devices WHERE token = ? AND user_id = ?')
    .bind(token, user.id).run()
  return new Response(null, { status: 204 })
}
