/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { genId } from '../../../shared/ids'
import { PLAN_ID_RE, isBeaconActivity } from '../../../shared/validate'
import type { BeaconActivity, TrailPoint } from '../../../shared/wireTypes'

/**
 * POST /api/track/importa — subir a la cuenta una salida grabada SIN ella (el
 * uso sin cuenta de las apps, o una que empezó sin cobertura y terminó sin
 * darse de alta): llega entera, con su traza, y nace ya TERMINADA y con la
 * chincheta puesta.
 *
 * No es el alta normal (`POST /api/track`) por dos motivos:
 * - Aquella cierra cualquier otra baliza activa del usuario: subir una salida
 *   de la semana pasada cortaría la que lleva en marcha ahora mismo.
 * - Aquella recorta la hora de salida a una ventana alrededor de «ahora»
 *   (catorce días por delante, un día por detrás); una salida vieja perdería su
 *   fecha.
 *
 * Con la chincheta porque una salida de hace dos meses caducaría enseguida con
 * los 30 días de siempre: se quita después si no se quiere guardar.
 *
 * Las notas, sus fotos y audios, los tramos corregidos y la actividad se suben
 * luego por sus rutas de siempre, que solo piden ser el dueño.
 */

/** Como en ping.ts: lo que se guarda de una traza. */
const PATH_MAX = 2000
/** Más que esto no es una salida que grabase la app. */
const PUNTOS_MAX = 20_000
/** Lo que se conserva el enlace (irrelevante con la chincheta, pero se rellena). */
const KEEP_AFTER_END_MS = 24 * 30 * 60 * 60 * 1000
/** Lo más antiguo que se acepta: antes no existía la app. */
const DESDE = Date.UTC(2024, 0, 1)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{
    title?: string; startAt?: number; endedAt?: number; activity?: unknown
    trail?: unknown; planId?: string; device?: string
  }>(request)) || {}

  const now = Date.now()
  const valido = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t >= DESDE && t <= now + 5 * 60_000
  const numero = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

  // La traza: solo puntos bien formados, en orden, y recortada como la de siempre.
  if (!Array.isArray(body.trail) || body.trail.length === 0 || body.trail.length > PUNTOS_MAX) {
    return json({ error: 'bad_trail' }, 400)
  }
  let trail: TrailPoint[] = []
  for (const p of body.trail as Record<string, unknown>[]) {
    if (!p || !valido(p.t) || !numero(p.lat, -90, 90) || !numero(p.lon, -180, 180)) continue
    const punto: TrailPoint = { t: p.t, lat: p.lat as number, lon: p.lon as number }
    if (numero(p.a, 0, 100_000)) punto.a = Math.round(p.a as number)
    if (p.m === 'q' || p.m === 'w' || p.m === 'r' || p.m === 'b' || p.m === 'v') punto.m = p.m
    trail.push(punto)
  }
  if (trail.length === 0) return json({ error: 'bad_trail' }, 400)
  trail.sort((a, b) => a.t - b.t)
  while (trail.length > PATH_MAX) {
    const ultimo = trail[trail.length - 1]
    trail = trail.filter((_, i) => i % 2 === 0)
    if (trail[trail.length - 1] !== ultimo) trail.push(ultimo)
  }

  const primero = trail[0], ultimo = trail[trail.length - 1]
  const startedAt = valido(body.startAt) && body.startAt <= primero.t ? body.startAt : primero.t
  const endedAt = valido(body.endedAt) && body.endedAt >= ultimo.t ? body.endedAt : ultimo.t
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.slice(0, 80).trim() : null
  const activity: BeaconActivity | null = isBeaconActivity(body.activity) ? body.activity : null
  const device = typeof body.device === 'string' && body.device.trim() ? body.device.slice(0, 60).trim() : null

  // Su ruta, si se subió antes a la cuenta (la de un GPX cargado sin cuenta):
  // como en el alta normal, copiada a un enlace público propio, sin caducidad
  // porque la salida lleva chincheta.
  let planShareId: string | null = null
  let planName: string | null = null
  if (typeof body.planId === 'string' && PLAN_ID_RE.test(body.planId)) {
    const row = await env.DB.prepare('SELECT payload, name FROM plans WHERE id=? AND user_id=?')
      .bind(body.planId, user.id).first<{ payload: unknown; name: string | null }>()
    if (row) {
      planName = typeof row.name === 'string' ? row.name : null
      const raw = row.payload
      const bytes = Array.isArray(raw) ? new Uint8Array(raw)
        : raw instanceof ArrayBuffer ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : new Uint8Array(0)
      if (bytes.length) {
        planShareId = genId(8)
        await env.SHARE_KV.put(planShareId, bytes)
      }
    }
  }

  const id = genId(16)
  await env.DB.prepare(
    `INSERT INTO tracking_sessions (id, owner_user_id, title, plan_share_id, plan_name, status,
                                    started_at, ended_at, expires_at, pinned, activity, device,
                                    lat, lon, accuracy, fix_at, updated_at, trail)
     VALUES (?, ?, ?, ?, ?, 'ended', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, user.id, title, planShareId, planName,
    startedAt, endedAt, now + KEEP_AFTER_END_MS, activity, device,
    ultimo.lat, ultimo.lon, ultimo.a ?? null, ultimo.t, now, JSON.stringify(trail),
  ).run()

  return json({ id }, 201)
}
