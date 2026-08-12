/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../../lib/db'
import { json, csrfOk, rateLimited, clientIp } from '../../../../../lib/http'
import { TOKEN_RE } from '../../../../../../shared/validate'
import { isReactionEmoji } from '../../../../../../shared/wireTypes'

/**
 * POST /api/track/:id/cheers/:cheerId/like?v=<viewerId>&e=<emoji> — pone, cambia
 * o quita la reacción de un seguidor sobre un mensaje de ánimo.
 *
 * UNA reacción por persona y mensaje, como en WhatsApp: tocar otro emoji la
 * cambia, tocar el mismo la quita. Eso es lo que mantiene los contadores
 * honestos; con varias por persona dejarían de medir cuánta gente reacciona.
 *
 * Igual que animar, es un endpoint ABIERTO: quien vota no tiene cuenta. Que un
 * contador signifique algo depende por completo de poder distinguir votantes,
 * asi que hay dos barreras:
 *
 *  - `viewer_id` (id anonimo por navegador, el mismo que cuenta seguidores
 *    presentes) forma clave primaria con el mensaje: el segundo voto del mismo
 *    navegador sobre el mismo mensaje no suma, lo quita;
 *  - como ese id lo pone el cliente y se puede rotar, ademas hay limite por IP.
 *    Rotar el id no da votos infinitos, solo salta la primera barrera.
 */
const VIEWER_RE = /^[A-Za-z0-9_-]{8,64}$/
const PER_IP_LIMIT = 60         // votos...
const PER_IP_WINDOW_SEC = 600   // ...cada 10 minutos, por ruta

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cheer:${ip}`))
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const cheerId = String(params.cheerId)
  if (!TOKEN_RE.test(id) || !VIEWER_RE.test(cheerId)) return json({ error: 'bad_id' }, 400)

  const q = new URL(request.url).searchParams
  const viewer = q.get('v') || ''
  if (!VIEWER_RE.test(viewer)) return json({ error: 'bad_viewer' }, 400)
  // Vale cualquier emoji, pero SOLO un emoji: lo que se guarde se le enseña a
  // todo el mundo, asi que el campo no puede convertirse en texto libre.
  const emoji = q.get('e') || ''
  if (!isReactionEmoji(emoji)) return json({ error: 'bad_emoji' }, 400)

  // El mensaje tiene que pertenecer a esta ruta: sin esta comprobacion, con el
  // id de un mensaje se podria votar desde cualquier enlace.
  const cheer = await env.DB.prepare(
    'SELECT id FROM track_cheers WHERE id=? AND session_id=?',
  ).bind(cheerId, id).first<{ id: string }>()
  if (!cheer) return json({ error: 'not_found' }, 404)

  const ip = clientIp(request)
  if (await rateLimited(env, `like:${id}:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW_SEC)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const existing = await env.DB.prepare(
    'SELECT emoji FROM cheer_likes WHERE cheer_id=? AND viewer_id=?',
  ).bind(cheerId, viewer).first<{ emoji: string }>()

  // Mismo emoji otra vez = quitarlo. Distinto = cambiarlo. Ninguno = ponerlo.
  const quita = existing?.emoji === emoji
  if (quita) {
    await env.DB.prepare('DELETE FROM cheer_likes WHERE cheer_id=? AND viewer_id=?')
      .bind(cheerId, viewer).run()
  } else if (existing) {
    await env.DB.prepare('UPDATE cheer_likes SET emoji=?, created_at=? WHERE cheer_id=? AND viewer_id=?')
      .bind(emoji, Date.now(), cheerId, viewer).run()
  } else {
    // OR IGNORE por si dos toques simultaneos del mismo navegador se cruzan: el
    // segundo choca con la clave primaria y se descarta en vez de fallar.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO cheer_likes (cheer_id, viewer_id, created_at, ip_hash, emoji) VALUES (?,?,?,?,?)',
    ).bind(cheerId, viewer, Date.now(), await hashIp(ip), emoji).run()
  }

  const rows = await env.DB.prepare(
    'SELECT emoji, COUNT(*) AS n FROM cheer_likes WHERE cheer_id=? GROUP BY emoji ORDER BY n DESC',
  ).bind(cheerId).all<{ emoji: string; n: number }>()

  return json({
    reactions: rows.results.map((r) => ({ emoji: r.emoji, count: r.n })),
    myReaction: quita ? null : emoji,
  }, 200, { 'Cache-Control': 'no-store' })
}
