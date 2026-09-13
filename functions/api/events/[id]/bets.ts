/// <reference types="@cloudflare/workers-types" />
import { recordVivo, tocaRecordVivo } from '../../../lib/recordVivo'
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import type { EventBet, EventBetsResponse, EventBetsInput, BetKind } from '../../../../shared/wireTypes'

/**
 * La Porra de un evento: quién pronostica qué.
 *
 *   GET  /api/events/:id/bets — la porra entera, para pintarla y puntuarla.
 *   POST /api/events/:id/bets — los pronósticos de quien la manda, de una vez.
 *
 * El GET no pide sesión. La porra se ve donde se ve la carrera, y la carrera se
 * ve con el enlace público: pedir cuenta para MIRAR dejaría fuera justo a quien
 * espera en meta. Para PRONOSTICAR sí hace falta cuenta, que si no el ranking
 * no es de nadie.
 *
 * Por el cable van NOMBRES y no ids de cuenta, igual que en el mapa público: el
 * cliente ya identifica a cada participante por su nombre, y así esta ruta no
 * reparte ids por ahí. Los nombres son únicos (`users.username_ci`), así que la
 * traducción es exacta en los dos sentidos.
 *
 * Juega todo el mundo, incluidos los que corren y sobre sí mismos. Se probó lo
 * contrario —fuera quien esté en la parrilla, que decide el resultado con las
 * piernas— y el purismo salía caro: en una carrera de amigos, el que la monta
 * suele correrla, así que la regla dejaba fuera justo a quien más ganas tenía
 * de jugar. Entre un sistema íntegro que nadie usa y uno confiado que se llena
 * de gente, en una porra sin dinero gana el segundo.
 *
 * Lo que sí se mantiene es el cierre en la salida: a las dos horas de carrera,
 * acertar quién acaba no tiene mérito.
 */

/** Tope por jugador y evento: una parrilla enorme no puede volverse un ataque. */
const MAX_BETS = 300
/** Ventana admisible para una hora de meta: de la salida a tres días después. */
const FINISH_WINDOW_MS = 3 * 24 * 3600_000

interface EventRow {
  id: string; startsAt: number | null; betsEnabled: number; planTotalKm: number | null
  endedAt: number | null
}

