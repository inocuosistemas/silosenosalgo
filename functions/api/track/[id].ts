/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../../lib/db'
import { json, csrfOk } from '../../lib/http'
import { getSessionUser } from '../../lib/session'
import { recordViewer, countViewers } from '../../lib/presence'
import { TOKEN_RE, isBeaconActivity } from '../../../shared/validate'
import type { TrackStateResponse, TrackFix, TrailPoint, TrackNote, TrackCheer } from '../../../shared/wireTypes'

/**
 * GET /api/track/:id — public, no auth. Returns the last known fix + short
 * trail for BOTH active and ended sessions (so a route stays viewable for the
 * retention window after the share ends, 48 h by default). Never cached (must
 * reflect a live position). Projects only non-PII fields — never
 * owner_user_id / username. Past `expires_at` (D1 has no native TTL) a
 * non-pinned session is lazily purged and its public link returns 404: a purged
 * session has no route left to show, so it reads as a dead link rather than an
 * empty "finished" page. Pinned ("chincheta") sessions are exempt — their data
 * is kept and the link stays live indefinitely.
 */

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  // Anonymous per-viewer id (from the follower's browser) → presence heartbeat.
  const viewerId = new URL(request.url).searchParams.get('v')

  const row = await env.DB.prepare(
    `SELECT ts.status AS status, ts.title AS title, ts.plan_share_id AS planShareId,
            ts.started_at AS startedAt, ts.expires_at AS expiresAt, ts.ended_at AS endedAt,
            ts.lat AS lat, ts.lon AS lon, ts.track_km AS trackKm, ts.speed AS speed,
            ts.heading AS heading, ts.accuracy AS accuracy, ts.altitude AS altitude,
            ts.fix_at AS fixAt, ts.updated_at AS updatedAt, ts.trail AS trail,
            ts.pinned AS pinned, ts.form_factor AS formFactor, ts.form_log AS formLog,
            ts.activity AS activity, u.username AS username
       FROM tracking_sessions ts LEFT JOIN users u ON u.id = ts.owner_user_id
      WHERE ts.id = ?`,
  ).bind(id).first<{
    status: string; title: string | null; planShareId: string | null
    startedAt: number; expiresAt: number; endedAt: number | null
    lat: number | null; lon: number | null; trackKm: number | null; speed: number | null
    heading: number | null; accuracy: number | null; altitude: number | null
    fixAt: number | null; updatedAt: number | null; trail: string | null
    pinned: number | null; formFactor: number | null; formLog: string | null
    activity: string | null; username: string | null
  }>()
  if (!row) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  let status: 'active' | 'ended' = row.status === 'active' ? 'active' : 'ended'
  // Past expires_at the session is over. Unless it's pinned ("chincheta", kept
  // indefinitely), purge its data AND treat the public link as dead: a purged
  // session has no route to show, so it returns 404 (the viewer shows "enlace
  // caducado") instead of a hollow "finished" page. The owner's authenticated
  // list still keeps the row (to reopen/rename/delete it) — this only affects
  // the public follower link.
  if (now > row.expiresAt) {
    status = 'ended'
    if (!row.pinned) {
      await env.DB.prepare(
        "UPDATE tracking_sessions SET status='ended', ended_at=COALESCE(ended_at, ?), lat=NULL, lon=NULL, trail=NULL WHERE id=?",
      ).bind(now, id).run()
      return json({ error: 'not_found' }, 404)
    }
  }

  // Keep showing the last known fix + trail whenever present, for active AND
  // ended sessions (until the lazy purge above clears them).
  let fix: TrackFix | null = null
  if (row.lat !== null && row.lon !== null && row.updatedAt !== null) {
    fix = {
      lat: row.lat, lon: row.lon, trackKm: row.trackKm, speed: row.speed,
      heading: row.heading, accuracy: row.accuracy, altitude: row.altitude,
      fixAt: row.fixAt, updatedAt: row.updatedAt,
    }
  }

  let trail: TrailPoint[] = []
  if (row.trail) {
    try { trail = JSON.parse(row.trail) as TrailPoint[] } catch { trail = [] }
  }

  let formLog: TrackStateResponse['formLog'] = undefined
  if (row.formLog) {
    try { formLog = JSON.parse(row.formLog) } catch { formLog = undefined }
  }

  // Field notes anchored during the session (public per the followers-see-all
  // decision). Oldest→newest so the viewer's feed reads in chronological order.
  // Guarded: if migration 0008 hasn't run yet the table is missing — degrade to
  // "no notes" rather than 500-ing the entire track view (decouples deploy order).
  let notes: TrackNote[] | undefined
  try {
    const noteRows = await env.DB.prepare(
      `SELECT id, created_at AS createdAt, fix_at AS fixAt, lat, lon, accuracy, altitude,
              track_km AS trackKm, dist_m AS distM, title, body,
              poi_type AS poiType, poi_sym AS poiSym, audio_key AS audioKey, photo_key AS photoKey
         FROM track_notes WHERE session_id=? ORDER BY created_at`,
    ).bind(id).all<TrackNote>()
    notes = noteRows.results.length ? noteRows.results : undefined
  } catch { notes = undefined }

  // Ánimos de los seguidores. Viajan con el estado (como las notas) en vez de en
  // una petición aparte: el visor ya sondea esto cada pocos segundos, así que
  // llegan solos sin abrir un segundo bucle. Más recientes primero, que es como
  // se leen, y recortados por arriba. Mismo guardado que las notas: si la
  // migración 0012 aún no ha corrido, degrada a "sin ánimos" en lugar de tumbar
  // la vista entera.
  let cheers: TrackCheer[] | undefined
  try {
    const cheerRows = await env.DB.prepare(
      `SELECT c.id, c.created_at AS createdAt, c.nick, c.body, c.track_km AS trackKm,
              (SELECT COUNT(*) FROM cheer_likes l WHERE l.cheer_id = c.id) AS likes,
              (SELECT COUNT(*) FROM cheer_likes l WHERE l.cheer_id = c.id AND l.viewer_id = ?) AS likedByMe
         FROM track_cheers c WHERE c.session_id=? ORDER BY c.created_at DESC LIMIT 200`,
    // SQLite devuelve el "¿lo he votado yo?" como 0/1, no como booleano, asi que
    // la fila NO es un TrackCheer todavia: se tipa aparte y se convierte al
    // mapear. Intersecarlo con TrackCheer daria `never` por el choque de tipos.
    ).bind(viewerId ?? '', id).all<Omit<TrackCheer, 'likedByMe'> & { likedByMe: number }>()
    cheers = cheerRows.results.length
      ? cheerRows.results.map((c) => ({ ...c, likes: c.likes ?? 0, likedByMe: !!c.likedByMe }))
      : undefined
  } catch { cheers = undefined }

  // Live presence: only meaningful while the session is active. Record this
  // viewer's heartbeat and report how many followers are currently watching.
  // Best-effort: presence must never break the state feed, so swallow failures
  // and just omit the count (viewers stays undefined).
  let viewers: number | undefined
  if (status === 'active') {
    try {
      if (viewerId) await recordViewer(env, id, viewerId)
      viewers = await countViewers(env, id)
    } catch { /* presence is non-critical */ }
  }

  const body: TrackStateResponse = {
    status, username: row.username, title: row.title, startedAt: row.startedAt, expiresAt: row.expiresAt,
    endedAt: row.endedAt, planShareId: row.planShareId,
    activity: isBeaconActivity(row.activity) ? row.activity : null,
    fix, trail, formFactor: row.formFactor ?? 1, formLog, viewers, notes, cheers,
  }
  return json(body, 200, { 'Cache-Control': 'no-store' })
}

/**
 * DELETE /api/track/:id — owner-only "eliminar de forma total": hard-delete the
 * row so nothing remains (unlike /end, which keeps the data for 24 h). Ownership
 * is checked with a SELECT (not meta.changes, unreliable on production D1).
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!csrfOk(request)) return json({ error: 'forbidden' }, 403)
  const id = String(params.id)
  if (!TOKEN_RE.test(id)) return json({ error: 'bad_id' }, 400)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const row = await env.DB.prepare('SELECT owner_user_id AS owner FROM tracking_sessions WHERE id=?')
    .bind(id).first<{ owner: string }>()
  if (!row || row.owner !== user.id) return json({ error: 'not_found' }, 404)

  // Purge any note media from KV first (D1 CASCADE removes the note rows, but not
  // the KV blobs keyed notemedia:<id>:*). Best-effort.
  try {
    const listed = await env.SHARE_KV.list({ prefix: `notemedia:${id}:` })
    await Promise.all(listed.keys.map((k) => env.SHARE_KV.delete(k.name)))
  } catch { /* best-effort */ }

  await env.DB.prepare('DELETE FROM tracking_sessions WHERE id=? AND owner_user_id=?')
    .bind(id, user.id).run()
  return new Response(null, { status: 204 })
}
