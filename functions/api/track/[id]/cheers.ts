/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp } from '../../../lib/http'
import { genId } from '../../../../shared/ids'
import { TOKEN_RE } from '../../../../shared/validate'
import { CHEER_BODY_MAX, CHEER_NICK_MAX, type CheerCreate, type TrackCheer } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/cheers — un seguidor deja un mensaje de ánimo.
 *
 * PÚBLICO y sin cuenta, a diferencia de las notas: quien anima es un seguidor
 * que ha abierto un enlace, no el dueño de la ruta. Eso lo convierte en el único
 * endpoint de escritura abierto de la aplicación, así que todo lo de abajo es
 * contención de abuso:
 *
 *  - límite por IP y sesión (KV), para que un solo navegador no pueda inundar;
 *  - tope por sesión, para que la lista no crezca sin fin aunque pasen muchos;
 *  - longitudes recortadas y caracteres de control fuera;
 *  - solo se anima a rutas que existen y no han caducado.
 *
 * De la IP se guarda un hash truncado, no la IP: sirve para cortar un abuso
 * concreto sin conservar un dato personal en claro.
 */
const CHEERS_MAX = 500          // tope por sesión
const PER_IP_LIMIT = 6          // mensajes...
const PER_IP_WINDOW_SEC = 600   // ...cada 10 minutos, por sesión

/** Recorta, quita caracteres de control (deja el salto de linea) y colapsa
 *  espacios y lineas en blanco de mas. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t ? t.slice(0, max) : null
}

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cheer:${ip}`))
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)

  const b = await readJson<CheerCreate>(request)
  if (!b) return json({ error: 'bad_body' }, 400)
  const body = clean(b.body, CHEER_BODY_MAX)
  if (!body) return json({ error: 'empty' }, 400)
  const nick = clean(b.nick, CHEER_NICK_MAX)

  // La sesión tiene que existir y seguir viva. Animar a una ruta caducada no
  // tiene destinatario, y evita que un enlace viejo quede como buzón abierto.
  const row = await env.DB.prepare(
    'SELECT expires_at AS expiresAt, pinned, track_km AS trackKm FROM tracking_sessions WHERE id=?',
  ).bind(id).first<{ expiresAt: number; pinned: number | null; trackKm: number | null }>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (!row.pinned && Date.now() > row.expiresAt) return json({ error: 'expired' }, 410)

  const ip = clientIp(request)
  if (await rateLimited(env, `cheer:${id}:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW_SEC)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM track_cheers WHERE session_id=?',
  ).bind(id).first<{ n: number }>()
  if ((count?.n ?? 0) >= CHEERS_MAX) return json({ error: 'full' }, 409)

  // Km del corredor al llegar el ánimo. Se prefiere el del servidor, pero HOY
  // está siempre vacío: la baliza no sube `tracking_sessions.track_km`, y el
  // km que se ve en pantalla lo calcula el visor proyectando la traza sobre la
  // ruta. Deducirlo aquí obligaría a cargar el plan y repetir todo el
  // emparejamiento en cada mensaje, así que se acepta el del cliente validando
  // el rango. Es dato cosmético: lo peor que puede pasar es que alguien
  // etiquete mal su propio mensaje.
  const clientKm = typeof b.trackKm === 'number' && Number.isFinite(b.trackKm)
    && b.trackKm >= 0 && b.trackKm < 100_000 ? b.trackKm : null
  const trackKm = typeof row.trackKm === 'number' && Number.isFinite(row.trackKm) ? row.trackKm : clientKm
  const cheer: TrackCheer = { id: genId(16), createdAt: Date.now(), nick, body, trackKm }
  await env.DB.prepare(
    'INSERT INTO track_cheers (id, session_id, created_at, nick, body, track_km, ip_hash) VALUES (?,?,?,?,?,?,?)',
  ).bind(cheer.id, id, cheer.createdAt, cheer.nick, cheer.body, cheer.trackKm, await hashIp(ip)).run()

  return json(cheer, 201, { 'Cache-Control': 'no-store' })
}