async function loadEvent(env: Env, id: string): Promise<EventRow | null> {
  return env.DB.prepare(
    `SELECT id, starts_at AS startsAt, bets_enabled AS betsEnabled,
            plan_total_km AS planTotalKm, ended_at AS endedAt
       FROM events WHERE id = ?`,
  ).bind(id).first<EventRow>()
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const ev = await loadEvent(env, id)
  if (!ev) return json({ error: 'not_found' }, 404)

  const user = await getSessionUser(request, env)
  const enabled = ev.betsEnabled === 1
  const abierta = enabled && ev.startsAt !== null && Date.now() < ev.startsAt

  // Los pronósticos con los dos nombres resueltos: quien lo dice y a quién.
  const rows = await env.DB.prepare(
    `SELECT ua.username AS author, COALESCE(ut.username, '') AS target, b.kind, b.value,
            b.created_at AS createdAt
       FROM event_bets b
       JOIN users ua ON ua.id = b.user_id
       LEFT JOIN users ut ON ut.id = b.target_id
      WHERE b.event_id = ?
      ORDER BY b.created_at DESC`,
  ).bind(id).all<{ author: string; target: string; kind: string; value: string; createdAt: number }>()

  // Sin sesión, la porra se enseña en conjunto y sin firmas: cuántos dicen que
  // acaba, cuánto le dan de tiempo. Quién dijo qué —y el ranking, que es una
  // lista de nombres con nota— es para quien juega. El enlace público circula
  // por grupos de familia y no tiene por qué repartir eso.
  const anonimo = !user
  const bets: EventBet[] = (rows.results ?? []).map((r) => ({
    author: anonimo ? '' : r.author, target: r.target, kind: r.kind as BetKind, value: r.value,
    createdAt: r.createdAt,
  }))
  const players = new Set((rows.results ?? []).map((r) => r.author)).size

  let canBet = false
  let whyNot: EventBetsResponse['whyNot']
  if (!enabled) whyNot = 'desactivada'
  else if (!user) whyNot = 'anon'
  else if (!abierta) whyNot = 'cerrada'
  else canBet = true

  // El kilómetro más rápido de momento, para que el "cómo va" pueda decir quién
  // lo lleva y sumar esos pronósticos en provisional. Si falla, la porra se
  // enseña igual sin él. Ver `lib/recordVivo`.
  const recordAhora = tocaRecordVivo(ev, Date.now())
    ? await recordVivo(env, id, ev.planTotalKm ?? null, new URL(request.url).origin, waitUntil).catch(() => null)
    : null

  const res: EventBetsResponse = {
    enabled,
    startsAt: ev.startsAt,
    open: abierta,
    me: user?.username ?? null,
    canBet,
    ...(canBet ? {} : { whyNot }),
    ...(recordAhora ? { recordVivo: recordAhora } : {}),
    players,
    bets,
  }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const ev = await loadEvent(env, id)
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.betsEnabled !== 1) return json({ error: 'bets_disabled' }, 409)
  if (ev.startsAt === null || Date.now() >= ev.startsAt) return json({ error: 'bets_closed' }, 409)

  const body = (await readJson<EventBetsInput>(request)) || {}

  // La parrilla, por nombre: solo se pronostica sobre quien corre de verdad.
  const miembros = await env.DB.prepare(
    `SELECT u.id, u.username FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = ?`,
  ).bind(id).all<{ id: string; username: string }>()
  const idPorNombre = new Map((miembros.results ?? []).map((m) => [m.username, m.id]))

  const filas: { target: string; kind: BetKind; value: string }[] = []

  // El orden de llegada: una fila por participante con su puesto. Se manda tal
  // cual lo ordenó quien juega, y el puesto es la posición en esa lista.
  if (Array.isArray(body.order)) {
    const vistos = new Set<string>()
    for (const [i, nombre] of body.order.entries()) {
      if (typeof nombre !== 'string') return json({ error: 'invalid_request' }, 400)
      const target = idPorNombre.get(nombre)
      // Sin repetidos: dos personas no pueden llegar las dos terceras.
      if (!target || vistos.has(target)) return json({ error: 'invalid_request' }, 400)
      vistos.add(target)
      filas.push({ target, kind: 'order', value: String(i + 1) })
    }
  }

  if (typeof body.winner === 'string' && body.winner) {
    const target = idPorNombre.get(body.winner)
    if (!target) return json({ error: 'invalid_request' }, 400)
    // El ganador es de la carrera, no de un participante: `target_id` vacío y
    // el nombre en el valor. Así una porra por participante y una global no
    // compiten por la misma clave.
    filas.push({ target: '', kind: 'winner', value: target })
  }

  for (const [nombre, acaba] of Object.entries(body.finish ?? {})) {
    const target = idPorNombre.get(nombre)
    if (!target) return json({ error: 'invalid_request' }, 400)
    if (typeof acaba !== 'boolean') return json({ error: 'invalid_request' }, 400)
    filas.push({ target, kind: 'finish', value: acaba ? 'si' : 'no' })
  }

  for (const [nombre, at] of Object.entries(body.finishTime ?? {})) {
    const target = idPorNombre.get(nombre)
    if (!target) return json({ error: 'invalid_request' }, 400)
    if (typeof at !== 'number' || !Number.isFinite(at)) return json({ error: 'invalid_request' }, 400)
    const ms = Math.round(at)
    if (ms <= ev.startsAt || ms > ev.startsAt + FINISH_WINDOW_MS) return json({ error: 'invalid_request' }, 400)
    filas.push({ target, kind: 'finish_time', value: String(ms) })
  }

  /**
   * El kilómetro del abandono: la otra mitad de "no acaba".
   *
   * Se valida contra lo que mide el recorrido cuando se sabe —no se puede
   * abandonar en el km 300 de una de cien— y se guarda con un decimal, que es
   * la precisión con la que se elige y con la que se puntúa.
   */
  for (const [nombre, km] of Object.entries(body.abandonKm ?? {})) {
    const target = idPorNombre.get(nombre)
    if (!target) return json({ error: 'invalid_request' }, 400)
    if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return json({ error: 'invalid_request' }, 400)
    if (ev.planTotalKm != null && km > ev.planTotalKm) return json({ error: 'invalid_request' }, 400)
    filas.push({ target, kind: 'abandon_km', value: String(Math.round(km * 10) / 10) })
  }

  /**
   * Quién firma el kilómetro más rápido de la carrera.
   *
   * Va con `target_id` puesto y no con el nombre en el valor —como hacía la
   * apuesta vieja del ganador—, porque el `target_id` lo resuelve a nombre el
   * SELECT del GET. Con el id en el valor, el enlace público de la porra
   * repartiría ids de cuenta a cualquiera que lo abra.
   */
  if (typeof body.fastestKm === 'string' && body.fastestKm) {
    const target = idPorNombre.get(body.fastestKm)
    if (!target) return json({ error: 'invalid_request' }, 400)
    filas.push({ target, kind: 'fastest_km', value: '1' })
  }

  if (filas.length > MAX_BETS) return json({ error: 'too_large' }, 413)

  // Se manda la porra ENTERA y se reemplaza entera: quitar un pronóstico es no
  // mandarlo, y así no hay estados a medias entre borrar y volver a poner.
  const now = Date.now()
  const stmts = [env.DB.prepare('DELETE FROM event_bets WHERE event_id = ? AND user_id = ?').bind(id, user.id)]
  for (const f of filas) {
    stmts.push(env.DB.prepare(
      `INSERT INTO event_bets (event_id, user_id, target_id, kind, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, f.target, f.kind, f.value, now))
  }
  await env.DB.batch(stmts)

  return new Response(null, { status: 204 })
}
