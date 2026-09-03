/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { cierraEvento } from '../../../lib/eventStats'

/**
 * POST /api/events/:id/end — terminar la carrera (o reabrirla).
 *
 * `{ end: true }` la cierra AHORA y congela los resultados; `{ end: false }` la
 * reabre y los tira. Solo quien organiza.
 *
 * Hace falta aunque exista el cierre automático por hora límite: una quedada de
 * los martes no tiene hora de cierre de meta, una carrera se suspende a mitad y
 * un organizador puede querer cerrar en cuanto entra el último en vez de
 * esperar a que pase el corte. Y al revés: si se cierra por error, reabrirla no
 * puede exigir crear otro evento y volver a repartir el código.
 *
 * Al reabrir se borran los resultados a propósito. Unos resultados de hace un
 * rato, con gente todavía en carrera, dirían que ganó quien iba primero
 * entonces — y se volverían a calcular al cerrar de nuevo.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await env.DB.prepare(
    'SELECT created_by AS createdBy, plan_total_km AS totalKm FROM events WHERE id = ?',
  ).bind(id).first<{ createdBy: string; totalKm: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.createdBy !== user.id) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ end?: unknown; recompute?: unknown }>(request)) || {}
  const cerrar = body.end !== false

  // Recalcular sin reabrir: los resultados se congelan al cerrar, y eso es lo
  // que se quiere —las trazas se purgan— pero significa que se quedan con el
  // criterio que hubiera ese día. Cuando el criterio mejora, hay que poder
  // volver a pasarlo sin tocar la hora de cierre ni la carrera.
  if (body.recompute === true) {
    const ev2 = await env.DB.prepare('SELECT ended_at AS endedAt FROM events WHERE id = ?')
      .bind(id).first<{ endedAt: number | null }>()
    if (!ev2?.endedAt) return json({ error: 'not_ended' }, 409)
    await cierraEvento(env, id, ev2.endedAt, ev.totalKm)
    return new Response(null, { status: 204 })
  }

  if (cerrar) {
    // `ended_at` se fija con COALESCE dentro de cierraEvento: cerrar dos veces
    // no mueve la hora del cierre ya dado.
    await cierraEvento(env, id, Date.now(), ev.totalKm)
  } else {
    await env.DB.prepare('UPDATE events SET ended_at = NULL, stats = NULL WHERE id = ? AND created_by = ?')
      .bind(id, user.id).run()
  }

  return new Response(null, { status: 204 })
}
