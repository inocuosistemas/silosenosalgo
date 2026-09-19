/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE } from '../../../../shared/validate'
import { cierraEvento, leePasosManuales } from '../../../lib/eventStats'
import { disparaAvisos } from '../../../lib/avisos'

/**
 * POST /api/events/:id/manual — pasar a alguien a MODO MANUAL y anotar sus
 * pasos por los controles.
 *
 * Para cuando su baliza no sirve: se quedó sin batería en el km 12, o no la
 * llevaba. La carrera tiene su cronometraje oficial —la app de la
 * organización dice "Pujalt 07:21"— y con esos pasos se le sigue contando:
 * en el mapa, en la clasificación y en la porra. Mandan sobre su traza.
 *
 * Body, una cosa por llamada:
 *   `{ username, modo: true }`   — pasarlo a manual (sin pasos todavía).
 *   `{ username, modo: false }`  — devolverlo a su baliza. Borra los pasos.
 *   `{ username, km, at }`       — anotar (o corregir) su paso por el km `km`
 *                                   a la hora `at` (epoch ms). Lo pone en manual.
 *   `{ username, km, at: null }` — borrar el paso de ese km.
 *
 * Solo quien organiza: es un dato oficial de la carrera, no de cada uno.
 */

const MAX_PASOS = 100

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ username?: unknown; modo?: unknown; km?: unknown; at?: unknown }>(request)) || {}
  if (typeof body.username !== 'string' || !body.username.trim()) return json({ error: 'invalid_request' }, 400)

  const ev = await env.DB.prepare(
    'SELECT starts_at AS startsAt, ended_at AS endedAt, plan_total_km AS km FROM events WHERE id = ?',
  ).bind(id).first<{ startsAt: number | null; endedAt: number | null; km: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)

  const fila = await env.DB.prepare(
    `SELECT m.user_id AS userId, m.manual_pasos AS pasos FROM event_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.event_id = ? AND u.username = ?`,
  ).bind(id, body.username.trim()).first<{ userId: string; pasos: string | null }>()
  if (!fila) return json({ error: 'not_found' }, 404)

  let nuevo: string | null
  /** El paso recién anotado, para los avisos: se disparan después de guardarlo. */
  let avisar: { desde: number; km: number; at: number } | null = null
  if (body.modo === false) {
    nuevo = null
  } else if (body.modo === true) {
    nuevo = fila.pasos ?? '[]'
  } else {
    if (typeof body.km !== 'number' || !Number.isFinite(body.km) || body.km < 0) return json({ error: 'invalid_request' }, 400)
    const km = Math.round(body.km * 100) / 100
    let pasos = leePasosManuales(fila.pasos) ?? []
    // Hasta dónde se sabía que había llegado ANTES de este paso: los avisos
    // entre eso y este km son los que acaba de cruzar. Sin pasos anteriores,
    // solo los de justo este punto: los de antes los cruzó a otra hora.
    const antes = pasos.filter(([k]) => k < km - 0.05).reduce((m, [k]) => Math.max(m, k), -1)
    const desdeAviso = antes >= 0 ? antes : km - 0.5
    pasos = pasos.filter(([k]) => Math.abs(k - km) >= 0.05)
    if (body.at !== null) {
      if (typeof body.at !== 'number' || !Number.isFinite(body.at) || body.at <= 0) return json({ error: 'invalid_request' }, 400)
      const at = Math.round(body.at)
      // Ni antes de la salida ni en el futuro: es un paso que ya ha ocurrido.
      if (ev.startsAt !== null && at < ev.startsAt) return json({ error: 'invalid_request' }, 400)
      if (at > Date.now() + 5 * 60_000) return json({ error: 'invalid_request' }, 400)
      pasos.push([km, at])
      avisar = { desde: desdeAviso, km, at }
    }
    pasos.sort((a, b) => a[0] - b[0])
    if (pasos.length > MAX_PASOS) return json({ error: 'invalid_request' }, 400)
    nuevo = JSON.stringify(pasos)
  }

  await env.DB.prepare('UPDATE event_members SET manual_pasos = ? WHERE event_id = ? AND user_id = ?')
    .bind(nuevo, id, fila.userId).run()
  if (avisar) waitUntil(disparaAvisos(env, id, fila.userId, avisar.desde, avisar.km, avisar.at).catch(() => 0))
  // Con la carrera cerrada, sus resultados se rehacen: es para lo que sirve.
  if (ev.endedAt) await cierraEvento(env, id, ev.endedAt, ev.km)
  return new Response(null, { status: 204 })
}
