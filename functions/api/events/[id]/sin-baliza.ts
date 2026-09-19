/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { puedeOrganizar } from '../../../lib/organiza'
import { TOKEN_RE, USERNAME_RE, BIB_RE } from '../../../../shared/validate'
import { assignColor } from '../../../../shared/eventColors'
import { firstFreeEmoji, foldEmoji } from '../../../../shared/emoji'
import { genId } from '../../../../shared/ids'

/**
 * POST /api/events/:id/sin-baliza — dar de alta a un corredor que YA SE SABE
 * que no va a llevar baliza (no tiene la app, no tiene móvil que aguante…).
 *
 * Se le sigue igual que a quien se le acaba la batería a mitad de carrera: en
 * MODO MANUAL, con sus pasos por los controles anotados desde el cronometraje
 * oficial. Para que la parrilla, el mapa, los resultados y la porra le cuenten
 * igual que a los demás, tiene su fila en `users`, pero marcada `sin_cuenta`:
 * no es la cuenta de nadie y no puede entrar (ver login, pases y reset).
 *
 * Body: `{ nombre, dorsal? }`. Devuelve `{ username }`: el nombre ya
 * convertido a uno válido y libre ("Jorge García" → "Jorge.Garcia", y si está
 * cogido, "Jorge.Garcia-2").
 *
 * Solo quien organiza.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await puedeOrganizar(env, id, user))) return json({ error: 'forbidden' }, 403)

  const body = (await readJson<{ nombre?: unknown; dorsal?: unknown }>(request)) || {}
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
  const dorsal = typeof body.dorsal === 'string' && body.dorsal.trim() ? body.dorsal.trim() : null
  if (dorsal && !BIB_RE.test(dorsal)) return json({ error: 'bad_bib' }, 400)

  // El nombre, a uno válido: sin tildes ni símbolos, los espacios en puntos.
  const base = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 28)
  if (!USERNAME_RE.test(base.toLowerCase())) return json({ error: 'bad_name' }, 400)

  const ev = await env.DB.prepare('SELECT ended_at AS endedAt FROM events WHERE id = ?').bind(id).first<{ endedAt: number | null }>()
  if (!ev) return json({ error: 'not_found' }, 404)
  if (ev.endedAt !== null) return json({ error: 'ended' }, 410)

  const taken = await env.DB.prepare('SELECT color, emoji_key AS emojiKey FROM event_members WHERE event_id = ?')
    .bind(id).all<{ color: string | null; emojiKey: string | null }>()
  const filas = taken.results ?? []
  const color = assignColor(filas.map((r) => r.color).filter((c): c is string => !!c))
  const emoji = firstFreeEmoji(filas.map((r) => r.emojiKey).filter((k): k is string => !!k))

  // Un nombre libre: el tecleado, y si está cogido (en toda la plataforma),
  // con un número detrás.
  const userId = genId(8)
  const now = Date.now()
  let username: string | null = null
  for (let n = 1; n <= 20 && !username; n++) {
    const candidato = n === 1 ? base : `${base.slice(0, 28)}-${n}`
    try {
      await env.DB.prepare(
        `INSERT INTO users (id, username, username_ci, password_hash, salt, iterations, is_admin, sin_cuenta)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
      ).bind(userId, candidato, candidato.toLowerCase(), 'sin-cuenta', genId(8), 1).run()
      username = candidato
    } catch { /* cogido: el siguiente número */ }
  }
  if (!username) return json({ error: 'username_taken' }, 409)

  await env.DB.prepare(
    `INSERT INTO event_members (event_id, user_id, color, emoji, emoji_key, joined_at, last_seen, bib, manual_pasos)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, '[]')`,
  ).bind(id, userId, color, emoji, emoji ? foldEmoji(emoji) : null, now, dorsal).run()

  return json({ username }, 200)
}
