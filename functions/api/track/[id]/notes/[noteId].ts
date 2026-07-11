/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../lib/db'
import { json, csrfOk, readJson } from '../../../../lib/http'
import { getSessionUser } from '../../../../lib/session'
import { TOKEN_RE } from '../../../../../shared/validate'
import { isPoiType } from '../../../../../shared/poiTypes'

/**
 * PATCH  /api/track/:id/notes/:noteId — edit a note's title/body/poiType/poiSym.
 * DELETE /api/track/:id/notes/:noteId — remove a note (best-effort R2 media
 *   cleanup once media is wired). Both owner-only, checked with a SELECT and a
 *   WHERE owner_user_id guard. Mirrors form.ts / [id].ts DELETE conventions.
 */

const ID_RE = /^[A-Za-z0-9_-]{10,30}$/ // genId(16) → 22-char url-safe base64

interface NotePatch {
  title?: string | null
  body?: string | null
  poiType?: string
  poiSym?: string | null
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const noteId = String(params.noteId)
  if (!TOKEN_RE.test(id) || !ID_RE.test(noteId)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const b = await readJson<NotePatch>(request)
  if (!b) return json({ error: 'bad_body' }, 400)

  // Build a partial update from only the provided, valid fields.
  const sets: string[] = []
  const vals: unknown[] = []
  if ('title' in b) { sets.push('title=?'); vals.push(clampStr(b.title, 200)) }
  if ('body' in b) { sets.push('body=?'); vals.push(clampStr(b.body, 4000)) }
  if ('poiType' in b && isPoiType(b.poiType)) { sets.push('poi_type=?'); vals.push(b.poiType) }
  if ('poiSym' in b) { sets.push('poi_sym=?'); vals.push(clampStr(b.poiSym, 64)) }
  if (sets.length === 0) return json({ error: 'nothing_to_update' }, 400)

  const res = await env.DB.prepare(
    `UPDATE track_notes SET ${sets.join(', ')} WHERE id=? AND session_id=? AND owner_user_id=?`,
  ).bind(...vals, noteId, id, user.id).run()
  // D1 meta.changes is unreliable on prod, but a 0-row update here is harmless.
  if (!res.success) return json({ error: 'update_failed' }, 500)
  return new Response(null, { status: 204 })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const noteId = String(params.noteId)
  if (!TOKEN_RE.test(id) || !ID_RE.test(noteId)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Verify ownership + grab media keys to clean up (once R2 is wired).
  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner FROM track_notes WHERE id=? AND session_id=?',
  ).bind(noteId, id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  // Best-effort purge of the note's media from KV (see media.ts key scheme).
  await Promise.all([
    env.SHARE_KV.delete(`notemedia:${id}:${noteId}:audio`),
    env.SHARE_KV.delete(`notemedia:${id}:${noteId}:photo`),
  ])

  await env.DB.prepare('DELETE FROM track_notes WHERE id=? AND owner_user_id=?')
    .bind(noteId, user.id).run()
  return new Response(null, { status: 204 })
}
