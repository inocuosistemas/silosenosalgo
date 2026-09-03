/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json } from '../../../../lib/http'
import { TOKEN_RE } from '../../../../../shared/validate'
import { construyeReplay } from '../../../../lib/replay'

/**
 * GET /api/events/public/:token/replay — la carrera entera para quien no corre.
 *
 * Quien espera en meta es justo el que quiere volver a verla: llegó tarde, se
 * perdió el paso por el km 20 o quiere enseñarle a alguien cómo fue. Enseña lo
 * mismo que el mapa público —nombres, colores y posiciones— y ni un id de
 * cuenta ni un token de baliza.
 */

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = String(params.token)
  if (!TOKEN_RE.test(token)) return json({ error: 'bad_id' }, 400)
  const ev = await env.DB.prepare('SELECT id FROM events WHERE public_token = ?')
    .bind(token).first<{ id: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  return json(await construyeReplay(env, ev.id), 200, { 'Cache-Control': 'no-store' })
}
