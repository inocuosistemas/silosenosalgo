import type { GpxTrack, GpxNamedWaypoint } from './gpx'
import type { TrackNote } from '../../shared/wireTypes'
import { poiTypeFor } from '../../shared/poiTypes'

/**
 * Convert field notes into GPX <wpt> POIs so an exported "guía" carries them.
 * A note keeps its TRUE captured coords (keepExactCoords) — it can be off-route
 * — but we still snap onto the track to derive a distanceKm for ordering and the
 * `silosenosalgo:distanceKm` extension. sym/type come from the taxonomy; the
 * body → <desc>, capture time → <time>, and any media → <link>.
 */

/** Nearest track point to (lat,lon): index + its cumulative km. Planar approx —
 *  fine at note-to-route distances. */
function snapToTrack(track: GpxTrack, lat: number, lon: number): { idx: number; km: number } {
  const cosLat = Math.cos((lat * Math.PI) / 180)
  let idx = 0
  let best = Infinity
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i]
    const dLat = p.lat - lat
    const dLon = (p.lon - lon) * cosLat
    const d = dLat * dLat + dLon * dLon
    if (d < best) { best = d; idx = i }
  }
  return { idx, km: track.cumKm[idx] ?? 0 }
}

export interface NoteToGpxOpts {
  /** Builds a public URL for a note's media, so an exported <link> resolves in
   *  external tools. Given the note id + kind; returns null to skip. When omitted,
   *  media links are dropped (text-only export). */
  mediaUrl?: (noteId: string, kind: 'audio' | 'photo') => string | null
}

export function noteToWaypoint(note: TrackNote, track: GpxTrack, opts: NoteToGpxOpts = {}): GpxNamedWaypoint {
  const t = poiTypeFor(note.poiType)
  const snap = track.points.length ? snapToTrack(track, note.lat, note.lon) : { idx: 0, km: note.trackKm ?? 0 }

  const links: NonNullable<GpxNamedWaypoint['links']> = []
  if (opts.mediaUrl && note.photoKey) {
    const u = opts.mediaUrl(note.id, 'photo')
    if (u) links.push({ href: u, text: 'Foto', type: 'image/jpeg' })
  }
  if (opts.mediaUrl && note.audioKey) {
    const u = opts.mediaUrl(note.id, 'audio')
    if (u) links.push({ href: u, text: 'Audio', type: 'audio/mp4' })
  }

  return {
    lat: note.lat,
    lon: note.lon,
    ele: note.altitude ?? null,
    name: note.title || t.label,
    desc: note.body || undefined,
    sym: note.poiSym || t.gpxSym,
    type: note.poiType,
    time: new Date(note.createdAt),
    links: links.length ? links : undefined,
    keepExactCoords: true,
    distanceKm: note.trackKm != null ? note.trackKm : snap.km,
    nearestTrackIndex: snap.idx,
    custom: true,
  }
}

/** Merge notes into a track's namedWaypoints (returns a new track), ready for
 *  serializeGpx. Existing route POIs are preserved. */
export function withNoteWaypoints(track: GpxTrack, notes: TrackNote[], opts: NoteToGpxOpts = {}): GpxTrack {
  if (!notes.length) return track
  const noteWpts = notes.map((n) => noteToWaypoint(n, track, opts))
  return { ...track, namedWaypoints: [...track.namedWaypoints, ...noteWpts] }
}
