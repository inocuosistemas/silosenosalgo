/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json } from '../../../../lib/http'
import { TOKEN_RE } from '../../../../../shared/validate'
import type { EventFotosResponse } from '../../../../../shared/wireTypes'
import { fotosDelEvento, paraEnviar } from '../../../../lib/fotosEvento'

/**
 * GET /api/events/public/:token/fotos — las fotos del evento para quien lo sigue
 * por el enlace público. Las mismas que ven los participantes, servidas por el
 * token público: el identificador del evento no sale de aquí.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = String(params.token)
  if (!TOKEN_RE.test(token)) return json({ error: 'bad_id' }, 400)
  const ev = await env.DB.prepare('SELECT id FROM events WHERE public_token = ?').bind(token).first<{ id: string }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  const fotos = (await fotosDelEvento(env, ev.id)).map((f) =>
    paraEnviar(f, `/api/events/public/${encodeURIComponent(token)}/fotos/${f.id}`, false))
  const body: EventFotosResponse = { fotos }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}
