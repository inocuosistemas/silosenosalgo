/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { revisaAvisosDePosicion } from '../../../lib/avisos'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { countViewers } from '../../../lib/presence'
import { TOKEN_RE } from '../../../../shared/validate'
import type { TrailPoint, PingResponse } from '../../../../shared/wireTypes'
import { puntoDelRastro } from '../../../lib/rastro'
import { leeCadencia, escribeCadencia } from '../../../../shared/cadencia'

/**
 * POST /api/track/:id/ping — owner pushes GPS fixes. Accepts a single fix
 * (legacy) OR a batch `{ fixes: [...] }` so the app can buffer positions while
 * offline (mountain dead zones) and flush the whole backlog when coverage
 * returns. Each fix carries its own `fixAt` (device GPS time); the trail is
 * ordered by that time so back-filled points land correctly, and the latest
 * fix by time becomes the live position.
 */

/**
 * El TECHO de una pausa: una hora.
 *
 * No es lo que se pausa de una vez —eso son diez minutos, que es lo que dura un
 * avituallamiento largo o un cambio de ropa— sino hasta dónde se puede llegar
 * sumando de cinco en cinco desde la propia pantalla de la baliza: quien se
 * para a comer no tiene por qué ir pulsando cada diez minutos con las manos
 * frías.
 *
 * Sigue habiendo techo porque una pausa indefinida es otra forma de no saber
 * nada, y quien se baja de verdad tiene el botón de al lado para decirlo.
 * Espejo de `pausaTope` en iOS.
 */
const PAUSA_MAX_MIN = 60

const PATH_MAX = 2000
const MAX_BATCH = 600
/** Margen de silencio: una baliza que no da señal en este tiempo se da por
 *  terminada. Cada posición lo renueva, así que mientras emita no caduca. */
const ALIVE_TTL_MS = 16 * 60 * 60 * 1000

interface InFix {
  lat: number; lon: number
  trackKm?: number | null; speed?: number | null; heading?: number | null
  accuracy?: number | null; altitude?: number | null; fixAt?: number | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

interface NormFix { t: number; lat: number; lon: number; trackKm: number | null; speed: number | null; heading: number | null; accuracy: number | null; altitude: number | null }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = await readJson<{
    fixes?: InFix[]; appVersion?: unknown; cadencia?: unknown; bateria?: unknown
    pausaMin?: unknown
  } & Partial<InFix>>(request)
  if (!body) return json({ error: 'invalid_request' }, 400)
  /**
   * Qué versión de la app manda esto.
   *
   * Viaja en el ping y no al crear la sesión por dos razones: las balizas ya
   * abiertas cuando se actualiza la app también la estrenan, y una app vieja
   * que no lo mande deja el campo como estaba en vez de borrarlo. Es la
   * respuesta a "¿qué versión llevas?" cuando alguien dice que algo no le sale
   * —en la CanFranc hubo que deducirlo de cómo se comportaba la baliza—.
   */
  const appVersion = typeof body.appVersion === 'string' && body.appVersion.trim()
    ? body.appVersion.trim().slice(0, 40)
    : null
  /**
   * Cada cuánto promete hablar esta baliza: `t15` cada quince segundos, `d500`
   * cada quinientos metros. Con ella el mapa sabe cuánto silencio es normal en
   * ESTA y deja de anunciar "sin cobertura" a quien emite por distancia y está
   * parado —ver `shared/cadencia.ts`—. Viaja en el ping y no al crear la sesión
   * porque el perfil se cambia a mitad de ruta, que es cuando se ve la batería.
   */
  const cadencia = leeCadencia(typeof body.cadencia === 'string' ? body.cadencia : null)
  /**
   * Cuánta batería le queda a la baliza, de 0 a 100.
   *
   * Para quien mira, "le queda un 8%" contesta a si va a seguir viéndole, que
   * en una ultra de dos días es de lo primero que se pregunta. Y para nosotros
   * es la única forma de saber qué cuesta de verdad cada perfil de emisión: el
   * de ahorro promete máxima autonomía a cambio de una traza mucho peor, y esa
   * cuenta no se puede hacer sin el dato.
   */
  const bateria = typeof body.bateria === 'number' && Number.isFinite(body.bateria)
    ? Math.max(0, Math.min(100, Math.round(body.bateria)))
    : null
  const raw: InFix[] = Array.isArray(body.fixes) ? body.fixes : [body as InFix]

  const now = Date.now()
  /**
   * Una pausa declarada: "me paro un rato, no me ha pasado nada".
   *
   * Pararse en una carrera larga es normal, y hasta ahora quien miraba no podía
   * distinguirlo de una avería: el punto deja de moverse y a los veinte minutos
   * el mapa anuncia "sin cobertura", que es el mensaje que no hay que mandarle
   * a una familia. Con esto, la baliza se calla con permiso.
   *
   * En minutos y con TOPE: una pausa indefinida es otra forma de no saber nada,
   * y quien se baja de verdad tiene el botón de al lado para decirlo. `0` la
   * cancela —se vuelve antes de tiempo y hay que poder decirlo—.
   */
  const pausa = typeof body.pausaMin === 'number' && Number.isFinite(body.pausaMin)
    ? Math.max(0, Math.min(PAUSA_MAX_MIN, Math.round(body.pausaMin)))
    : null
  const pausaHasta = pausa === null ? null : (pausa === 0 ? 0 : now + pausa * 60_000)

