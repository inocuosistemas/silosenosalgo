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
export const SHARE_PAYLOAD_VERSION = 2

/** A track point with `time` as an ISO string (JSON-safe; revived to Date). */
interface SharePoint {
  lat: number
  lon: number
  ele: number
  time: string | null
}

export interface SharePayloadV1 {
  v: 1 | 2
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
  /**
   * Si la hora de salida la ELIGIÓ alguien, o es la de relleno que el
   * planificador pone al abrirse (la próxima hora en punto).
   *
   * Hace falta porque el documento exige una hora —el pronóstico se calcula
   * contra ella— y entonces toda ruta guardada llevaba una, elegida o no. La
   * baliza no podía distinguirlas: copiaba la de relleno y se quedaba armada
   * esperando una salida que nadie había programado. Sin la marca (documentos
   * anteriores a ella) se da por elegida: no se sabe, y así nada cambia.
   */
  startTimeChosen?: boolean
  /**
   * Si la ruta lleva previsión —hora, ritmos y cortes planificados— o es solo
   * el recorrido (un GPX cargado desde la baliza, p. ej.). Sin previsión el
   * visor no enseña corredor fantasma ni "vs plan": serían contra unos ritmos
   * que nadie eligió. Sin la marca (documentos anteriores) se da por hecha:
   * todos nacieron en el planificador.
   */
  withForecast?: boolean
  paceConfig: PaceConfig
  sampling: SamplingConfig
  /** Cut-offs keyed by "lat.toFixed(6),lon.toFixed(6)" — Map flattened to object. */
  cutoffWallClocks: Record<string, { hour: number; minute: number }>
  /** v2+: strategy margin (minutes before cut-offs) + per-segment objective times. */
  strategyMargin?: number
  segmentTargets?: { km: number; timeISO: string }[]
  createdAt: string
}

export interface ShareInput {
  track: GpxTrack
  startTime: Date
  /** Ver `SharePayloadV1.startTimeChosen`. */
  startTimeChosen?: boolean
  /** Ver `SharePayloadV1.withForecast`. */
  withForecast?: boolean
  paceConfig: PaceConfig
  sampling: SamplingConfig
  cutoffWallClocks: Map<string, CutoffWallClock>
  strategyMargin?: number
  segmentTargets?: Map<number, Date>
}

export interface RevivedShare {
  track: GpxTrack
  startTime: Date
  /** Falso solo si el documento dice expresamente que nadie la eligió. */
  startTimeChosen: boolean
  /** Falso solo si el documento dice expresamente que es solo el recorrido. */
  withForecast: boolean
  paceConfig: PaceConfig
  sampling: SamplingConfig
  cutoffWallClocks: Map<string, CutoffWallClock>
  strategyMargin?: number
  segmentTargets?: Map<number, Date>
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
  const segmentTargets = input.segmentTargets
    ? [...input.segmentTargets].map(([km, d]) => ({ km, timeISO: d.toISOString() }))
    : undefined
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
    startTimeChosen: input.startTimeChosen,
    withForecast: input.withForecast,
    paceConfig: input.paceConfig,
    sampling: input.sampling,
    cutoffWallClocks,
    strategyMargin: input.strategyMargin,
    segmentTargets,
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
  if (obj.v !== 1 && obj.v !== 2) throw new SharePayloadError('unsupported_version')
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

  let segmentTargets: Map<number, Date> | undefined
  if (Array.isArray(obj.segmentTargets)) {
    segmentTargets = new Map()
    for (const t of obj.segmentTargets) {
      if (t && typeof t.km === 'number' && typeof t.timeISO === 'string') {
        const d = new Date(t.timeISO)
        if (!Number.isNaN(d.getTime())) segmentTargets.set(t.km, d)
      }
    }
  }

  return {
    track,
    startTime: new Date(obj.startTimeISO),
    startTimeChosen: obj.startTimeChosen !== false,
    withForecast: obj.withForecast !== false,
    paceConfig: obj.paceConfig as PaceConfig,
    sampling: obj.sampling as SamplingConfig,
    cutoffWallClocks,
    strategyMargin: typeof obj.strategyMargin === 'number' ? obj.strategyMargin : undefined,
    segmentTargets,
  }
}
