/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson, rateLimited, clientIp } from '../../../lib/http'
import { genId } from '../../../../shared/ids'
import { TOKEN_RE } from '../../../../shared/validate'
import { PUBLIC_BASE_URL } from '../../../../shared/config'
import { notifyTelegram, escapeHtml } from '../../../lib/notify'
import { CHEER_BODY_MAX, CHEER_GRACE_MS, CHEER_NICK_MAX, type CheerCreate, type TrackCheer } from '../../../../shared/wireTypes'

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)

  // Quien escribe, para poder enseñarselo solo a el durante la ventana de
  // arrepentimiento y dejarle borrarlo. Sin id valido se publica directamente.
  const viewer = new URL(request.url).searchParams.get('v')
  const author = viewer && /^[A-Za-z0-9_-]{8,64}$/.test(viewer) ? viewer : null

  const b = await readJson<CheerCreate>(request)
  if (!b) return json({ error: 'bad_body' }, 400)
  const body = clean(b.body, CHEER_BODY_MAX)
  if (!body) return json({ error: 'empty' }, 400)
  const nick = clean(b.nick, CHEER_NICK_MAX)

  // La sesión tiene que existir y seguir viva. Animar a una ruta caducada no
  // tiene destinatario, y evita que un enlace viejo quede como buzón abierto.
  const row = await env.DB.prepare(
    'SELECT expires_at AS expiresAt, pinned, track_km AS trackKm, title FROM tracking_sessions WHERE id=?',
  ).bind(id).first<{ expiresAt: number; pinned: number | null; trackKm: number | null; title: string | null }>()
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
  // Recién creado: sin votos y, por definición, sin el voto de quien lo escribe.
  const now = Date.now()
  // Sin autor identificable no hay a quien enseñarselo en privado ni quien pueda
  // borrarlo, asi que se publica ya.
  const publishAt = author ? now + CHEER_GRACE_MS : now
  const cheer: TrackCheer = {
    id: genId(16), createdAt: now, nick, body, trackKm,
    likes: 0, likedByMe: false, publishAt, mine: !!author,
  }
  await env.DB.prepare(
    'INSERT INTO track_cheers (id, session_id, created_at, nick, body, track_km, ip_hash, viewer_id, publish_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(cheer.id, id, cheer.createdAt, cheer.nick, cheer.body, cheer.trackKm, await hashIp(ip), author, publishAt).run()

  // Aviso por Telegram, si está configurado. Espera a que el mensaje se publique
  // y vuelve a comprobar que sigue ahí: avisar antes delataría un mensaje que su
  // autor todavía puede retirar, y la gracia de la ventana es justamente que lo
  // borrado no lo vea nadie. Va en waitUntil, así que quien anima no espera.
  waitUntil((async () => {
    const wait = publishAt - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const still = await env.DB.prepare('SELECT 1 AS x FROM track_cheers WHERE id=?')
      .bind(cheer.id).first<{ x: number }>()
    if (!still) return
    await notifyTelegram(env, [
      `💬 <b>Nuevo ánimo</b>${row.title ? ` · ${escapeHtml(row.title)}` : ''}`,
      `<b>${escapeHtml(cheer.nick || 'Anónimo')}</b>${cheer.trackKm != null ? ` · km ${cheer.trackKm.toFixed(1)}` : ''}`,
      escapeHtml(cheer.body),
      `${PUBLIC_BASE_URL}/?t=${encodeURIComponent(id)}`,
    ].join('\n'))
  })())

  return json(cheer, 201, { 'Cache-Control': 'no-store' })
}
