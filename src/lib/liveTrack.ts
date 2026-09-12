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

/**
 * El prefijo de una baliza de DEMO: `demo:<fichero>:<corredor>:<instante>`.
 *
 * No es un token de verdad y no llega al servidor. Sirve para mirar el visor de
 * una baliza como se veía en un momento concreto de una carrera real —la
 * CanFranc-CanFranc entera está guardada— y comprobar ahí los cambios: la
 * cuenta al corte, las tarjetas de tramo, la traza. Lo mismo que el mapa del
 * evento en `?demo=`, pero para el seguimiento individual.
 */
const DEMO = 'demo:'

/** Rehace el estado de una baliza tal y como estaba en ese instante. */
async function estadoDeDemo(token: string): Promise<TrackStateResponse> {
  const [, fichero, quien, enRaw] = token.split(':')
  const en = Number(enRaw)
  const d = await (await fetch(`/demo/${fichero}.json`, { cache: 'force-cache' })).json()
  const r = (d.runners as { username: string; startedAt: number | null; endedAt: number | null
    activity: string | null
    traza: { t: number; lat: number; lon: number; a?: number | null; e?: number | null }[] }[])
    .find((x) => x.username === quien)
  if (!r) throw new LiveTrackError('not_found')
  // Rebobinar es quedarse con lo que se sabía ENTONCES, ni un punto más.
  const hasta = r.traza.filter((q) => q.t <= en)
  const ultimo = hasta[hasta.length - 1] ?? null
  const acabada = r.endedAt != null && r.endedAt <= en
  return {
    official: null,
    status: acabada ? 'ended' : 'active',
    username: r.username,
    title: `${d.name} · demo`,
    startedAt: d.startsAt ?? r.startedAt ?? (hasta[0]?.t ?? en),
    expiresAt: en + 24 * 3600_000,
    endedAt: acabada ? r.endedAt : null,
    planShareId: d.planShareId ?? null,
    activity: (r.activity ?? null) as TrackStateResponse['activity'],
    fix: ultimo
      ? { lat: ultimo.lat, lon: ultimo.lon, trackKm: null, speed: null, heading: null,
          accuracy: ultimo.a ?? null, altitude: ultimo.e ?? null, fixAt: ultimo.t, updatedAt: ultimo.t }
      : null,
    trail: hasta.map((q) => ({ t: q.t, lat: q.lat, lon: q.lon, a: q.a ?? null, e: q.e ?? null })),
    notes: [],
    cheers: [],
  } as TrackStateResponse
}

export async function fetchTrackState(token: string): Promise<TrackStateResponse> {
  if (token.startsWith(DEMO)) return estadoDeDemo(token)
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
