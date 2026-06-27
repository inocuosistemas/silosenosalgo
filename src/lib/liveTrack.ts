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

export async function fetchTrackState(token: string): Promise<TrackStateResponse> {
  let res: Response
  try {
    res = await fetch(`/api/track/${encodeURIComponent(token)}`, { cache: 'no-store' })
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
