/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import type { TipoPunto } from '../../../../shared/wireTypes'
import { leeAjustes } from '../../../lib/puntos'

/**
 * POST /api/events/:id/puntos — cambiar en el EVENTO qué es un punto del
 * recorrido (avituallamiento, bolsa de vida…) y cuánto se para, sin volver a
 * publicar la ruta. Lo cambiado manda sobre lo que trae la ruta.
 *
 * Body: `{ km, aid?: tipo|null, pausa?: min|null }`. `null` (o nada) en los
 * dos devuelve el punto a lo que diga la ruta.
 *
 * Solo quien organiza.
 */

const TIPOS: TipoPunto[] = ['control', 'liquido', 'solido', 'completo', 'bolsa', 'meta']

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ km?: unknown; aid?: unknown; pausa?: unknown }>(request)) || {}
  if (typeof body.km !== 'number' || !Number.isFinite(body.km) || body.km < 0) return json({ error: 'invalid_request' }, 400)
  const aid = typeof body.aid === 'string' && (TIPOS as string[]).includes(body.aid) ? body.aid as TipoPunto : null
  if (body.aid != null && !aid) return json({ error: 'invalid_request' }, 400)
  let pausa: number | null = null
  if (body.pausa != null) {
    if (typeof body.pausa !== 'number' || !Number.isFinite(body.pausa) || body.pausa < 0 || body.pausa > 600) return json({ error: 'invalid_request' }, 400)
    pausa = Math.round(body.pausa)
  }

  const row = await env.DB.prepare('SELECT puntos_ajustes AS ajustes FROM events WHERE id = ?').bind(id).first<{ ajustes: string | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  const ajustes = leeAjustes(row.ajustes) ?? {}
  const clave = body.km.toFixed(2)
  if (aid == null && pausa == null) delete ajustes[clave]
  else ajustes[clave] = { ...(aid ? { aid } : {}), ...(pausa != null ? { pausa } : {}) }
  await env.DB.prepare('UPDATE events SET puntos_ajustes = ? WHERE id = ?')
    .bind(Object.keys(ajustes).length ? JSON.stringify(ajustes) : null, id).run()
  return json({ puntosAjustes: ajustes }, 200)
}