  const minT = now - 7 * 24 * 3600_000 // ignore absurdly old timestamps
  const incoming: NormFix[] = []
  for (const f of raw.slice(0, MAX_BATCH)) {
    const lat = num(f.lat), lon = num(f.lon)
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    let t = num(f.fixAt)
    if (t === null || t < minT || t > now + 3600_000) t = now
    incoming.push({
      t, lat, lon, trackKm: num(f.trackKm), speed: num(f.speed), heading: num(f.heading),
      accuracy: num(f.accuracy), altitude: num(f.altitude),
    })
  }
  if (incoming.length === 0) return json({ error: 'invalid_coords' }, 400)

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner, status, expires_at AS expiresAt, trail, battery_log AS bateriaLog, event_id AS eventId, km_ruta AS kmRuta FROM tracking_sessions WHERE id = ?',
  ).bind(id).first<{ owner: string; status: string; expiresAt: number; trail: string | null; bateriaLog: string | null; eventId: string | null; kmRuta: number | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (row.owner !== user.id) return json({ error: 'forbidden' }, 403)
  if (row.status !== 'active' || now > row.expiresAt) return json({ error: 'ended' }, 410)

  // Merge into the trail, ordered by GPS time, then downsample to bound size.
  let trail: TrailPoint[] = []
  if (row.trail) { try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] } }
  // Each point keeps its horizontal accuracy (rounded, so the viewer can colour
  // the trail by GPS precision) and, when it arrived late, the time it reached
  // the server: the trace of a stretch without coverage (see `lib/rastro`).
  for (const f of incoming) trail.push(puntoDelRastro(f, now))
  trail.sort((a, b) => a.t - b.t)
  while (trail.length > PATH_MAX) {
    const latest = trail[trail.length - 1]
    trail = trail.filter((_, i) => i % 2 === 0)
    if (trail[trail.length - 1] !== latest) trail.push(latest)
  }

  // Latest fix by time → the live position shown to followers.
  const latest = incoming.reduce((a, b) => (b.t >= a.t ? b : a))

  // Cada posición prolonga la caducidad. Sin esto, `expires_at` se fijaba al
  // arrancar y no se movía nunca: una baliza que siguiera emitiendo pasado su
  // plazo se daba por caducada, el enlace devolvía 404 y la purga vaciaba
  // posición y traza. En una carrera larga —un Backyard puede pasar de un día—
  // eso significaba perder el seguimiento EN MITAD de la prueba.
  //
  // El plazo pasa a contar desde la última posición, no desde la salida: así una
  // baliza viva nunca caduca, y una que deja de emitir sigue expirando sola.
  // `COALESCE` en el kilómetro, y no un pisotón: un `trackKm` nulo significa
  // "no he podido calcularlo" —está fuera del trazado, va en un coche, o la app
  // no tiene el recorrido cargado—, nunca "estoy en el kilómetro ninguno".
  // Escribiéndolo encima se perdía el último kilómetro conocido, que es justo el
  // dato que dice DÓNDE se quedó alguien: en la CanFranc, los cuatro acabaron la
  // carrera con el kilómetro vacío y hubo que reconstruirlo proyectando sus
  // coordenadas a mano.
  // La batería, al registro solo cuando CAMBIA: con eso basta para saber a qué
  // ritmo baja (ver `src/lib/bateria.ts`), y una carrera entera son como mucho
  // cien entradas por carga. Null = no se toca la columna.
  const bateriaLog = bateria === null ? null : anotaBateria(row.bateriaLog, now, bateria)

  const keepAlive = now + ALIVE_TTL_MS
  await env.DB.prepare(
    `UPDATE tracking_sessions
        SET lat=?, lon=?, track_km=COALESCE(?, track_km), speed=?, heading=?, accuracy=?, altitude=?, fix_at=?, updated_at=?, trail=?,
            app_version=COALESCE(?, app_version),
            send_cadence=COALESCE(?, send_cadence),
            battery_pct=COALESCE(?, battery_pct),
            battery_log=COALESCE(?, battery_log),
            paused_until=CASE WHEN ? IS NULL THEN paused_until WHEN ? = 0 THEN NULL ELSE ? END,
            expires_at=MAX(expires_at, ?)
      WHERE id=?`,
  ).bind(
    latest.lat, latest.lon, latest.trackKm, latest.speed, latest.heading,
    latest.accuracy, latest.altitude, latest.t, now, JSON.stringify(trail), appVersion,
    cadencia ? escribeCadencia(cadencia) : null, bateria, bateriaLog,
    pausaHasta, pausaHasta, pausaHasta,
    keepAlive, id,
  ).run()

  // Report how many followers are watching, so the beacon can show it live.
  // Best-effort: the fix is already saved above, so a presence failure must not
  // fail the ping — fall back to 0 followers.
  // Los avisos de paso de quien sigue el evento (ver `lib/avisos`): después
  // de guardar y sin hacer esperar a la baliza.
  if (row.eventId) {
    waitUntil(revisaAvisosDePosicion(env, id, row.eventId, row.owner, row.kmRuta, latest.lat, latest.lon, latest.t).catch(() => {}))
  }

  let viewers = 0
  try { viewers = await countViewers(env, id) } catch { /* presence is non-critical */ }
  return json({ viewers } satisfies PingResponse, 200)
}

/** Tope del registro de batería: de sobra para dos cargas enteras. */
const BATERIA_LOG_MAX = 240

/**
 * El registro de batería con la lectura nueva, o null si no cambia nada (misma
 * cifra que la última): así el UPDATE deja la columna como estaba.
 */
function anotaBateria(crudo: string | null, t: number, pct: number): string | null {
  let log: [number, number][] = []
  if (crudo) { try { const v = JSON.parse(crudo); if (Array.isArray(v)) log = v } catch { log = [] } }
  const ultima = log[log.length - 1]
  if (ultima && ultima[1] === pct) return null
  log.push([t, pct])
  if (log.length > BATERIA_LOG_MAX) log = log.slice(-BATERIA_LOG_MAX)
  return JSON.stringify(log)
}
