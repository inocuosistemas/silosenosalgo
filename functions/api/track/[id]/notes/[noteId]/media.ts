/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../../../lib/db'
import { json, csrfOk } from '../../../../../lib/http'
import { getSessionUser } from '../../../../../lib/session'
import { TOKEN_RE } from '../../../../../../shared/validate'

/**
 * Note media (voice memo / photo), stored in KV as a stop-gap (no R2). Key:
 * `notemedia:<sessionId>:<noteId>:<kind>`. A backstop TTL self-cleans orphans; the
 * note-DELETE and session-DELETE paths also purge explicitly.
 *
 *  PUT  /api/track/:id/notes/:noteId/media?kind=audio|photo — owner uploads the
 *       raw bytes (Content-Type from the client); size-capped. Sets the note's
 *       audio_key / photo_key column.
 *  GET  /api/track/:id/notes/:noteId/media?kind=audio|photo — public (followers
 *       see all): streams the bytes with the right Content-Type, so the viewer and
 *       the exported GPX <link> can play / show it.
 */

const ID_RE = /^[A-Za-z0-9_-]{10,30}$/
const CAP = { audio: 4 * 1024 * 1024, photo: 1_500_000 } as const // KV allows 25 MB; keep media small
const MIME = { audio: 'audio/mp4', photo: 'image/jpeg' } as const
const MEDIA_TTL_SECONDS = 60 * 24 * 3600 // 60-day backstop; explicit DELETE also cleans up

type Kind = 'audio' | 'photo'
function kindOf(url: URL): Kind | null {
  const k = url.searchParams.get('kind')
  return k === 'audio' || k === 'photo' ? k : null
}
export function mediaKvKey(id: string, noteId: string, kind: string): string {
  return `notemedia:${id}:${noteId}:${kind}`
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  const noteId = String(params.noteId)
  if (!TOKEN_RE.test(id) || !ID_RE.test(noteId)) return json({ error: 'bad_id' }, 400)
  const kind = kindOf(new URL(request.url))
  if (!kind) return json({ error: 'bad_kind' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare(
    'SELECT owner_user_id AS owner FROM track_notes WHERE id=? AND session_id=?',
  ).bind(noteId, id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  const buf = await request.arrayBuffer()
  if (buf.byteLength === 0) return json({ error: 'empty' }, 400)
  if (buf.byteLength > CAP[kind]) return json({ error: 'too_large' }, 413)

  const key = mediaKvKey(id, noteId, kind)
  await env.SHARE_KV.put(key, buf, { expirationTtl: MEDIA_TTL_SECONDS })
  const col = kind === 'audio' ? 'audio_key' : 'photo_key'
  await env.DB.prepare(`UPDATE track_notes SET ${col}=? WHERE id=? AND session_id=? AND owner_user_id=?`)
    .bind(key, noteId, id, user.id).run()
  return new Response(null, { status: 204 })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  const noteId = String(params.noteId)
  if (!TOKEN_RE.test(id) || !ID_RE.test(noteId)) return json({ error: 'bad_id' }, 400)
  const kind = kindOf(new URL(request.url))
  if (!kind) return json({ error: 'bad_kind' }, 400)

  const data = await env.SHARE_KV.get(mediaKvKey(id, noteId, kind), 'arrayBuffer')
  if (!data) return json({ error: 'not_found' }, 404)
  return new Response(data, {
    status: 200,
    headers: { 'Content-Type': MIME[kind], 'Cache-Control': 'public, max-age=86400' },
  })
}
