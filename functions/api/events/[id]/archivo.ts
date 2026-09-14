/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { guardaEvento } from '../../../lib/archivo'

/**
 * POST /api/events/:id/archivo — guardar el evento ahora.
 *
 * El evento se guarda solo al cerrar. Esto es para quien organiza: repetirlo
 * después de corregir algo —un abandono, el recorrido— o guardar uno que se
 * cerró antes de que existiera el archivo. Solo con la carrera cerrada: guardar
 * media carrera dejaría un replay que se corta a mitad.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare('SELECT ended_at AS endedAt FROM events WHERE id = ?')
    .bind(id).first<{ endedAt: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)
  if (ev.endedAt === null) return json({ error: 'not_ended' }, 409)

  return json(await guardaEvento(env, id), 200, { 'Cache-Control': 'no-store' })
}
