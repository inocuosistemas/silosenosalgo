/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { genId } from '../../../../shared/ids'
import type { AjustePunto, PasoManual, TipoPunto } from '../../../../shared/wireTypes'
import { leeAjustes } from '../../../lib/puntos'
import { cierraEvento, leePasosManuales } from '../../../lib/eventStats'

/**
 * POST /api/events/:id/puntos — cambiar en el EVENTO los puntos del
 * recorrido sin volver a publicar la ruta: qué es cada uno, cuánto se para,
 * dónde está de verdad, y añadir o quitar puntos que la ruta no trae. Lo
 * cambiado manda sobre lo que trae la ruta.
 *
 * Body:
 * - Un punto de la ruta: `{ km, aid?, pausa?, pos? }` — `km` es el suyo EN LA
 *   RUTA (su identidad), `pos` dónde está de verdad. Todo a null lo devuelve
 *   a lo que diga la ruta.
 * - Uno añadido: `{ clave?, nombre, pos, aid?, pausa? }` (sin clave, se crea),
 *   o `{ clave, borrar: true }` para quitarlo.
 *
 * Al mover un punto se van con él los avisos de paso que aún esperan y los
 * pasos anotados a mano ahí: eran de ESE punto, no de ese kilómetro.
 *
 * Solo quien organiza.
 */

const TIPOS: TipoPunto[] = ['control', 'liquido', 'solido', 'completo', 'bolsa', 'meta']
const MAX_PUNTOS = 200
const NOMBRE_MAX = 60

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{
    km?: unknown; aid?: unknown; pausa?: unknown; pos?: unknown; clave?: unknown; nombre?: unknown; borrar?: unknown
  }>(request)) || {}
  const aid = typeof body.aid === 'string' && (TIPOS as string[]).includes(body.aid) ? body.aid as TipoPunto : null
  if (body.aid != null && !aid) return json({ error: 'invalid_request' }, 400)
  let pausa: number | null = null
  if (body.pausa != null) {
    if (typeof body.pausa !== 'number' || !Number.isFinite(body.pausa) || body.pausa < 0 || body.pausa > 600) return json({ error: 'invalid_request' }, 400)
    pausa = Math.round(body.pausa)
  }

  const row = await env.DB.prepare('SELECT puntos_ajustes AS ajustes, plan_total_km AS total, ended_at AS endedAt FROM events WHERE id = ?')
    .bind(id).first<{ ajustes: string | null; total: number | null; endedAt: number | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  const maxKm = row.total != null ? row.total + 0.5 : 1000
  let pos: number | null = null
  if (body.pos != null) {
    if (typeof body.pos !== 'number' || !Number.isFinite(body.pos) || body.pos < 0 || body.pos > maxKm) return json({ error: 'invalid_request' }, 400)
    pos = Math.round(body.pos * 100) / 100
  }

  const ajustes = leeAjustes(row.ajustes) ?? {}
  let clave: string
  /** Dónde estaba y dónde queda, para llevarse sus avisos y pasos. */
  let antes: number | null = null
  let despues: number | null = null

  if (typeof body.clave === 'string' || typeof body.nombre === 'string') {
    // Un punto AÑADIDO en el evento.
    if (typeof body.clave === 'string' && !/^n[A-Za-z0-9_-]{4,24}$/.test(body.clave)) return json({ error: 'invalid_request' }, 400)
    clave = typeof body.clave === 'string' ? body.clave : `n${genId(8)}`
    const previo = ajustes[clave]
    if (typeof body.clave === 'string' && (!previo || !previo.nuevo)) return json({ error: 'not_found' }, 404)
    antes = previo?.km ?? null
    if (body.borrar === true) {
      delete ajustes[clave]
      // Sus avisos pendientes ya no tienen punto por el que sonar.
      if (antes != null) {
        await env.DB.prepare('DELETE FROM event_avisos WHERE event_id = ? AND disparado_at IS NULL AND ABS(km - ?) < 0.05')
          .bind(id, antes).run()
      }
      antes = null
    } else {
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, NOMBRE_MAX) : (previo?.nombre ?? '')
      const km = pos ?? previo?.km ?? null
      if (!nombre || km == null) return json({ error: 'invalid_request' }, 400)
      if (!previo && Object.keys(ajustes).length >= MAX_PUNTOS) return json({ error: 'invalid_request' }, 400)
      ajustes[clave] = { nuevo: true, nombre, km, aid: aid ?? previo?.aid ?? 'control', ...(pausa != null ? { pausa } : {}) }
      despues = km
    }
  } else {
    // Un punto de la RUTA.
    if (typeof body.km !== 'number' || !Number.isFinite(body.km) || body.km < 0) return json({ error: 'invalid_request' }, 400)
    clave = body.km.toFixed(2)
    antes = ajustes[clave]?.km ?? body.km
    // `pos` que no se ha pedido: se queda donde estaba (cambiar el tipo no lo devuelve a su sitio).
    const sitio = 'pos' in body ? pos : (ajustes[clave]?.km ?? null)
    const movido = sitio != null && Math.abs(sitio - body.km) >= 0.005 ? sitio : null
    const a: AjustePunto = { ...(aid ? { aid } : {}), ...(pausa != null ? { pausa } : {}), ...(movido != null ? { km: movido } : {}) }
    if (Object.keys(a).length === 0) delete ajustes[clave]
    else ajustes[clave] = a
    despues = movido ?? body.km
  }

  await env.DB.prepare('UPDATE events SET puntos_ajustes = ? WHERE id = ?')
    .bind(Object.keys(ajustes).length ? JSON.stringify(ajustes) : null, id).run()

  if (antes != null && despues != null && Math.abs(antes - despues) >= 0.005) {
    await mueveLoDelPunto(env, id, antes, despues)
    if (row.endedAt) await cierraEvento(env, id, row.endedAt, row.total)
  }
  return json({ puntosAjustes: ajustes, clave }, 200)
}

/** Los avisos que aún esperan y los pasos a mano del punto que se ha movido, a su sitio nuevo. */
async function mueveLoDelPunto(env: Env, id: string, antes: number, despues: number): Promise<void> {
  await env.DB.prepare('UPDATE event_avisos SET km = ? WHERE event_id = ? AND disparado_at IS NULL AND ABS(km - ?) < 0.05')
    .bind(despues, id, antes).run()
  const { results } = await env.DB.prepare(
    'SELECT user_id AS userId, manual_pasos AS pasos FROM event_members WHERE event_id = ? AND manual_pasos IS NOT NULL',
  ).bind(id).all<{ userId: string; pasos: string | null }>()
  for (const f of results ?? []) {
    const pasos = leePasosManuales(f.pasos)
    if (!pasos || !pasos.some(([k]) => Math.abs(k - antes) < 0.05)) continue
    // Si ya hay un paso anotado en el sitio nuevo, manda ese.
    const hayYa = pasos.some(([k]) => Math.abs(k - despues) < 0.05)
    const nuevos = pasos
      .flatMap((p): PasoManual[] => (Math.abs(p[0] - antes) < 0.05 ? (hayYa ? [] : [[despues, ...p.slice(1)] as PasoManual]) : [p]))
      .sort((a, b) => a[0] - b[0])
    await env.DB.prepare('UPDATE event_members SET manual_pasos = ? WHERE event_id = ? AND user_id = ?')
      .bind(JSON.stringify(nuevos), id, f.userId).run()
  }
}
