/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk, readJson } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { emojiOk } from '../../../shared/emoji'
import { isEventColor } from '../../../shared/eventColors'
import type { ProfileResponse } from '../../../shared/wireTypes'

/**
 * La marca favorita de cada cuenta: su emoji y su color.
 *   GET  /api/auth/profile → los guardados.
 *   POST /api/auth/profile → los cambia (`null` en cualquiera de los dos lo quita).
 *
 * Vive en la cuenta y no en el evento porque quien es 🦊 en su club quiere ser
 * 🦊 en todas las carreras. Al entrar en un evento se intentan; si ese emoji ya
 * lo lleva otro allí, se entra con otro y el lobby lo dice (ver events/join.ts).
 *
 * Aparte de `/api/auth/me` a propósito: eso lo llama toda la aplicación en cada
 * arranque y en las apps del móvil, y esto solo hace falta en la pantalla donde
 * se elige. No hay razón para engordar la respuesta más pedida de todas.
 */

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT fav_emoji AS favEmoji, fav_color AS favColor FROM users WHERE id = ?')
    .bind(user.id).first<{ favEmoji: string | null; favColor: string | null }>()
  const res: ProfileResponse = { favEmoji: row?.favEmoji ?? null, favColor: row?.favColor ?? null }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const body = (await readJson<{ favEmoji?: unknown; favColor?: unknown }>(request)) || {}

  // Se guarda lo que se manda, y solo lo que se manda: mandar el emoji no debe
  // borrar el color de quien solo venía a cambiar el emoji. `undefined` = no lo
  // toques; `null` o cadena vacía = quítalo.
  const patches: { col: string; value: string | null }[] = []
  if (body.favEmoji !== undefined) {
    const raw = typeof body.favEmoji === 'string' ? body.favEmoji.trim() : ''
    if (raw && !emojiOk(raw)) return json({ error: 'bad_emoji' }, 400)
    patches.push({ col: 'fav_emoji', value: raw || null })
  }
  if (body.favColor !== undefined) {
    const raw = typeof body.favColor === 'string' ? body.favColor.trim() : ''
    if (raw && !isEventColor(raw)) return json({ error: 'bad_color' }, 400)
    patches.push({ col: 'fav_color', value: raw || null })
  }
  for (const p of patches) {
    await env.DB.prepare(`UPDATE users SET ${p.col} = ? WHERE id = ?`).bind(p.value, user.id).run()
  }

  const row = await env.DB.prepare('SELECT fav_emoji AS favEmoji, fav_color AS favColor FROM users WHERE id = ?')
    .bind(user.id).first<{ favEmoji: string | null; favColor: string | null }>()
  const res: ProfileResponse = { favEmoji: row?.favEmoji ?? null, favColor: row?.favColor ?? null }
  return json(res, 200, { 'Cache-Control': 'no-store' })
}
