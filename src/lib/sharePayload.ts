import type { GpxNamedWaypoint, GpxTrack } from './gpx'
import type { PaceConfig, SamplingConfig } from './timing'
import type { CutoffWallClock } from './cutoffInference'

/**
 * "Compartir salida" — serialisable snapshot of everything needed to
 * reconstruct a planned outing on another device (a full fork): the entire
 * track at full resolution, its POIs (incl. user-added), the start time, pace,
 * cut-offs and the sampling config.
 *
 * This is intentionally close to `SavedSession` (the localStorage resume blob)
 * so the receiver can re-use the existing `handleTrack` + restore flow. The big
 * difference: it travels over the network (gzipped — see `shareTransport.ts`),
 * so we never decimate the track here.
 *
 * Versioned via `v` so old links keep working as the schema evolves; bump
 * `SHARE_PAYLOAD_VERSION` and add a migrator in `reviveSharePayload` when the
 * shape changes.
 */
export const SHARE_PAYLOAD_VERSION = 1

/** A track point with `time` as an ISO string (JSON-safe; revived to Date). */
interface SharePoint {
  lat: number
  lon: number
  ele: number
  time: string | null
}

export interface SharePayloadV1 {
  v: 1
  track: {
    name: string
    points: SharePoint[]
    totalDistanceKm: number
    elevGainM: number
    elevLossM: number
    /** Includes custom POIs, pauseMin, cutoffWallClock, distanceKm, nearestTrackIndex. */
    namedWaypoints: GpxNamedWaypoint[]
    cumKm: number[]
  }
  startTimeISO: string
  paceConfig: PaceConfig
  sampling: SamplingConfig
  /** Cut-offs keyed by "lat.toFixed(6),lon.toFixed(6)" — Map flattened to object. */
  cutoffWallClocks: Record<string, { hour: number; minute: number }>
  createdAt: string
}

export interface ShareInput {
  track: GpxTrack
  startTime: Date
  paceConfig: PaceConfig
  sampling: SamplingConfig
  cutoffWallClocks: Map<string, CutoffWallClock>
}

export interface RevivedShare {
  track: GpxTrack
  startTime: Date
  paceConfig: PaceConfig
  sampling: SamplingConfig
  cutoffWallClocks: Map<string, CutoffWallClock>
}

/** Error thrown by `reviveSharePayload` for malformed / unsupported payloads. */
export class SharePayloadError extends Error {
  constructor(public kind: 'malformed' | 'unsupported_version') {
    super(kind)
    this.name = 'SharePayloadError'
  }
}

/** Build the JSON-safe payload from the current app state. `time` → ISO string. */
export function buildSharePayload(input: ShareInput): SharePayloadV1 {
  const { track } = input
  const cutoffWallClocks: Record<string, { hour: number; minute: number }> = {}
  for (const [k, v] of input.cutoffWallClocks) {
    cutoffWallClocks[k] = { hour: v.hour, minute: v.minute }
  }
  return {
    v: SHARE_PAYLOAD_VERSION,
    track: {
      name: track.name,
      points: track.points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        ele: p.ele,
        time: p.time ? p.time.toISOString() : null,
      })),
      totalDistanceKm: track.totalDistanceKm,
      elevGainM: track.elevGainM,
      elevLossM: track.elevLossM,
      namedWaypoints: track.namedWaypoints,
      cumKm: track.cumKm,
    },
    startTimeISO: input.startTime.toISOString(),
    paceConfig: input.paceConfig,
    sampling: input.sampling,
    cutoffWallClocks,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Revive a parsed payload back into in-memory shapes. Critically converts each
 * point's `time` from ISO string to `Date | null` — the rest of the app calls
 * `.getTime()` on it and crashes (black screen) otherwise, the same hazard
 * `loadSession` guards against.
 *
 * Throws `SharePayloadError` for unknown versions or structurally invalid data.
 */
export function reviveSharePayload(raw: unknown): RevivedShare {
  if (!raw || typeof raw !== 'object') throw new SharePayloadError('malformed')
  const obj = raw as Partial<SharePayloadV1>
  if (obj.v !== SHARE_PAYLOAD_VERSION) throw new SharePayloadError('unsupported_version')
  const t = obj.track
  if (!t || !Array.isArray(t.points) || t.points.length === 0 || !obj.startTimeISO) {
    throw new SharePayloadError('malformed')
  }

  const track: GpxTrack = {
    name: t.name ?? 'Ruta compartida',
    points: t.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      time: p.time ? new Date(p.time) : null,
    })),
    totalDistanceKm: t.totalDistanceKm,
    elevGainM: t.elevGainM,
    elevLossM: t.elevLossM,
    namedWaypoints: Array.isArray(t.namedWaypoints) ? t.namedWaypoints : [],
    cumKm: Array.isArray(t.cumKm) ? t.cumKm : [],
  }

  const cutoffWallClocks = new Map<string, CutoffWallClock>()
  if (obj.cutoffWallClocks && typeof obj.cutoffWallClocks === 'object') {
    for (const [k, v] of Object.entries(obj.cutoffWallClocks)) {
      if (v && typeof v.hour === 'number' && typeof v.minute === 'number') {
        cutoffWallClocks.set(k, { hour: v.hour, minute: v.minute })
      }
    }
  }

  return {
    track,
    startTime: new Date(obj.startTimeISO),
    paceConfig: obj.paceConfig as PaceConfig,
    sampling: obj.sampling as SamplingConfig,
    cutoffWallClocks,
  }
}
