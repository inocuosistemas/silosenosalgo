/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, rateLimited } from '../../lib/http'
import { bearerToken, getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'

/**
 * POST /api/auth/pase — un pase de un solo uso para abrir la web ya dentro.
 *
 * La app de la baliza tiene su sesión (el token), pero la parrilla, la porra y
 * tu plan viven en la web, y el navegador no sabe nada de ese token: al abrir
 * la carrera desde la app, la web pedía entrar otra vez. Con esto la app pide
 * un pase y abre `/api/auth/entra?pase=…&a=<sección>`, que lo cambia por una
 * sesión del navegador y lleva a la sección.
 *
 * El pase no es la sesión: dura dos minutos, sirve una vez y solo lo consigue
 * quien ya tiene un token válido. Solo con token: una cookie ya es una sesión
 * web y no necesita pase.
 */
export const PASE_TTL_S = 120

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  if (!bearerToken(request)) return json({ error: 'unauthorized' }, 401)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (await rateLimited(env, `pase:${user.id}`, 30, 600)) return json({ error: 'rate_limited' }, 429)

  const pase = genId(16)
  await env.SHARE_KV.put(`pase:${pase}`, user.id, { expirationTtl: PASE_TTL_S })
  return json({ pase }, 200, { 'Cache-Control': 'no-store' })
}
