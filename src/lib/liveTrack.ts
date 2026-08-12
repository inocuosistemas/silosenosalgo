import type { TrackStateResponse } from '../../shared/wireTypes'

/**
 * Public read of a live-tracking session (no auth). Used by the `?t=` viewer.
 * Served from the same public origin the follower opened.
 */
export class LiveTrackError extends Error {
  constructor(public kind: 'not_found' | 'network') {
    super(kind)
    this.name = 'LiveTrackError'
  }
}

/** A stable, anonymous per-browser id so the backend can count active followers
 *  (presence) without any account. Persisted across reloads; falls back to an
 *  in-memory id when storage is unavailable (private mode / embedded viewer). */
let memoViewerId: string | null = null
export function viewerId(): string {
  const fresh = () =>
    (globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 64)
  try {
    const KEY = 'slsns-viewer-id'
    let id = localStorage.getItem(KEY)
    if (!id) { id = fresh(); localStorage.setItem(KEY, id) }
    return id
  } catch {
    return (memoViewerId ??= fresh())
  }
}

export async function fetchTrackState(token: string): Promise<TrackStateResponse> {
  let res: Response
  try {
    res = await fetch(`/api/track/${encodeURIComponent(token)}?v=${viewerId()}`, { cache: 'no-store' })
  } catch {
    throw new LiveTrackError('network')
  }
  if (res.status === 404 || res.status === 400) throw new LiveTrackError('not_found')
  if (!res.ok) throw new LiveTrackError('network')
  return (await res.json()) as TrackStateResponse
}

/** Haversine distance in km between two [lat, lon] points. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
