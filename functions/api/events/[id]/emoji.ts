/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { TOKEN_RE } from '../../../../shared/validate'
import { emojiOk, foldEmoji } from '../../../../shared/emoji'

/**
 * POST /api/events/:id/emoji — la marca con la que se identifica uno en el mapa.
 *
 * El emoji es el identificador de verdad del evento: el color puede repetirse
 * (con cien participantes no queda otra) y el emoji no. Por eso la unicidad la
 * impone el índice de la BD y no la interfaz: dos personas pueden elegir el
 * mismo 🦊 en el mismo segundo desde dos móviles, y ahí no hay comprobación
 * previa que valga. El choque vuelve como 409 y el lobby lo cuenta.
 *
 * Body: `{ emoji }` para el propio, `{ emoji, userId }` para el de otro (solo el
 * organizador, igual que con los dorsales). Cadena vacía o nula = quitarlo.
 */

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ emoji?: unknown; userId?: unknown }>(request)) || {}
  const raw = typeof body.emoji === 'string' ? body.emoji.trim() : ''
  // Libre, pero UN emoji: un identificador que puede ser "JORGE" ya no
  // identifica nada en un disco de 24 píxeles (ver shared/emoji.ts).
  if (raw && !emojiOk(raw)) return json({ error: 'bad_emoji' }, 400)
  const emoji = raw || null
  const key = emoji ? foldEmoji(emoji) : null

  const target = typeof body.userId === 'string' && body.userId ? body.userId : user.id
  if (target !== user.id) {
    const ev = await env.DB.prepare('SELECT created_by AS createdBy FROM events WHERE id = ?')
      .bind(id).first<{ createdBy: string }>()
    if (!ev || ev.createdBy !== user.id) return json({ error: 'forbidden' }, 403)
  }

  // La pertenencia se comprueba antes y se repite en el WHERE: nunca se
  // ramifica sobre `meta.changes`, que en producción no es de fiar.
  const member = await env.DB.prepare(
    'SELECT emoji_key AS emojiKey FROM event_members WHERE event_id = ? AND user_id = ?',
  ).bind(id, target).first<{ emojiKey: string | null }>()
  if (!member) return json({ error: 'not_found' }, 404)
  if (member.emojiKey === key) return new Response(null, { status: 204 })

  try {
    await env.DB.prepare('UPDATE event_members SET emoji = ?, emoji_key = ? WHERE event_id = ? AND user_id = ?')
      .bind(emoji, key, id, target).run()
  } catch {
    // Choque con el índice único: alguien se lo ha quedado antes.
    return json({ error: 'emoji_taken' }, 409)
  }
  return new Response(null, { status: 204 })
}
