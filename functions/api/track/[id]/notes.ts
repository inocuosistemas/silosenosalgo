/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../../lib/db'
import { json, csrfOk, readJson } from '../../../lib/http'
import { getSessionUser } from '../../../lib/session'
import { genId } from '../../../../shared/ids'
import { TOKEN_RE } from '../../../../shared/validate'
import { isPoiType, DEFAULT_POI_TYPE } from '../../../../shared/poiTypes'
import type { NoteCreate, TrackNote } from '../../../../shared/wireTypes'

/**
 * POST /api/track/:id/notes — the owner anchors a field note to a GPS fix. Body
 * is JSON (native URLSession sends a real body; the embedded WKWebView, whose
 * scheme handler mangles POST bodies, never creates notes). Inserts a row into
 * track_notes and returns the created TrackNote. Ownership is checked with a
 * SELECT (meta.changes is unreliable on production D1). Mirrors form.ts auth.
 */
const NOTES_MAX = 500 // per-session soft cap (abuse guard)
const TITLE_MAX = 200
const BODY_MAX = 4000

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const b = await readJson<NoteCreate>(request)
  if (!b) return json({ error: 'bad_body' }, 400)
  const lat = numOrNull(b.lat)
  const lon = numOrNull(b.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'bad_coords' }, 400)
  }

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM track_notes WHERE session_id=?')
    .bind(id).first<{ n: number }>()
  if (count && count.n >= NOTES_MAX) return json({ error: 'too_many_notes' }, 409)

  const note: TrackNote = {
    id: genId(16),
    createdAt: numOrNull(b.createdAt) ?? Date.now(),
    fixAt: numOrNull(b.fixAt),
    lat, lon,
    accuracy: numOrNull(b.accuracy),
    altitude: numOrNull(b.altitude),
    trackKm: numOrNull(b.trackKm),
    distM: numOrNull(b.distM),
    title: clampStr(b.title, TITLE_MAX),
    body: clampStr(b.body, BODY_MAX),
    poiType: isPoiType(b.poiType) ? b.poiType : DEFAULT_POI_TYPE,
    poiSym: clampStr(b.poiSym, 64),
    audioKey: null,
    photoKey: null,
  }

  await env.DB.prepare(
    `INSERT INTO track_notes
       (id, session_id, owner_user_id, created_at, fix_at, lat, lon, accuracy, altitude,
        track_km, dist_m, title, body, poi_type, poi_sym, audio_key, photo_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    note.id, id, user.id, note.createdAt, note.fixAt, note.lat, note.lon, note.accuracy, note.altitude,
    note.trackKm, note.distM, note.title, note.body, note.poiType, note.poiSym, note.audioKey, note.photoKey,
  ).run()

  return json({ note }, 201)
}
