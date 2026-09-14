/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json } from '../../../../lib/http'
import { getSessionUser } from '../../../../lib/session'
import { TOKEN_RE } from '../../../../../shared/validate'
import { puedeVerEvento } from '../../../../lib/fotosEvento'
import { kmEnElMomento } from '../../../../lib/eventStats'

/**
 * GET /api/events/:id/fotos/sugerencia?at=<ms> — por qué km iba quien pregunta a
 * esa hora, según su traza.
 *
 * Para proponer dónde se hizo una foto que no trae ubicación: sabiendo CUÁNDO se
 * hizo, lo más probable es que fuera ahí. Es solo el punto de partida del
 * selector; quien la sube la mueve si no.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeVerEvento(env, id, user))) return json({ error: 'not_found' }, 404)

  const at = Number(new URL(request.url).searchParams.get('at'))
  const km = Number.isFinite(at) && at > 0 ? await kmEnElMomento(env, id, user.id, at) : null
  return json({ km: km === null ? null : Math.round(km * 10) / 10 }, 200, { 'Cache-Control': 'no-store' })
}
