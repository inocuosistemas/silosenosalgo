import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { GpxUploader } from './components/GpxUploader'
import { PaceConfigPanel } from './components/PaceConfig'
import { GpxTimesStats } from './components/GpxTimesStats'
import { SamplingPanel } from './components/SamplingPanel'
import { RouteMap } from './components/RouteMap'
import type { MapMode } from './components/RouteMap'
import { WeatherCharts } from './components/WeatherCharts'
import { WaypointsTable } from './components/WaypointsTable'
import type { GpxTrack, GpxNamedWaypoint } from './lib/gpx'
import { downloadGpx } from './lib/gpxSerialize'
import { downloadFitCourse } from './lib/fitCourse'
import { PoisPanel, type MaterialisedPoi } from './components/PoisPanel'
import type { CutoffWallClock } from './lib/cutoffInference'
import { inferCutoffDatesFromWaypoints } from './lib/cutoffInference'
import type { PaceConfig, PausePoint, SamplingConfig, Waypoint } from './lib/timing'
import { ACTIVITY_LABEL, ACTIVITY_MAX_SPEED_KMH, computeWaypoints, DEFAULT_SAMPLING, expectedKmAtElapsed, expectedMinutesForSegment, formatDelta, formatPace, formatTime, haversineKm } from './lib/timing'
import type { WeatherData } from './lib/weather'
import { fetchWeatherForWaypoints } from './lib/weather'
import type { PollenData, PollenType } from './lib/pollen'
import { fetchPollenForWaypoints, isInEurope, defaultPollenType, POLLEN_TYPES } from './lib/pollen'
import type { TerrainType } from './lib/terrain'
import { fetchTerrainForTrack, OverpassRateLimitError } from './lib/terrain'
import type { LocationInfo, EnrichedNamedWaypoint } from './lib/places'
import { fetchLocationForWaypoints } from './lib/places'
import { CutoffSummary } from './components/CutoffSummary'
import { ShareCard } from './components/ShareCard'
import { CutoffStrategy } from './components/CutoffStrategy'
import { BuddyTracker } from './components/BuddyTracker'
import type { NextCutoffInfo } from './components/BuddyTracker'
import { computeCutoffStrategy } from './lib/cutoffStrategy'
import type { SegmentPace } from './lib/timing'
import type { BuddyObservation } from './lib/buddyTracking'
import { buildBuddyDerived, projectBuddyKmAt } from './lib/buddyTracking'
import { useLivePosition } from './lib/useLivePosition'
import type { LivePositionState } from './lib/useLivePosition'
import { useFreshnessLabel } from './lib/useFreshnessLabel'
import { useNowTick } from './lib/useNowTick'
import { checkGpxTimes, reclassifyForActivity } from './lib/gpxValidity'
import type { GpxTimesValidity } from './lib/gpxValidity'
import { summariseDaylight, type DaylightSummary, type DaylightBand } from './lib/daylight'

const DEFAULT_PACE: PaceConfig = {
  mode: 'fixed',
  paceMinPerKm: 5.5,
  naismithMin100mUp: 6,
  activity: 'walk',
}

const PACE_LS_KEY = 'silosenosalgo-pace-v1'

function loadPaceConfig(): PaceConfig {
  try {
    const raw = localStorage.getItem(PACE_LS_KEY)
    if (!raw) return DEFAULT_PACE
    const obj = JSON.parse(raw)
    return {
      mode: obj.mode === 'naismith' || obj.mode === 'gpx' || obj.mode === 'gpx-moving' ? obj.mode : 'fixed',
      paceMinPerKm: typeof obj.paceMinPerKm === 'number' && obj.paceMinPerKm > 0 ? obj.paceMinPerKm : DEFAULT_PACE.paceMinPerKm,
      naismithMin100mUp: typeof obj.naismithMin100mUp === 'number' ? obj.naismithMin100mUp : DEFAULT_PACE.naismithMin100mUp,
      activity: obj.activity === 'run' || obj.activity === 'bike' ? obj.activity : 'walk',
    }
  } catch {
    return DEFAULT_PACE
  }
}

function savePaceConfig(c: PaceConfig) {
  try { localStorage.setItem(PACE_LS_KEY, JSON.stringify(c)) } catch { /* ignore quota errors */ }
}

// ── Pollen type persistence ────────────────────────────────────────────────────
const POLLEN_TYPE_LS_KEY = 'silosenosalgo-pollen-type-v1'

function loadPollenType(): PollenType {
  try {
    const raw = localStorage.getItem(POLLEN_TYPE_LS_KEY)
    if (raw && (POLLEN_TYPES as string[]).includes(raw)) return raw as PollenType
  } catch { /* ignore */ }
  return defaultPollenType(new Date().getMonth() + 1)
}

function savePollenType(t: PollenType) {
  try { localStorage.setItem(POLLEN_TYPE_LS_KEY, t) } catch { /* ignore */ }
}

// ── Rain-radar overlay persistence ────────────────────────────────────────────
const RAIN_RADAR_LS_KEY = 'silosenosalgo-rain-radar-v1'

function loadShowRainRadar(): boolean {
  try { return localStorage.getItem(RAIN_RADAR_LS_KEY) === '1' } catch { return false }
}

function saveShowRainRadar(v: boolean) {
  try { localStorage.setItem(RAIN_RADAR_LS_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// ── Wind-animation overlay persistence ────────────────────────────────────────
const WIND_ANIM_LS_KEY = 'silosenosalgo-wind-anim-v1'

function loadShowWindAnimation(): boolean {
  try { return localStorage.getItem(WIND_ANIM_LS_KEY) === '1' } catch { return false }
}

function saveShowWindAnimation(v: boolean) {
  try { localStorage.setItem(WIND_ANIM_LS_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// ── Session restore ───────────────────────────────────────────────────────────
// Persists track + planning inputs so the user can resume their last session.
const SESSION_LS_KEY = 'silosenosalgo-session-v1'

interface SavedSession {
  track: GpxTrack
  startTimeISO: string
  paceConfig: PaceConfig
  sampling: SamplingConfig
  savedAt: string
  /** Full-resolution GPX time stats, captured before any subsampling. */
  gpxStats?: GpxTimesValidity | null
  /** Point count of the original track (track.points may be subsampled to fit). */
  originalPointCount?: number
  /** True when track.points was decimated to fit localStorage. */
  subsampled?: boolean
}

/** Max track points persisted in a session (≈0.6 MB JSON — well under quota). */
const MAX_PERSIST_POINTS = 8000

/**
 * Evenly decimate a track's points to at most `max`, always keeping the first
 * and last point (so GPX-time telescoping stays exact). cumKm / totalDistanceKm
 * are recomputed from the kept points; elevation aggregates and named waypoints
 * are preserved as-is.
 */
function subsampleTrack(track: GpxTrack, max: number): GpxTrack {
  const pts = track.points
  if (pts.length <= max) return track
  const step = (pts.length - 1) / (max - 1)
  const kept: typeof pts = []
  for (let i = 0; i < max; i++) kept.push(pts[Math.round(i * step)])
  let total = 0
  const cumKm = [0]
  for (let i = 1; i < kept.length; i++) { total += haversineKm(kept[i - 1], kept[i]); cumKm.push(total) }
  return { ...track, points: kept, cumKm, totalDistanceKm: total }
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_LS_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj?.track?.points?.length || !obj?.startTimeISO) return null
    // Revivir Dates: JSON.parse deja `time` como string; el resto del código
    // espera Date | null y se rompe (pantalla negra) al llamar .getTime().
    for (const p of obj.track.points) {
      p.time = p.time ? new Date(p.time) : null
    }
    return obj as SavedSession
  } catch { return null }
}

function saveSession(s: Omit<SavedSession, 'savedAt'>) {
  const originalPointCount = s.originalPointCount ?? s.track.points.length
  const persistTrack = subsampleTrack(s.track, MAX_PERSIST_POINTS)
  const subsampled = persistTrack.points.length < originalPointCount
  const record: SavedSession = {
    ...s,
    track: persistTrack,
    originalPointCount,
    subsampled,
    savedAt: new Date().toISOString(),
  }
  try {
    localStorage.setItem(SESSION_LS_KEY, JSON.stringify(record))
  } catch {
    // Still over quota — decimate harder so a (lower-res) session is kept
    // rather than leaving a stale, unrelated one behind.
    try {
      localStorage.setItem(
        SESSION_LS_KEY,
        JSON.stringify({ ...record, track: subsampleTrack(s.track, 2000), subsampled: true }),
      )
    } catch { /* give up silently */ }
  }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_LS_KEY) } catch { /* ignore */ }
}

// ── Cut-off time helpers ───────────────────────────────────────────────────────
/** Stable key for a named waypoint based on its coordinates. */
function wptKey(lat: number, lon: number) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

const CUTOFF_LS_PREFIX = 'silosenosalgo-cutoffs-'
const CUTOFF_LS_VERSION = 'v2'

/**
 * Load cut-off wall-clocks from localStorage. Tolerant of two formats:
 *  - v2 (current): `{ version: "v2", data: { "lat,lon": { hour, minute }, ... } }`
 *  - v1 (legacy):  `{ "lat,lon": "ISO timestamp", ... }` — we extract HH:MM in
 *                  local time and discard the day (it gets re-inferred fresh).
 *
 * The migration is non-destructive: the day part of the legacy data was the
 * buggy bit, and HH:MM (the user's actual intent) is preserved.
 */
function loadCutoffWallClocks(trackName: string): Map<string, CutoffWallClock> {
  try {
    const raw = localStorage.getItem(CUTOFF_LS_PREFIX + trackName)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw)

    // v2: { version: "v2", data: { key: { hour, minute } } }
    if (parsed && parsed.version === CUTOFF_LS_VERSION && parsed.data) {
      const map = new Map<string, CutoffWallClock>()
      for (const [k, v] of Object.entries(parsed.data as Record<string, { hour: number; minute: number }>)) {
        if (typeof v?.hour === 'number' && typeof v?.minute === 'number') {
          map.set(k, { hour: v.hour, minute: v.minute })
        }
      }
      return map
    }

    // v1 legacy: { key: ISO string }
    const map = new Map<string, CutoffWallClock>()
    for (const [k, val] of Object.entries(parsed as Record<string, string>)) {
      const d = new Date(val)
      if (!isNaN(d.getTime())) {
        map.set(k, { hour: d.getHours(), minute: d.getMinutes() })
      }
    }
    if (map.size > 0) saveCutoffWallClocks(trackName, map)  // upgrade in place
    return map
  } catch { return new Map() }
}

function saveCutoffWallClocks(trackName: string, wcs: Map<string, CutoffWallClock>) {
  try {
    const data: Record<string, CutoffWallClock> = {}
    for (const [k, v] of wcs) data[k] = v
    localStorage.setItem(
      CUTOFF_LS_PREFIX + trackName,
      JSON.stringify({ version: CUTOFF_LS_VERSION, data }),
    )
  } catch { /* ignore quota errors */ }
}

// ── User-added POIs persistence (per track name) ──────────────────────────────
const CUSTOM_POIS_LS_PREFIX = 'silosenosalgo-custom-pois-'

function loadCustomPois(trackName: string): GpxNamedWaypoint[] {
  try {
    const raw = localStorage.getItem(CUSTOM_POIS_LS_PREFIX + trackName)
    if (!raw) return []
    const arr = JSON.parse(raw) as GpxNamedWaypoint[]
    // Mark them all as custom even if the JSON happens to omit it (defensive)
    return arr.map((w) => ({ ...w, custom: true }))
  } catch { return [] }
}

function saveCustomPois(trackName: string, customPois: GpxNamedWaypoint[]) {
  try {
    if (customPois.length === 0) {
      localStorage.removeItem(CUSTOM_POIS_LS_PREFIX + trackName)
    } else {
      localStorage.setItem(CUSTOM_POIS_LS_PREFIX + trackName, JSON.stringify(customPois))
    }
  } catch { /* ignore quota errors */ }
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Short Spanish date for the compact params bar: "lun 4 may". */
function formatStartDate(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Short pace summary: "tiempos GPX", "6:30 min/km" or "22.0 km/h" (bike). */
function paceShortLabel(p: PaceConfig): string {
  if (p.mode === 'gpx') return 'GPX exacto'
  if (p.mode === 'gpx-moving') return `GPX en mov · ${formatPace(p.paceMinPerKm, p.activity)}`
  return formatPace(p.paceMinPerKm, p.activity)
}

/** Short sampling summary: "auto", "cada 2 km", "cada 15 min", "20 puntos". */
function samplingShortLabel(s: SamplingConfig): string {
  if (s.mode === 'auto')  return 'auto'
  if (s.mode === 'km')    return `cada ${s.intervalKm} km`
  if (s.mode === 'time')  return `cada ${s.intervalMinutes} min`
  if (s.mode === 'count') return `${s.count} puntos`
  return ''
}

type LoadStatus = 'idle' | 'loading' | 'live-loading' | 'done' | 'error'
type AppMode = 'plan' | 'live'

export default function App() {
  const [track, setTrack] = useState<GpxTrack | null>(null)
  const [startTime, setStartTime] = useState<Date>(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return d
  })
  const [paceConfig, setPaceConfig] = useState<PaceConfig>(loadPaceConfig)

  // Persist pace config across reloads
  useEffect(() => { savePaceConfig(paceConfig) }, [paceConfig])

  const [sampling, setSampling] = useState<SamplingConfig>(DEFAULT_SAMPLING)

  // Saved session detected at mount — shown as a banner while no track is loaded.
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSession())

  // ── Session restore bookkeeping ───────────────────────────────────────────
  // When a session whose track was subsampled is restored, we keep the
  // full-resolution GPX stats (so the times card stays exact) and remember the
  // original point count (so re-saving preserves it and we can warn the user).
  const [restoredGpxStats, setRestoredGpxStats] = useState<GpxTimesValidity | null>(null)
  const [trackOriginalPoints, setTrackOriginalPoints] = useState(0)
  const [subsampleNotice, setSubsampleNotice] = useState<{ original: number; current: number } | null>(null)

  const [baseWaypoints, setBaseWaypoints] = useState<Waypoint[]>([])
  const [weatherArr, setWeatherArr] = useState<(WeatherData | null)[]>([])
  const [locationArr, setLocationArr] = useState<(LocationInfo | null)[]>([])
  const [pollenArr, setPollenArr] = useState<(PollenData | null)[]>([])
  /**
   * Per-track-point terrain classification (length = `track.points.length`).
   * Computed once per track via Overpass + localStorage cache; the map renderer
   * groups consecutive same-terrain points into colored polyline runs.
   */
  const [terrainPoints, setTerrainPoints] = useState<TerrainType[]>([])
  /**
   * Independent status for the terrain (Overpass / OSM) fetch.
   * - 'idle'    : not yet started (no compute done in this session, or after a track change)
   * - 'loading' : Overpass request in flight; UI shows a spinner inside the terrain mode button
   * - 'done'    : data received (terrainPoints populated; may still contain 'unknown' entries for unmapped sections)
   * - 'error'   : Overpass failed; UI shows a retry button
   */
  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  /**
   * When `terrainStatus === 'error'`, distinguishes the failure kind so the UI
   * can show a meaningful message:
   *  - 'rate-limit' : Overpass returned 429 — too many recent queries; needs to wait
   *  - 'network'    : connection dropped, DNS, or CORS — usually transient
   *  - 'server'     : Overpass returned 5xx other than 504, or malformed response
   *
   * `terrainRetryAfterSec` is only meaningful with kind === 'rate-limit'.
   */
  const [terrainErrorKind, setTerrainErrorKind] = useState<'rate-limit' | 'network' | 'server'>('network')
  const [terrainRetryAfterSec, setTerrainRetryAfterSec] = useState(0)

  const [mapMode, setMapMode] = useState<MapMode>('rain')
  const [showRainRadar, setShowRainRadarState] = useState<boolean>(loadShowRainRadar)
  const setShowRainRadar = useCallback((v: boolean) => {
    setShowRainRadarState(v)
    saveShowRainRadar(v)
  }, [])
  const [showWindAnimation, setShowWindAnimationState] = useState<boolean>(loadShowWindAnimation)
  const setShowWindAnimation = useCallback((v: boolean) => {
    setShowWindAnimationState(v)
    saveShowWindAnimation(v)
  }, [])
  const [selectedPollenType, setSelectedPollenType] = useState<PollenType>(loadPollenType)

  // Persist pollen type selection across reloads
  useEffect(() => { savePollenType(selectedPollenType) }, [selectedPollenType])

  // Auto-switch away from pollen mode when the current route has no pollen data
  // (e.g. non-European route loaded, or a new GPX was uploaded)
  useEffect(() => {
    if (mapMode === 'pollen' && pollenArr.length > 0 && pollenArr.every((p) => p === null)) {
      setMapMode('rain')
    }
  }, [mapMode, pollenArr])

  const [status, setStatus] = useState<LoadStatus>('idle')

  // Auto-collapse the params bar after a successful compute.
  // Mirrors `isDone` so we don't collapse on a transient state.
  useEffect(() => {
    if (status === 'done' && baseWaypoints.length > 0) {
      setParamsExpanded(false)
      setParamsDirty(false)
      setHasComputedOnce(true)
    }
  }, [status, baseWaypoints.length])

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [locationProgress, setLocationProgress] = useState({ done: 0, total: 0 })
  // Background enrichment flags — weather/location/pollen fetch *after* the
  // synchronous waypoint compute, so the UI is usable while they load.
  const [weatherLoading, setWeatherLoading]   = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [pollenLoading, setPollenLoading]     = useState(false)
  /** Bumped on every compute; background fetches drop their results if stale. */
  const computeTokenRef = useRef(0)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)

  // ── Weather freshness ──────────────────────────────────────────────────────
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<Date | null>(null)
  /**
   * ETAs (in ms) at the moment of the last successful weather fetch — parallel
   * to baseWaypoints. We compare these against the current ETAs to detect
   * "drift" caused by pause edits (or any other recompute that doesn't go
   * through the network), so the freshness chip can flag stale forecasts
   * even when the fetch timestamp is recent.
   */
  const [weatherEtaSnapshot, setWeatherEtaSnapshot] = useState<number[] | null>(null)
  const [refreshingWeather, setRefreshingWeather] = useState(false)
  /** true = show "has estado fuera X min" banner */
  const [returnBanner, setReturnBanner] = useState(false)

  // ── App mode ───────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>('plan')

  // ── GPS simulation (dev only) ─────────────────────────────────────────────
  // simKm !== null means simulation is active: livePos is replaced by a fake
  // position at that km, and realPaceMinPerKm is replaced by simPace.
  const IS_DEV = import.meta.env.DEV
  const [simKm, setSimKm] = useState<number | null>(null)
  const [simTime, setSimTime] = useState<Date>(new Date())
  /** Lateral offset (km) applied to the fake fix to test the off-route path. */
  const [simOffsetKm, setSimOffsetKm] = useState(0)
  /** Arbitrary simulated fix dropped by clicking the map. Overrides simKm/offset. */
  const [simCoords, setSimCoords] = useState<{ lat: number; lon: number } | null>(null)
  /** When true, the next map click sets simCoords (crosshair cursor). */
  const [simPicking, setSimPicking] = useState(false)

  // ── Analyze range (null = play mode / full view) ───────────────────────────
  const [analyzeRange, setAnalyzeRange] = useState<{ from: number; to: number } | null>(null)

  // ── Cut-off wall-clocks for named waypoints (persisted per track name) ────
  // Stored as HH:MM only — the day is inferred at consumption time by
  // `inferCutoffDatesFromWaypoints` based on monotonicity vs startTime and
  // previous cut-offs. This means: cambiar startTime recalcula los días
  // automáticamente, y un corte cuya hora no cabe el mismo día salta al
  // siguiente sin intervención del usuario.
  const [cutoffWallClocks, setCutoffWallClocksState] = useState<Map<string, CutoffWallClock>>(new Map())

  // ── Variable segment paces (set by the cut-off strategy panel) ────────────
  // null = use paceConfig.paceMinPerKm uniformly (normal mode)
  const [segmentPaces, setSegmentPaces] = useState<SegmentPace[] | null>(null)

  // ── Safety margin for cut-off strategy (minutes) ───────────────────────────
  const [strategyMargin, setStrategyMargin] = useState(0)

  // ── Per-segment target times (override the global margin per anchor) ───────
  // Keyed by the cut-off waypoint's km. When set, that anchor's time becomes
  // the override instead of (cutoff − strategyMargin).
  const [segmentTargets, setSegmentTargets] = useState<Map<number, Date>>(() => new Map())
  const handleSegmentTargetChange = (km: number, time: Date | null) => {
    setSegmentTargets((prev) => {
      const next = new Map(prev)
      if (time) next.set(km, time)
      else      next.delete(km)
      return next
    })
  }

  // ── Plan-mode params bar: collapse / dirty tracking ───────────────────────
  // Sections 2-4 (start time, pace, sampling) collapse into a compact bar
  // after the first successful compute and re-expand via "Modificar".
  const [paramsExpanded, setParamsExpanded]   = useState(true)
  const [paramsDirty,    setParamsDirty]      = useState(false)
  const [hasComputedOnce, setHasComputedOnce] = useState(false)
  /**
   * Snapshot of param values taken when the user opens "Modificar".
   * Used to restore everything if they click "Cancelar" without recomputing.
   */
  const [paramsSnapshot, setParamsSnapshot] = useState<{
    startTime:    Date
    paceConfig:   PaceConfig
    sampling:     SamplingConfig
    segmentPaces: SegmentPace[] | null
    buddyObs:     BuddyObservation[]
  } | null>(null)

  // ── Buddy tracking: list of observations { km, time } sorted by km ─────────
  // [] = no observation; when populated, ETAs are projected from the observed
  // per-segment paces (latest segment is used for the unknown future).
  const [buddyObs, setBuddyObs] = useState<BuddyObservation[]>([])

  /**
   * Session-scoped "dirty" flag — true when the user has made a change in the
   * current session that hasn't been written to a GPX file yet (POI added,
   * removed, cut-off edited). Reset on track load and on GPX download.
   * Drives the "cambios sin guardar" indicator in the POIs panel.
   */
  const [trackDirty, setTrackDirty] = useState(false)

  /**
   * Set or clear the cut-off for a checkpoint.
   *
   * `time` may come from a `<input type="datetime-local">` (which gives a
   * full Date) or from any other source. We intentionally extract only the
   * wall-clock HH:MM and discard the day — the day will be re-inferred from
   * route order + startTime + previous cut-offs by `inferCutoffDates`.
   */
  const setCutoff = useCallback((lat: number, lon: number, time: Date | null) => {
    if (!track) return
    const key = wptKey(lat, lon)
    setCutoffWallClocksState((prev) => {
      const next = new Map(prev)
      if (time === null) {
        next.delete(key)
      } else {
        next.set(key, { hour: time.getHours(), minute: time.getMinutes() })
      }
      saveCutoffWallClocks(track.name, next)
      return next
    })
    setTrackDirty(true)
  }, [track])

  // Deferred: WeatherCharts, WeatherSummary and the waypoints table only re-render
  // when React is idle, keeping slider drag at 60 fps.
  const deferredAnalyzeRange = useDeferredValue(analyzeRange)

  /**
   * Capture the baseWaypoints' ETAs as the "fetched" snapshot every time a
   * weather fetch completes (weatherFetchedAt changes). We intentionally
   * exclude baseWaypoints from deps: later drift (caused by pause edits or
   * other inline recomputes) should be visible — only a real fetch refreshes
   * the snapshot.
   */
  useEffect(() => {
    if (weatherFetchedAt === null) {
      setWeatherEtaSnapshot(null)
      return
    }
    if (baseWaypoints.length === 0) return
    setWeatherEtaSnapshot(baseWaypoints.map((w) => w.estimatedTime.getTime()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherFetchedAt])

  /** Max ETA shift (minutes) between the current baseWaypoints and the snapshot at last fetch. */
  const weatherEtaDriftMin = useMemo(() => {
    if (!weatherEtaSnapshot || baseWaypoints.length !== weatherEtaSnapshot.length) return 0
    let maxMs = 0
    for (let i = 0; i < baseWaypoints.length; i++) {
      const d = Math.abs(baseWaypoints[i].estimatedTime.getTime() - weatherEtaSnapshot[i])
      if (d > maxMs) maxMs = d
    }
    return maxMs / 60_000
  }, [baseWaypoints, weatherEtaSnapshot])

  // ── GPS live position ──────────────────────────────────────────────────────
  /** Distance threshold in km above which we consider the GPS fix off-route. */
  const OFF_TRACK_KM = 0.5

  // Build a fake LivePositionState from an arbitrary clicked point: project it
  // onto the nearest track point (same resolution a real GPS fix gets) and
  // report the gap as distanceFromTrackKm so the off-route leader/UI kick in.
  const simCoordsLivePos = useMemo((): LivePositionState | null => {
    if (simCoords === null || !track || track.points.length < 2) return null
    const { points, cumKm, totalDistanceKm } = track
    let minDist = Infinity
    let nearestIdx = 0
    for (let i = 0; i < points.length; i++) {
      const d = haversineKm(simCoords, points[i])
      if (d < minDist) { minDist = d; nearestIdx = i }
    }
    const trackKm = cumKm[nearestIdx]
    return {
      isLocating: false, error: null,
      coords: simCoords,
      trackKm, trackIndex: nearestIdx,
      progress: totalDistanceKm > 0 ? Math.min(1, trackKm / totalDistanceKm) : 0,
      heading: null, speed: null, distanceFromTrackKm: minDist,
    }
  }, [simCoords, track])

  // Build a fake LivePositionState at simKm by interpolating along the *dense*
  // track geometry (track.points / track.cumKm), NOT the sparse baseWaypoints.
  // The map's "traveled" overlay is split along the dense track at the same km,
  // so interpolating the dot on the chord between far-apart waypoints would make
  // it lag the road and appear stuck while the faded segment advances.
  const simLivePos = useMemo((): LivePositionState | null => {
    if (simKm === null || !track || track.points.length < 2) return null
    const { points, cumKm, totalDistanceKm } = track
    const km = Math.max(0, Math.min(simKm, totalDistanceKm))
    let i = 0
    while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
    if (i >= cumKm.length - 1) {
      const last = points[points.length - 1]
      return {
        isLocating: false, error: null,
        coords: { lat: last.lat, lon: last.lon },
        trackKm: km, trackIndex: points.length - 1, progress: 1,
        heading: null, speed: null, distanceFromTrackKm: 0,
      }
    }
    const span = cumKm[i + 1] - cumKm[i]
    const t = span > 0 ? (km - cumKm[i]) / span : 0
    let lat = points[i].lat + t * (points[i + 1].lat - points[i].lat)
    let lon = points[i].lon + t * (points[i + 1].lon - points[i].lon)

    // Optional lateral offset (dev): push the fake fix perpendicular to the
    // track so we can exercise the off-route path. trackKm stays the on-track
    // projection — exactly what a real off-route fix resolves to.
    if (simOffsetKm !== 0) {
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180)
      const dN = (points[i + 1].lat - points[i].lat) * mPerDegLat
      const dE = (points[i + 1].lon - points[i].lon) * mPerDegLon
      const len = Math.hypot(dN, dE) || 1
      // rotate the unit direction 90° to get the perpendicular
      const perpN = dE / len
      const perpE = -dN / len
      const offM = simOffsetKm * 1000
      lat += (perpN * offM) / mPerDegLat
      lon += (perpE * offM) / mPerDegLon
    }

    return {
      isLocating: false, error: null,
      coords: { lat, lon },
      trackKm: km, trackIndex: i, progress: totalDistanceKm > 0 ? km / totalDistanceKm : 0,
      heading: null, speed: null, distanceFromTrackKm: Math.abs(simOffsetKm),
    }
  }, [simKm, simOffsetKm, track])

  const simActive = simKm !== null || simCoords !== null
  const rawLivePos = useLivePosition(track, appMode === 'live' && !simActive, ACTIVITY_MAX_SPEED_KMH[paceConfig.activity])
  const livePos: LivePositionState = simCoordsLivePos ?? simLivePos ?? rawLivePos

  /**
   * True when we have a GPS fix but it's implausibly far from the loaded route
   * (more than OFF_TRACK_KM from the nearest track point). This catches cases
   * like wrong GPX loaded, GPS drift to another continent, or pre-departure
   * situations where the user hasn't reached the start yet.
   */
  const isOffTrack = livePos.coords !== null && livePos.distanceFromTrackKm > OFF_TRACK_KM

  // ── Inline start-time editor in GPS bar ───────────────────────────────────
  const [liveEditingStart, setLiveEditingStart] = useState(false)

  const hasGpxTimes = !!track?.points.some((p) => p.time)

  // ── GPX times validity ────────────────────────────────────────────────────
  // For a restored (possibly subsampled) track we trust the full-resolution
  // stats captured at save time, re-classified for the current activity.
  // Otherwise we compute them live from the loaded track.
  const gpxValidity = useMemo<GpxTimesValidity | null>(
    () => {
      if (!track || !hasGpxTimes) return null
      if (restoredGpxStats) return reclassifyForActivity(restoredGpxStats, paceConfig.activity)
      return checkGpxTimes(track, paceConfig.activity)
    },
    [track, hasGpxTimes, paceConfig.activity, restoredGpxStats],
  )

  // Autosave the current planning session (subsampling large tracks to fit).
  useEffect(() => {
    if (!track) return
    saveSession({
      track,
      startTimeISO: startTime.toISOString(),
      paceConfig,
      sampling,
      gpxStats: gpxValidity,
      originalPointCount: trackOriginalPoints || track.points.length,
    })
  }, [track, startTime, paceConfig, sampling, gpxValidity, trackOriginalPoints])

  // Fall back to 'fixed' automatically when activity changes and makes GPX
  // invalid (applies to both GPX modes; 'gpx-moving' keeps its derived pace).
  useEffect(() => {
    if (paceConfig.mode !== 'gpx' && paceConfig.mode !== 'gpx-moving') return
    if (!gpxValidity || gpxValidity.issue === 'ok') return
    setPaceConfig((c) => ({ ...c, mode: 'fixed' }))
  }, [gpxValidity, paceConfig.mode])

  // ── Buddy-derived data: per-segment paces + metrics ───────────────────────
  // When at least one observation exists we replace paceConfig + segmentPaces
  // with values derived from the observations (mode forced to 'fixed' so the
  // observed paces, which already integrate terrain reality, are used as-is
  // without an additional Naismith elevation adjustment on top).
  const buddyDerived = useMemo(() => {
    if (!track || buddyObs.length === 0) return null
    return buildBuddyDerived(buddyObs, startTime, track.totalDistanceKm)
  }, [buddyObs, startTime, track])

  const effectivePaceConfig = useMemo<PaceConfig>(() => {
    if (buddyDerived) {
      return {
        ...paceConfig,
        mode: 'fixed',
        paceMinPerKm: buddyDerived.metrics.projectionPaceMinPerKm,
      }
    }
    return paceConfig
  }, [paceConfig, buddyDerived])

  const effectiveSegmentPaces: SegmentPace[] | null =
    buddyDerived ? buddyDerived.segmentPaces : segmentPaces

  // ── Buddy position projected to "now" (ticks every 30 s for the map) ──────
  const buddyTick = useNowTick(30_000, buddyObs.length > 0)
  const buddyKmNow = useMemo<number | null>(() => {
    if (!buddyDerived || !track) return null
    return projectBuddyKmAt(buddyDerived, buddyTick, track.totalDistanceKm)
  }, [buddyDerived, buddyTick, track])

  // ── Buddy projected ETA at the finish (uses projection pace) ──────────────
  const buddyEta = useMemo<Date | null>(() => {
    if (!buddyDerived || !track) return null
    const { lastObs, projectionPaceMinPerKm } = buddyDerived.metrics
    const remainingKm = track.totalDistanceKm - lastObs.km
    return new Date(lastObs.time.getTime() + remainingKm * projectionPaceMinPerKm * 60_000)
  }, [buddyDerived, track])

  // ── Real average pace from startTime (min/km) ─────────────────────────────
  // Only valid when ≥ 0.3 km covered AND startTime is in the past.
  // In sim mode, replaced by the user-configured simPace.
  const realPaceMinPerKm = useMemo(() => {
    if (simKm !== null && simKm > 0) {
      const elapsedMin = (simTime.getTime() - startTime.getTime()) / 60_000
      return elapsedMin > 0 ? elapsedMin / simKm : null
    }
    if (appMode !== 'live' || !livePos.coords || livePos.trackKm < 0.3) return null
    const elapsedMin = (Date.now() - startTime.getTime()) / 60_000
    if (elapsedMin <= 0) return null
    return elapsedMin / livePos.trackKm
  }, [simKm, simTime, startTime, appMode, livePos.coords, livePos.trackKm])

  // ── Tick every 30s in live mode so the "expected position" dot moves ──────
  // even when GPS is silent (user standing still).
  const nowTick = useNowTick(30_000, appMode === 'live')

  // In sim mode "now" is the user-chosen simTime, not the wall clock.
  const effectiveNow = simKm !== null ? simTime.getTime() : nowTick

  // ── Expected km on the track at this point in time (per the plan) ─────────
  // Use effectiveNow (= simTime in the simulator, wall clock otherwise) so the
  // "Prevista" dot stays consistent with the pace-delta badge; using the real
  // clock here made the expected dot race ahead during simulation.
  const expectedKm = useMemo<number | null>(() => {
    if (appMode !== 'live' || !track) return null
    const elapsedMin = (effectiveNow - startTime.getTime()) / 60_000
    if (elapsedMin <= 0) return null
    return expectedKmAtElapsed(track, elapsedMin, paceConfig)
  }, [appMode, track, startTime, paceConfig, effectiveNow])

  // ── Enriched waypoints (plan base) ────────────────────────────────────────
  const enrichedWaypoints = useMemo(
    () =>
      baseWaypoints.map((w, i) => ({
        ...w,
        weather: weatherArr[i] ?? null,
        location: locationArr[i] ?? null,
      })),
    [baseWaypoints, weatherArr, locationArr],
  )

  // ── Planned pauses (derived from named waypoints with pauseMin) ───────────
  // Anchored by km so the timing engine doesn't need to know about waypoint
  // identity. Empty when no POI carries a pause.
  const pauses = useMemo<PausePoint[]>(() => {
    if (!track) return []
    return track.namedWaypoints
      .filter((w) => w.pauseMin != null && w.pauseMin > 0)
      .map((w) => ({ km: w.distanceKm, minutes: w.pauseMin! }))
  }, [track])

  // ── Daylight summary for the route window ─────────────────────────────────
  // Anchored at the geographic midpoint of the track (sun times shift by only
  // 1-3 min across hundreds of km in temperate latitudes — irrelevant at our
  // scale). Window = startTime → estimatedTime of the final waypoint.
  const daylightAnchor = useMemo<{ lat: number; lon: number } | undefined>(() => {
    if (!track || track.points.length === 0) return undefined
    const m = track.points[Math.floor(track.points.length / 2)]
    return { lat: m.lat, lon: m.lon }
  }, [track])
  const daylight = useMemo<DaylightSummary | null>(() => {
    if (!daylightAnchor || enrichedWaypoints.length === 0) return null
    const lastEta = enrichedWaypoints[enrichedWaypoints.length - 1].estimatedTime
    if (!lastEta || lastEta.getTime() <= startTime.getTime()) return null
    return summariseDaylight(startTime, lastEta, daylightAnchor.lat, daylightAnchor.lon)
  }, [daylightAnchor, enrichedWaypoints, startTime])

  // ── Derived cut-off Dates (wall-clock + inferred day) ─────────────────────
  // Walk the named waypoints in km order, assigning each cut-off the smallest
  // day such that the resulting absolute time is strictly after the previous
  // cut-off (or startTime for the first). Re-runs whenever startTime, the
  // wall-clocks, or the route's POIs change.
  const cutoffTimes = useMemo<Map<string, Date>>(() => {
    if (!track) return new Map()
    return inferCutoffDatesFromWaypoints(track.namedWaypoints, cutoffWallClocks, startTime)
  }, [track, cutoffWallClocks, startTime])

  // ── Enriched named waypoints (<wpt> POIs from GPX) ────────────────────────
  // Estimated time: linearly interpolated between the two bounding enrichedWaypoints.
  // Weather: taken from the nearest enrichedWaypoint by distanceKm.
  const enrichedNamedWaypoints = useMemo<EnrichedNamedWaypoint[]>(() => {
    if (!track || enrichedWaypoints.length === 0) return []
    return track.namedWaypoints.map((wpt) => {
      // ── Interpolate estimated time ──────────────────────────────────────
      let estimatedTime: Date | null = null
      const wps = enrichedWaypoints
      if (wps.length >= 2) {
        let prevIdx = 0
        for (let i = 1; i < wps.length; i++) {
          if (wps[i].distanceKm >= wpt.distanceKm) break
          prevIdx = i
        }
        const nextIdx = Math.min(prevIdx + 1, wps.length - 1)
        const prev = wps[prevIdx]
        const next = wps[nextIdx]
        const span = next.distanceKm - prev.distanceKm
        const t = span > 0 ? Math.max(0, Math.min(1, (wpt.distanceKm - prev.distanceKm) / span)) : 0
        let interpMs = prev.estimatedTime.getTime() + t * (next.estimatedTime.getTime() - prev.estimatedTime.getTime())
        // The timing engine fires a pause when distAccum >= pauseKm, so every
        // enrichedWaypoint at km >= wpt.distanceKm already has the full pause
        // baked in. The interpolation at position t includes t×pauseMin of that
        // offset, but the ETA should represent *arrival* (before the pause).
        // Subtract the fraction that leaked in so the displayed time is the
        // moment the runner reaches the POI, not their departure time.
        if (wpt.pauseMin && wpt.pauseMin > 0 && prev.distanceKm < wpt.distanceKm) {
          interpMs -= t * wpt.pauseMin * 60_000
        }
        estimatedTime = new Date(interpMs)
      } else {
        estimatedTime = wps[0]?.estimatedTime ?? null
      }

      // ── Nearest waypoint weather ────────────────────────────────────────
      let weather: WeatherData | null = null
      let minDiff = Infinity
      for (const wp of wps) {
        const d = Math.abs(wp.distanceKm - wpt.distanceKm)
        if (d < minDiff) { minDiff = d; weather = wp.weather }
      }

      const key = wptKey(wpt.lat, wpt.lon)
      const cutoffTime = cutoffTimes.get(key)
      const cutoffMarginMin =
        cutoffTime && estimatedTime
          ? (cutoffTime.getTime() - estimatedTime.getTime()) / 60_000
          : undefined

      return { ...wpt, estimatedTime, weather, cutoffTime, cutoffMarginMin }
    })
  }, [track, enrichedWaypoints, cutoffTimes])

  // ── Live waypoints: remaining only, ETAs from now ─────────────────────────
  // Uses real average pace if available, else falls back to planned pace.
  // Also tracks which original indices survived the filter (for weather re-fetch)
  const { liveWaypoints, liveOriginalIndices } = useMemo(() => {
    if (appMode !== 'live' || !livePos.coords) {
      return {
        liveWaypoints: enrichedWaypoints,
        liveOriginalIndices: enrichedWaypoints.map((_, i) => i),
      }
    }
    const now = effectiveNow
    const lockedKm = livePos.trackKm
    // Real average pace preferred; fallback to configured pace when < 0.3 km covered
    const effectivePace = realPaceMinPerKm ?? paceConfig.paceMinPerKm
    const wps: typeof enrichedWaypoints = []
    const idxs: number[] = []
    enrichedWaypoints.forEach((wp, i) => {
      if (wp.distanceKm >= lockedKm - 0.05) {
        wps.push({
          ...wp,
          estimatedTime: new Date(
            now + Math.max(0, wp.distanceKm - lockedKm) * effectivePace * 60_000,
          ),
        })
        idxs.push(i)
      }
    })
    return { liveWaypoints: wps, liveOriginalIndices: idxs }
  }, [appMode, effectiveNow, livePos.coords, livePos.trackKm, enrichedWaypoints, paceConfig.paceMinPerKm, realPaceMinPerKm])

  // Keep a ref to the latest live waypoints/indices so the effect below can
  // read them without re-firing on every GPS update
  const liveDataRef = useRef({ liveWaypoints, liveOriginalIndices })
  liveDataRef.current = { liveWaypoints, liveOriginalIndices }

  // Flag: true once weather has been re-fetched for this live session
  const liveWeatherFetchedRef = useRef(false)

  // ── Re-fetch weather on first GPS fix in live mode ─────────────────────────
  useEffect(() => {
    if (appMode !== 'live') {
      liveWeatherFetchedRef.current = false
      return
    }
    if (!livePos.coords || liveWeatherFetchedRef.current) return

    liveWeatherFetchedRef.current = true
    const { liveWaypoints: wps, liveOriginalIndices: idxs } = liveDataRef.current
    if (wps.length === 0) return

    fetchWeatherForWaypoints(wps)
      .then((results) => {
        setWeatherArr((prev) => {
          const next = [...prev]
          results.forEach((r, i) => { next[idxs[i]] = r.weather })
          return next
        })
        setWeatherFetchedAt(new Date())
      })
      .catch(console.error)
  }, [appMode, livePos.coords])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function reset() {
    // Invalidate any in-flight background enrichment so its results are dropped.
    computeTokenRef.current++
    setWeatherLoading(false)
    setLocationLoading(false)
    setPollenLoading(false)
    setBaseWaypoints([])
    setWeatherArr([])
    setLocationArr([])
    setPollenArr([])
    setTerrainPoints([])
    setTerrainStatus('idle')
    setStatus('idle')
    setErrorMsg(null)
    setLocationWarning(null)
    setLocationProgress({ done: 0, total: 0 })
    setWeatherFetchedAt(null)
    setReturnBanner(false)
  }

  function handleTrack(t: GpxTrack) {
    // Restore previously-added custom POIs (per-track localStorage) and merge
    // them into the just-loaded track so the user sees their work continue
    // across reloads. They sort by km alongside any GPX-original wpts.
    //
    // CRITICAL: dedupe so the same custom POI doesn't appear twice when the
    // user re-uploads a GPX they previously downloaded (the POI lives in both
    // the file's <wpt>s and in the per-track localStorage cache).
    //
    // We match on name + km (≈50 m tolerance) instead of exact lat/lon: the
    // exporter snaps each <wpt> to the nearest <trkpt> (so Garmin Connect
    // associates them with the course), which means the file's coords no
    // longer match the cache's interpolated ones byte-for-byte.
    const DEDUPE_KM_TOLERANCE = 0.05
    const cachedCustom = loadCustomPois(t.name)
    const fileFingerprints = t.namedWaypoints.map((w) => ({ name: w.name, km: w.distanceKm }))
    const dedupedCached = cachedCustom.filter((cached) =>
      !fileFingerprints.some((f) => f.name === cached.name && Math.abs(f.km - cached.distanceKm) <= DEDUPE_KM_TOLERANCE)
    )
    if (dedupedCached.length !== cachedCustom.length) {
      saveCustomPois(t.name, dedupedCached)
    }
    const mergedNamedWpts = [...t.namedWaypoints, ...dedupedCached]
      .sort((a, b) => a.distanceKm - b.distanceKm)
    const mergedTrack: GpxTrack = { ...t, namedWaypoints: mergedNamedWpts }

    setTrack(mergedTrack)
    setAppMode('plan')
    setSimKm(null)
    setSavedSession(null) // banner dismissed once any track is loaded
    liveWeatherFetchedRef.current = false
    setAnalyzeRange(null)
    setSegmentPaces(null)
    setBuddyObs([])

    // Cut-offs: localStorage takes precedence (most recent edits); any
    // <silosenosalgo:cutoffWallClock> extensions from the loaded file fill
    // remaining gaps. Days are NOT stored — they're inferred at consumption
    // time by the `cutoffTimes` derived useMemo.
    const persisted = loadCutoffWallClocks(t.name)
    const merged = new Map(persisted)
    for (const wpt of mergedNamedWpts) {
      const key = wptKey(wpt.lat, wpt.lon)
      if (wpt.cutoffWallClock && !merged.has(key)) merged.set(key, wpt.cutoffWallClock)
    }
    setCutoffWallClocksState(merged)
    saveCutoffWallClocks(t.name, merged)

    // Fresh load → no pending session changes
    setTrackDirty(false)

    // Fresh load → full resolution, no restore override or subsample notice.
    // (A session restore re-sets these right after calling handleTrack.)
    setRestoredGpxStats(null)
    setTrackOriginalPoints(t.points.length)
    setSubsampleNotice(null)

    // Reset the params bar to its initial expanded state for the new route
    setParamsExpanded(true)
    setParamsDirty(false)
    setHasComputedOnce(false)
    reset()
    if (t.points.some((p) => p.time)) {
      // Only auto-switch to 'gpx' when the times are actually valid for the current activity
      const validity = checkGpxTimes(t, paceConfig.activity)
      if (validity.issue === 'ok') {
        setPaceConfig((c) => ({ ...c, mode: 'gpx' }))
      }
    }
  }

  // ── User-POI handlers ─────────────────────────────────────────────────────
  function handleAddPois(materialised: MaterialisedPoi[]) {
    if (!track) return
    const newPois = materialised.map((m) => m.poi)
    const mergedNamedWpts = [...track.namedWaypoints, ...newPois]
      .sort((a, b) => a.distanceKm - b.distanceKm)
    const newTrack: GpxTrack = { ...track, namedWaypoints: mergedNamedWpts }
    setTrack(newTrack)

    // Persist all custom POIs (including pre-existing) to localStorage
    saveCustomPois(track.name, mergedNamedWpts.filter((w) => w.custom))

    // Apply wall-clock cut-offs from materialised rows. The day each one
    // ends up on is decided automatically by the inference pass.
    const newWcs = new Map(cutoffWallClocks)
    for (const m of materialised) {
      if (m.cutoff) newWcs.set(wptKey(m.poi.lat, m.poi.lon), m.cutoff)
    }
    setCutoffWallClocksState(newWcs)
    saveCutoffWallClocks(track.name, newWcs)
    setTrackDirty(true)
  }

  function handleRemovePoi(lat: number, lon: number) {
    if (!track) return
    const filtered = track.namedWaypoints.filter(
      (w) => !(w.lat === lat && w.lon === lon && w.custom),
    )
    setTrack({ ...track, namedWaypoints: filtered })
    saveCustomPois(track.name, filtered.filter((w) => w.custom))

    // Drop any cut-off attached to this POI
    setCutoffWallClocksState((prev) => {
      const next = new Map(prev)
      next.delete(wptKey(lat, lon))
      saveCutoffWallClocks(track.name, next)
      return next
    })
    setTrackDirty(true)
  }

  function handleClearCustomPois() {
    if (!track) return
    const customKeys = new Set(
      track.namedWaypoints.filter((w) => w.custom).map((w) => wptKey(w.lat, w.lon)),
    )
    const filtered = track.namedWaypoints.filter((w) => !w.custom)
    setTrack({ ...track, namedWaypoints: filtered })
    saveCustomPois(track.name, [])

    setCutoffWallClocksState((prev) => {
      const next = new Map(prev)
      for (const k of customKeys) next.delete(k)
      saveCutoffWallClocks(track.name, next)
      return next
    })
    setTrackDirty(true)
  }

  /**
   * Re-trigger the terrain fetch without recomputing the whole plan.
   * Used by the "↻ Terreno" retry button in the map mode bar after a network
   * or Overpass HTTP failure.
   *
   * Trigger an on-demand terrain fetch. Used both for the initial load (the
   * mode is opt-in to avoid hammering Overpass on every computed route) and
   * for retrying after a failure. The localStorage cache (14-day TTL) is
   * consulted first; failures retry with `force: true` to bypass it.
   */
  const fetchTerrain = useCallback((opts: { force?: boolean } = {}) => {
    if (!track) return
    setTerrainStatus('loading')
    fetchTerrainForTrack(track, opts)
      .then((results) => {
        setTerrainPoints(results)
        setTerrainStatus('done')
      })
      .catch((err) => {
        console.error('Terrain fetch failed:', err)
        if (err instanceof OverpassRateLimitError) {
          setTerrainErrorKind('rate-limit')
          setTerrainRetryAfterSec(err.retryAfterSec)
        } else if (err instanceof TypeError) {
          setTerrainErrorKind('network')
        } else {
          setTerrainErrorKind('server')
        }
        setTerrainStatus('error')
      })
  }, [track])
  const retryTerrain = useCallback(() => fetchTerrain({ force: true }), [fetchTerrain])

  function handleDownloadGpx() {
    if (!track) return
    // Pass wall-clocks (not Dates) — the serializer writes them directly into
    // <silosenosalgo:cutoffWallClock> without any day component, since the
    // day is meant to be inferred at re-import time.
    downloadGpx(track, cutoffWallClocks)
    setTrackDirty(false)
  }

  // Garmin-compatible export: a FIT course whose course_points carry an explicit
  // `distance` field (meters). GPX cannot express per-POI course distance, so
  // Garmin Connect's GPX importer lists every POI at "0,00 km" — a FIT course is
  // the only format that makes the km stick. Diagnostic/secondary export, so it
  // does not clear trackDirty (the GPX remains the canonical round-trip file).
  function handleDownloadFit() {
    if (!track) return
    downloadFitCourse(track, paceConfig.activity)
  }

  // Loads localidades for the given waypoints in the background, updating
  // progress and (on failure) the warning banner. Shared by doCompute and the
  // retry button so both paths behave identically. The `fresh` guard drops
  // results from a superseded compute.
  function loadLocations(wps: Waypoint[], fresh: () => boolean) {
    if (!track) return
    setLocationWarning(null)
    setLocationLoading(true)
    setLocationProgress({ done: 0, total: 0 })
    fetchLocationForWaypoints(
      wps,
      track.totalDistanceKm,
      (done, total) => { if (fresh()) setLocationProgress({ done, total }) },
    )
      .then((results) => { if (fresh()) setLocationArr(results) })
      .catch((err: unknown) => {
        if (fresh()) setLocationWarning(err instanceof Error ? err.message : 'No se pudieron obtener localidades')
      })
      .finally(() => { if (fresh()) setLocationLoading(false) })
  }

  // Retry just the localidades fetch (e.g. after a timeout), reusing the
  // already-computed route. Captures the current token so a later recompute
  // supersedes the retry.
  function handleRetryLocations() {
    if (!track || baseWaypoints.length === 0 || locationLoading) return
    const token = computeTokenRef.current
    loadLocations(baseWaypoints, () => computeTokenRef.current === token)
  }

  // ── Core compute helper (accepts explicit config + segmentPaces overrides) ──
  async function doCompute(
    computeConfig: typeof paceConfig,
    computeSegPaces: SegmentPace[] | null,
  ) {
    if (!track) return
    const token = ++computeTokenRef.current
    setErrorMsg(null)
    setLocationProgress({ done: 0, total: 0 })

    // ── Synchronous part: the route, ETAs and cut-offs. Fast, no network. ──
    let wps
    try {
      wps = computeWaypoints(track, startTime, computeConfig, sampling, computeSegPaces ?? undefined, pauses)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('error')
      return
    }
    setBaseWaypoints(wps)
    setWeatherArr(wps.map(() => null))
    setLocationArr(wps.map(() => null))
    setPollenArr(wps.map(() => null))
    // Terrain stays opt-in (heavy Overpass call); user triggers it from the map.
    setTerrainPoints([])
    setTerrainStatus('idle')

    // Route is ready — unlock the UI now. Weather/location/pollen enrich in the
    // background and fill their columns/markers as they resolve. A `token` guard
    // drops results from a superseded compute (e.g. user recalculated meanwhile).
    setStatus('done')

    const fresh = () => computeTokenRef.current === token

    // Weather (background)
    setWeatherLoading(true)
    fetchWeatherForWaypoints(wps)
      .then((results) => { if (fresh()) { setWeatherArr(results.map((r) => r.weather)); setWeatherFetchedAt(new Date()) } })
      .catch(() => { /* weather failure is non-fatal; cells stay empty */ })
      .finally(() => { if (fresh()) setWeatherLoading(false) })

    // Localidades / poblaciones (background, with per-waypoint progress)
    loadLocations(wps, fresh)

    // Pollen (background) — only for European routes (CAMS coverage).
    if (isInEurope(wps)) {
      setPollenLoading(true)
      fetchPollenForWaypoints(wps)
        .then((results) => { if (fresh()) setPollenArr(results.map((r) => r.pollen)) })
        .catch(() => { /* silently ignore — route stays with null pollen */ })
        .finally(() => { if (fresh()) setPollenLoading(false) })
    }
  }

  // Plan mode: full compute with configured start time + sampling.
  // Uses the effective config (so a buddy observation, if active, drives ETAs).
  async function handleCompute() {
    reset()
    await doCompute(effectivePaceConfig, effectiveSegmentPaces)
  }

  // ── Strategy-panel apply handlers ─────────────────────────────────────────

  /** Button A: apply the tightest required pace as a single global fixed pace. */
  async function handleApplySinglePace(pace: number) {
    const newConfig: typeof paceConfig = { ...paceConfig, mode: 'fixed', paceMinPerKm: pace }
    setPaceConfig(newConfig)
    savePaceConfig(newConfig)
    setSegmentPaces(null)
    setBuddyObs([])   // strategy paces override any buddy observation
    reset()
    await doCompute(newConfig, null)
  }

  /** Button B: apply per-segment variable paces; waypoints recalculated accordingly. */
  async function handleApplyVariablePaces(paces: SegmentPace[]) {
    setSegmentPaces(paces)
    setBuddyObs([])   // strategy paces override any buddy observation
    reset()
    await doCompute(paceConfig, paces)
  }

  // ── Buddy-tracker handlers ────────────────────────────────────────────────

  /** Add a new observation to the list; rebuilds the plan with observed paces. */
  async function handleAddBuddyObs(obs: BuddyObservation) {
    if (!track) return
    const nextList = [...buddyObs, obs].sort((a, b) => a.km - b.km)
    setBuddyObs(nextList)
    setSegmentPaces(null)   // variable paces don't make sense alongside observations
    const derived = buildBuddyDerived(nextList, startTime, track.totalDistanceKm)
    if (!derived) return
    const newConfig: PaceConfig = {
      ...paceConfig, mode: 'fixed',
      paceMinPerKm: derived.metrics.projectionPaceMinPerKm,
    }
    reset()
    await doCompute(newConfig, derived.segmentPaces)
  }

  /** Remove a single observation by km. Recomputes if any obs remain. */
  async function handleRemoveBuddyObs(km: number) {
    if (!track) return
    const nextList = buddyObs.filter((o) => Math.abs(o.km - km) >= 0.05)
    setBuddyObs(nextList)
    if (nextList.length === 0) {
      // Last one removed → revert to planned config
      reset()
      await doCompute(paceConfig, segmentPaces)
      return
    }
    const derived = buildBuddyDerived(nextList, startTime, track.totalDistanceKm)
    if (!derived) return
    const newConfig: PaceConfig = {
      ...paceConfig, mode: 'fixed',
      paceMinPerKm: derived.metrics.projectionPaceMinPerKm,
    }
    reset()
    await doCompute(newConfig, derived.segmentPaces)
  }

  /**
   * Replace ALL buddy observations at once (used by the paste/import feature).
   * Behaves like clearing and then re-adding each observation in one step so
   * only a single recompute is triggered.
   */
  async function handleSetAllBuddyObs(obs: BuddyObservation[]) {
    if (!track) return
    if (obs.length === 0) {
      await handleClearBuddy()
      return
    }
    const sorted = [...obs].sort((a, b) => a.km - b.km)
    setBuddyObs(sorted)
    setSegmentPaces(null)
    const derived = buildBuddyDerived(sorted, startTime, track.totalDistanceKm)
    if (!derived) return
    const newConfig: PaceConfig = {
      ...paceConfig, mode: 'fixed',
      paceMinPerKm: derived.metrics.projectionPaceMinPerKm,
    }
    reset()
    await doCompute(newConfig, derived.segmentPaces)
  }

  /**
   * Cancel an in-progress "Modificar" session: restore all param values to
   * what they were when the user clicked "Modificar", then collapse without
   * recomputing. The previous results stay visible — they were never cleared
   * because onChange no longer calls reset() while the form is expanded.
   */
  function handleCancelModify() {
    if (paramsSnapshot) {
      setStartTime(paramsSnapshot.startTime)
      setPaceConfig(paramsSnapshot.paceConfig)
      setSampling(paramsSnapshot.sampling)
      setSegmentPaces(paramsSnapshot.segmentPaces)
      setBuddyObs(paramsSnapshot.buddyObs)
    }
    setParamsSnapshot(null)
    setParamsDirty(false)
    setParamsExpanded(false)
  }

  /** Clear ALL buddy observations; revert to the user's planned pace config. */
  async function handleClearBuddy() {
    setBuddyObs([])
    if (track && (status === 'done' || status === 'error')) {
      reset()
      await doCompute(paceConfig, segmentPaces)
    }
  }

  // Live shortcut: use now() + auto sampling, skip date/time and waypoint steps,
  // switch directly to live mode after fetching weather
  async function handleComputeLive() {
    if (!track) return
    setStatus('live-loading')
    setErrorMsg(null)
    liveWeatherFetchedRef.current = true // weather will be current; no need to re-fetch on GPS fix

    try {
      const now = new Date()
      setStartTime(now)  // record actual departure time as "now"
      const wps = computeWaypoints(track, now, paceConfig, DEFAULT_SAMPLING, segmentPaces ?? undefined, pauses)
      setBaseWaypoints(wps)
      setLocationArr(wps.map(() => null))
      setWeatherArr(wps.map(() => null))

      const results = await fetchWeatherForWaypoints(wps)
      setWeatherArr(results.map((r) => r.weather))
      setWeatherFetchedAt(new Date())
      setStatus('done')
      setAppMode('live')  // enter live mode right away
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('idle')
    }
  }

  // ── Refresh weather manually ───────────────────────────────────────────────
  async function handleRefreshWeather() {
    if (refreshingWeather) return
    setRefreshingWeather(true)
    setReturnBanner(false)
    try {
      if (appMode === 'live') {
        // Only refresh pending waypoints
        const { liveWaypoints: wps, liveOriginalIndices: idxs } = liveDataRef.current
        if (wps.length === 0) return
        const results = await fetchWeatherForWaypoints(wps)
        setWeatherArr((prev) => {
          const next = [...prev]
          results.forEach((r, i) => { next[idxs[i]] = r.weather })
          return next
        })
      } else {
        // Plan mode: refresh all
        const results = await fetchWeatherForWaypoints(baseWaypoints)
        setWeatherArr(results.map((r) => r.weather))
      }
      setWeatherFetchedAt(new Date())
    } catch (err) {
      console.error('Weather refresh failed:', err)
    } finally {
      setRefreshingWeather(false)
    }
  }

  /** True while any background enrichment (weather/poblaciones/pollen) is in flight. */
  const isEnriching = weatherLoading || locationLoading || pollenLoading
  const isLiveLoading = status === 'live-loading'
  const isDone = status === 'done' && baseWaypoints.length > 0

  /**
   * Set or clear the planned pause at a named POI (lat/lon-keyed match).
   * Lives on track.namedWaypoints[i].pauseMin and is also persisted to the
   * custom-POIs localStorage cache. We recompute baseWaypoints inline so
   * the visible ETAs / strategy refresh immediately — no network calls,
   * weather/location arrays keep their order (km-based sampling unchanged).
   */
  const setPause = useCallback((lat: number, lon: number, minutes: number | null) => {
    if (!track) return
    const key = wptKey(lat, lon)
    const nextWaypoints = track.namedWaypoints.map((w) => {
      if (wptKey(w.lat, w.lon) !== key) return w
      const m = minutes != null && minutes > 0 ? minutes : undefined
      if (m === w.pauseMin) return w
      return { ...w, pauseMin: m }
    })
    const nextTrack: GpxTrack = { ...track, namedWaypoints: nextWaypoints }
    setTrack(nextTrack)
    saveCustomPois(track.name, nextWaypoints.filter((w) => w.custom))
    setTrackDirty(true)

    if (isDone && appMode === 'plan' && baseWaypoints.length > 0) {
      const nextPauses: PausePoint[] = nextWaypoints
        .filter((w) => w.pauseMin != null && w.pauseMin > 0)
        .map((w) => ({ km: w.distanceKm, minutes: w.pauseMin! }))
      const wps = computeWaypoints(
        nextTrack, startTime, effectivePaceConfig, sampling,
        effectiveSegmentPaces ?? undefined, nextPauses,
      )
      setBaseWaypoints(wps)
    }
  }, [track, isDone, appMode, startTime, effectivePaceConfig, sampling, effectiveSegmentPaces, baseWaypoints.length])

  /**
   * Session-scoped "dirty" flag — true when the user has made a change in the
   * CURRENT session that hasn't been written to a GPX file yet (POI added,
   * removed, cut-off edited). Resets when:
   *   - a track is freshly loaded (handleTrack)
   *   - the user downloads the GPX (handleDownloadGpx)
   *
   * Drives the "cambios sin guardar" indicator in the POIs panel.
   *
   * Intentional design: localStorage divergence from the original file is NOT
   * "dirty" — that's just normal app usage (cut-offs you edited last week
   * shouldn't keep nagging forever). Only fresh edits in *this* session do.
   */
  const trackModified = trackDirty

  // ── Cut-off pace strategy ──────────────────────────────────────────────────
  // Recomputes when cut-offs change, start time changes, or pace config changes.
  const cutoffStrategy = useMemo(() => {
    if (!track || !isDone) return null
    const withCutoffs = enrichedNamedWaypoints.filter((w) => w.cutoffTime != null)
    if (withCutoffs.length === 0) return null
    // When the buddy is being tracked, re-anchor the strategy at their projected
    // current position so segments / required paces describe what's left to do.
    if (buddyDerived && buddyKmNow !== null) {
      return computeCutoffStrategy(
        track, withCutoffs, new Date(buddyTick),
        effectivePaceConfig, strategyMargin,
        buddyKmNow, 'Compañero',
        segmentTargets,
        pauses,
      )
    }
    return computeCutoffStrategy(
      track, withCutoffs, startTime, effectivePaceConfig, strategyMargin,
      0, 'Salida', segmentTargets,
      pauses,
    )
  }, [track, isDone, enrichedNamedWaypoints, startTime, effectivePaceConfig, strategyMargin, segmentTargets, pauses, buddyDerived, buddyKmNow, buddyTick])

  // ── Buddy: next upcoming cut-off ahead of the projected position ──────────
  // Reuses estimatedTime from enrichedNamedWaypoints (already recomputed with
  // the buddy-derived segment paces). The "affordable pace" is recomputed each
  // tick (via buddyTick) so it stays live as time passes.
  const buddyNextCutoff = useMemo<NextCutoffInfo | null>(() => {
    if (!buddyDerived) return null
    const refKm = buddyKmNow ?? buddyDerived.metrics.lastObs.km
    const upcoming = enrichedNamedWaypoints
      .filter((w) => w.cutoffTime != null && w.distanceKm > refKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
    if (upcoming.length === 0) return null
    const cp = upcoming[0]
    if (!cp.cutoffTime || !cp.estimatedTime) return null

    // Affordable pace from projected "now" position to (cutoff − margin)
    const remainingKm  = cp.distanceKm - refKm
    const targetTimeMs = cp.cutoffTime.getTime() - strategyMargin * 60_000
    const remainingMin = (targetTimeMs - buddyTick) / 60_000
    const physicalMinPace = 60 / ACTIVITY_MAX_SPEED_KMH[paceConfig.activity]
    let affordablePaceMinPerKm: number | null = null
    if (remainingKm > 0 && remainingMin > 0) {
      const candidate = remainingMin / remainingKm
      if (candidate >= physicalMinPace) affordablePaceMinPerKm = candidate
    }

    return {
      name: cp.name,
      desc: cp.desc,
      km: cp.distanceKm,
      cutoff: cp.cutoffTime,
      eta: cp.estimatedTime,
      marginMin: (cp.cutoffTime.getTime() - cp.estimatedTime.getTime()) / 60_000,
      affordablePaceMinPerKm,
      currentPaceMinPerKm: buddyDerived.metrics.projectionPaceMinPerKm,
      strategyMarginMin: strategyMargin,
    }
  }, [buddyDerived, buddyKmNow, enrichedNamedWaypoints, buddyTick, strategyMargin, paceConfig.activity])

  // ── Visibility change: show banner after ≥ 30 min in background ───────────
  useEffect(() => {
    if (!isDone) return
    let hiddenAt: number | null = null
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        const awayMs = Date.now() - hiddenAt
        hiddenAt = null
        if (awayMs >= 30 * 60_000) setReturnBanner(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [isDone])

  async function handleExportPdf() {
    if (!track || !isDone) return
    setPdfLoading(true)
    try {
      const [{ pdf }, { RoutePdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./components/RoutePdf'),
      ])
      const doc = createElement(RoutePdfDocument, {
        track,
        waypoints: enrichedWaypoints,
        namedWaypoints: enrichedNamedWaypoints,
        startTime,
        mapMode,
        daylight,
        daylightAnchor,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(track.name || 'ruta').replace(/[^a-z0-9]/gi, '_')}-${startTime.toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('Error al generar el PDF: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPdfLoading(false)
    }
  }

  const liveEta = liveWaypoints.length > 0
    ? liveWaypoints[liveWaypoints.length - 1].estimatedTime
    : null
  const liveRemainingKm = track
    ? Math.max(0, track.totalDistanceKm - livePos.trackKm)
    : 0

  // Pace delta: actual elapsed since startTime vs expected from km 0 to current km.
  // startTime = real departure time — this works even if app was opened mid-route.
  const paceDelta = useMemo<number | null>(() => {
    if (appMode !== 'live' || !livePos.coords || !track) return null
    if (livePos.trackKm < 0.2) return null
    if (startTime.getTime() >= effectiveNow) return null  // startTime is in the future
    const actualMin = (effectiveNow - startTime.getTime()) / 60_000
    const expectedMin = expectedMinutesForSegment(track, 0, livePos.trackKm, paceConfig)
    return actualMin - expectedMin  // positive = slow, negative = fast
  }, [appMode, effectiveNow, livePos.coords, livePos.trackKm, startTime, track, paceConfig])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">🌧️</span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SiLoSeNoSalgo</h1>
            <p className="text-slate-500 text-xs">Previsión meteorológica a lo largo de tu ruta GPX</p>
          </div>
          {isDone && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowShareCard(true)}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-sky-400 hover:border-sky-700 transition-colors text-xs flex items-center gap-1.5"
              >
                📤 <span className="hidden sm:inline">Compartir</span>
              </button>
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                <button
                  onClick={() => { setSimKm(null); setSimCoords(null); setSimPicking(false); setAppMode('plan') }}
                  className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'plan' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  🗺️ <span className="hidden sm:inline">Planificar</span>
                </button>
                <button
                  onClick={() => { setSimKm(null); setSimCoords(null); setSimPicking(false); setAppMode('live') }}
                  className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'live' && simKm === null ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  📍 <span className="hidden sm:inline">En vivo</span>
                </button>
                {IS_DEV && isDone && (
                  <button
                    onClick={() => {
                      if (simKm !== null) { setSimKm(null); setSimCoords(null); setSimPicking(false); setAppMode('plan') }
                      else {
                        const km = Math.round((track?.totalDistanceKm ?? 100) * 0.3 * 10) / 10
                        setAppMode('live')
                        setSimKm(km)
                        // Initialise simTime from the planned ETA at that km
                        const wps = baseWaypoints
                        if (wps.length >= 2) {
                          let prevIdx = 0
                          for (let i = 1; i < wps.length; i++) {
                            if (wps[i].distanceKm >= km) break
                            prevIdx = i
                          }
                          const ni = Math.min(prevIdx + 1, wps.length - 1)
                          const prev = wps[prevIdx], next = wps[ni]
                          const span = next.distanceKm - prev.distanceKm
                          const t = span > 0 ? Math.max(0, Math.min(1, (km - prev.distanceKm) / span)) : 0
                          setSimTime(new Date(prev.estimatedTime.getTime() + t * (next.estimatedTime.getTime() - prev.estimatedTime.getTime())))
                        }
                      }
                    }}
                    className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${simKm !== null ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                    title="Simulación GPS (solo dev)"
                  >
                    🧪 <span className="hidden sm:inline">Sim</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Sim control bar (dev only) ─────────────────────────────────────── */}
      {IS_DEV && simKm !== null && track && (() => {
        // Derive pace from km + time for the info badge
        const elapsedMin = (simTime.getTime() - startTime.getTime()) / 60_000
        const derivedPace = simKm > 0 && elapsedMin > 0 ? elapsedMin / simKm : null
        // Format simTime as HH:MM for the time input
        const simTimeStr = simTime.toTimeString().slice(0, 5)
        return (
          <div className="bg-violet-950/80 border-b border-violet-700/50 px-4 py-2 flex flex-wrap items-center gap-4 text-xs font-mono">
            <span className="text-violet-300 font-semibold">🧪 GPS Sim</span>
            <label className="flex items-center gap-2 flex-1 min-w-48">
              <span className="text-violet-400 whitespace-nowrap" title="Tu posición real (GPS). Independiente del reloj.">
                📍 Km {simKm.toFixed(1)} / {track.totalDistanceKm.toFixed(1)}
              </span>
              <input
                type="range" min={0} max={track.totalDistanceKm} step={0.1}
                value={simKm}
                onChange={(e) => {
                  // Position knob ONLY. The clock (simTime) stays independent so
                  // moving ahead of / behind the plan reveals the delta vs the
                  // initial forecast — instead of snapping you back "on plan".
                  setSimCoords(null)  // back to km-driven mode
                  setSimPicking(false)
                  setSimKm(parseFloat(e.target.value))
                }}
                className="flex-1 accent-violet-500"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-violet-400" title="Reloj actual. Avánzalo para simular retraso (Prevista se adelanta) o atrásalo para adelanto.">🕒 Hora (reloj)</span>
              <input
                type="time"
                value={simTimeStr}
                onChange={(e) => {
                  if (!e.target.value) return
                  const [h, m] = e.target.value.split(':').map(Number)
                  const d = new Date(simTime)
                  d.setHours(h, m, 0, 0)
                  setSimTime(d)
                }}
                className="bg-violet-900 border border-violet-600 rounded px-1.5 py-0.5 text-violet-100 focus:outline-none focus:border-violet-400"
              />
            </label>
            {derivedPace !== null && (
              <span className="text-violet-500">
                → {derivedPace.toFixed(1)} min/km
              </span>
            )}
            <label className="flex items-center gap-2">
              <span className="text-violet-400 whitespace-nowrap">Desvío {simOffsetKm.toFixed(1)} km</span>
              <input
                type="range" min={0} max={2} step={0.1}
                value={simOffsetKm}
                onChange={(e) => { setSimCoords(null); setSimPicking(false); setSimOffsetKm(parseFloat(e.target.value)) }}
                className="accent-violet-500 w-24"
                title="Empuja el fix fuera del trazado (prueba off-route)"
              />
            </label>
            <button
              onClick={() => setSimPicking((p) => !p)}
              className={`px-2 py-0.5 rounded border transition-colors ${
                simPicking
                  ? 'bg-amber-500 border-amber-400 text-amber-950 font-semibold'
                  : 'bg-violet-900 border-violet-600 text-violet-200 hover:border-violet-400'
              }`}
              title="Haz clic en el mapa para fijar el GPS en cualquier punto"
            >
              📍 {simPicking ? 'Haz clic en el mapa…' : 'Fijar en mapa'}
            </button>
            {simCoords && (
              <span className="text-amber-400">
                pos. libre · {livePos.distanceFromTrackKm.toFixed(2)} km al trazado
              </span>
            )}
          </div>
        )
      })()}

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Paso 1: GPX ── */}
        <section className="space-y-3">
          {(!track || paramsExpanded) && (
            <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">1 · Carga tu ruta</h2>
          )}
          {track ? (
            <>
            <div className="bg-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-slate-100">{track.name}</p>
                <p className="text-slate-400 text-sm">
                  {track.totalDistanceKm.toFixed(1)} km
                  {' · '}
                  <span className="text-orange-400">+{Math.round(track.elevGainM)} m</span>
                  {' / '}
                  <span className="text-blue-400">-{Math.round(track.elevLossM)} m</span>
                  {' · '}
                  {track.points.length} puntos
                  {hasGpxTimes && <span className="ml-2 text-sky-400">· con tiempos GPS</span>}
                  {track.namedWaypoints.length > 0 && (
                    <span className="ml-2 text-amber-500">· 🚩 {track.namedWaypoints.length} POI</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => { setTrack(null); setAppMode('plan'); setSimKm(null); reset() }}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors shrink-0"
              >
                Cambiar
              </button>
            </div>
            {hasGpxTimes && gpxValidity && (
              <GpxTimesStats
                validity={gpxValidity}
                totalDistanceKm={track.totalDistanceKm}
                activity={paceConfig.activity}
              />
            )}
            {subsampleNotice && (
              <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-amber-900/25 border border-amber-700/50 text-amber-300 text-xs leading-relaxed">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span className="flex-1">
                  Sesión recuperada a <strong>menor resolución</strong>:{' '}
                  {subsampleNotice.original.toLocaleString('es-ES')} → {subsampleNotice.current.toLocaleString('es-ES')} puntos
                  {' '}(no cabía entera en el almacenamiento). Las estadísticas de tiempos son exactas; para máxima
                  precisión del trazado, vuelve a cargar el GPX original.
                </span>
                <button
                  onClick={() => setSubsampleNotice(null)}
                  className="text-amber-500 hover:text-amber-300 transition-colors text-base leading-none px-1 shrink-0"
                  aria-label="Cerrar"
                >×</button>
              </div>
            )}
            </>
          ) : (
            <>
              {savedSession && (
                <div className="bg-sky-950/40 border border-sky-700/40 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sky-300 text-[10px] uppercase tracking-widest font-semibold mb-1">
                      Sesión anterior detectada
                    </p>
                    <p className="font-semibold text-slate-100 truncate">{savedSession.track.name}</p>
                    <p className="text-slate-400 text-sm">
                      {savedSession.track.totalDistanceKm.toFixed(1)} km
                      {' · '}
                      <span className="text-orange-400">+{Math.round(savedSession.track.elevGainM)} m</span>
                      {' · salida '}
                      {new Date(savedSession.startTimeISO).toLocaleString('es-ES', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                      {' · guardado '}
                      {new Date(savedSession.savedAt).toLocaleString('es-ES', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => {
                        const s = savedSession
                        handleTrack(s.track)
                        setStartTime(new Date(s.startTimeISO))
                        setPaceConfig(s.paceConfig)
                        setSampling(s.sampling)
                        // Restore the full-res stats + original resolution captured
                        // at save time (handleTrack reset them to the subsampled track).
                        setRestoredGpxStats(s.gpxStats ?? null)
                        const orig = s.originalPointCount ?? s.track.points.length
                        setTrackOriginalPoints(orig)
                        if (s.subsampled) setSubsampleNotice({ original: orig, current: s.track.points.length })
                      }}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Recuperar
                    </button>
                    <button
                      onClick={() => { clearSession(); setSavedSession(null) }}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              )}
              <GpxUploader onTrackLoaded={handleTrack} />
            </>
          )}
        </section>

        {/* ── Plan mode sections ── */}
        {appMode === 'plan' && (
          <>
            {/* ── POIs panel (always available once a track is loaded) ── */}
            {track && (
              <PoisPanel
                track={track}
                startTime={startTime}
                cutoffTimes={cutoffTimes}
                onAddPois={handleAddPois}
                onRemovePoi={handleRemovePoi}
                onClearCustom={handleClearCustomPois}
                onDownload={handleDownloadGpx}
                onDownloadFit={handleDownloadFit}
                modified={trackModified}
              />
            )}

            {/* ── Compact params bar (post-compute view) ── */}
            {track && !paramsExpanded && (
              <section className="space-y-3">
                <div className="bg-slate-800 rounded-xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm min-w-0">
                    <span className="text-slate-400">
                      📅 <span className="text-slate-200 font-medium">{formatStartDate(startTime)}</span>
                    </span>
                    <span className="text-slate-400">
                      🕘 <span className="text-slate-200 font-mono">{formatTime(startTime)}</span>
                    </span>
                    <span className="text-slate-400">
                      {ACTIVITY_LABEL[paceConfig.activity].emoji}{' '}
                      <span className="text-slate-200">{paceShortLabel(paceConfig)}</span>
                    </span>
                    <span className="text-slate-400">
                      📍 <span className="text-slate-200">{samplingShortLabel(sampling)}</span>
                    </span>
                    {segmentPaces && (
                      <span className="text-[10px] bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                        🔀 ritmo variable
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setParamsSnapshot({ startTime, paceConfig, sampling, segmentPaces, buddyObs })
                      setParamsExpanded(true)
                    }}
                    className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-1.5 px-3 rounded-lg border border-slate-600 transition-colors shrink-0"
                  >
                    ✎ Modificar
                  </button>
                </div>
              </section>
            )}

            {/* ── Expanded params form (initial / "Modificar") ── */}
            {track && paramsExpanded && (
              <>
                <section className="space-y-3">
                  <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">2 · Fecha y hora de salida</h2>
                  <input
                    type="datetime-local"
                    value={toLocalInputValue(startTime)}
                    onChange={(e) => {
                      setStartTime(new Date(e.target.value))
                      setBuddyObs([])
                      if (hasComputedOnce) setParamsDirty(true)
                      // reset() is intentionally NOT called here so that previous
                      // results stay visible while editing. reset() runs inside
                      // handleCompute when the user explicitly asks to recompute.
                    }}
                    className="bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 font-mono focus:outline-none focus:border-sky-400 text-slate-100"
                  />
                </section>

                <section className="space-y-3">
                  <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">3 · Ritmo</h2>
                  <PaceConfigPanel
                    config={paceConfig}
                    hasGpxTimes={hasGpxTimes}
                    gpxValidity={gpxValidity}
                    totalDistanceKm={track.totalDistanceKm}
                    onChange={(c) => {
                      setPaceConfig(c)
                      setSegmentPaces(null)
                      setBuddyObs([])
                      if (hasComputedOnce) setParamsDirty(true)
                    }}
                  />
                  {/* Variable-pace active indicator — shown when strategy panel has been applied */}
                  {segmentPaces && (
                    <div className="flex items-center justify-between gap-3 text-xs bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2">
                      <span className="text-emerald-300 flex items-center gap-1.5">
                        <span>🔀</span>
                        <span>Ritmo variable por tramos activo</span>
                      </span>
                      <button
                        onClick={() => { setSegmentPaces(null); if (hasComputedOnce) setParamsDirty(true) }}
                        className="text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 transition-colors shrink-0"
                      >
                        Volver a ritmo único
                      </button>
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">4 · Detalle de waypoints</h2>
                  <SamplingPanel
                    config={sampling}
                    totalKm={track.totalDistanceKm}
                    onChange={(c) => {
                      setSampling(c)
                      if (hasComputedOnce) setParamsDirty(true)
                    }}
                  />
                </section>

                {/* Pending-changes chip: shown when params have changed since last compute */}
                {paramsDirty && hasComputedOnce && (
                  <div className="flex items-center gap-2 text-xs bg-amber-900/30 border border-amber-700/50 text-amber-300 px-3 py-2 rounded-lg">
                    <span>⏳</span>
                    <span>Cambios pendientes — la previsión visible es del cálculo anterior.</span>
                  </div>
                )}

                <div className="space-y-3">
                  {/* Primary: plan mode */}
                  <button
                    onClick={handleCompute}
                    disabled={isLiveLoading}
                    className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors text-base flex items-center justify-center gap-2"
                  >
                    {hasComputedOnce ? 'Recalcular previsión →' : 'Calcular y obtener previsión →'}
                  </button>

                  {/* Cancel button: only shown when there is a previous compute to return to */}
                  {hasComputedOnce && (
                    <button
                      onClick={handleCancelModify}
                      disabled={isLiveLoading}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-slate-400 hover:text-slate-200 font-medium py-2.5 rounded-xl transition-colors text-sm"
                    >
                      Cancelar — volver sin recalcular
                    </button>
                  )}

                  {/* Secondary: live shortcut */}
                  <button
                    onClick={handleComputeLive}
                    disabled={isLiveLoading}
                    className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-600 border border-slate-600 hover:border-sky-700 text-slate-300 font-medium py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    {isLiveLoading ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />
                        Preparando modo en vivo…
                      </>
                    ) : (
                      <>📍 Ya estoy en ruta — calcular ahora y abrir modo en vivo</>
                    )}
                  </button>
                </div>
              </>
            )}

            {errorMsg && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl px-5 py-4 text-red-300 text-sm">
                <strong>Error:</strong> {errorMsg}
              </div>
            )}

            {locationWarning && (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-3 text-amber-400 text-sm flex items-center gap-2 flex-wrap">
                <span>⚠️</span>
                <span className="flex-1 min-w-0">Población/comarca no disponible ({locationWarning}). La previsión meteorológica sigue activa.</span>
                <button
                  type="button"
                  onClick={handleRetryLocations}
                  disabled={locationLoading}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-600/60 bg-amber-800/30 text-amber-200 hover:bg-amber-700/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {locationLoading ? 'Reintentando…' : '↻ Reintentar'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Return-from-background banner ── */}
        {returnBanner && isDone && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm">
            <span>⏰</span>
            <span className="flex-1">Has estado fuera un rato — la previsión puede estar desactualizada.</span>
            <button
              onClick={handleRefreshWeather}
              disabled={refreshingWeather}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-medium transition-colors"
            >
              {refreshingWeather
                ? <><span className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full inline-block" /> Actualizando…</>
                : <>↻ Actualizar</>}
            </button>
            <button
              onClick={() => setReturnBanner(false)}
              className="text-amber-500 hover:text-amber-300 transition-colors text-lg leading-none px-1"
              aria-label="Cerrar"
            >×</button>
          </div>
        )}

        {/* ── Live mode: GPS status bar ── */}
        {appMode === 'live' && (
          <div className={`rounded-xl text-sm overflow-hidden ${
            livePos.error
              ? 'bg-red-900/30 border border-red-700/50 text-red-400'
              : livePos.isLocating
              ? 'bg-slate-800 border border-slate-700 text-slate-400'
              : 'bg-sky-900/20 border border-sky-800/40 text-sky-300'
          }`}>
            {/* Row 1: GPS position info */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-3">
              {livePos.error ? (
                <><span>⚠️</span><span>{livePos.error}</span></>
              ) : livePos.isLocating ? (
                <>
                  <span className="animate-spin w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full inline-block flex-shrink-0" />
                  <span>Localizando posición GPS…</span>
                </>
              ) : isOffTrack ? (
                <>
                  <span className="text-amber-400 flex-shrink-0">📡</span>
                  <span className="text-amber-300 font-medium">
                    GPS lejos del recorrido
                  </span>
                  <span className="text-amber-500 text-xs font-mono">
                    ({livePos.distanceFromTrackKm.toFixed(1)} km del trayecto)
                  </span>
                  <span className="text-amber-300/80 text-xs font-mono">
                    · punto más cercano: km{' '}
                    <span className="font-semibold text-amber-200">{livePos.trackKm.toFixed(1)}</span>
                    {' · '}
                    quedan <span className="font-semibold text-amber-200">{liveRemainingKm.toFixed(1)} km</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 bg-sky-400 rounded-full animate-pulse flex-shrink-0" />
                  <span className="font-mono">
                    Km <span className="font-semibold text-sky-200">{livePos.trackKm.toFixed(1)}</span>
                    {' · '}
                    Quedan <span className="font-semibold text-sky-200">{liveRemainingKm.toFixed(1)} km</span>
                  </span>
                  {liveEta && (
                    <span className="text-slate-400 text-xs">
                      Llegada estimada:{' '}
                      <span className="text-sky-300 font-semibold">{formatTime(liveEta)}</span>
                    </span>
                  )}
                  {paceDelta !== null && (
                    <span
                      className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-md ${
                        Math.abs(paceDelta) < 1
                          ? 'bg-slate-700/80 text-slate-400'
                          : paceDelta > 0
                          ? 'bg-red-900/50 text-red-300'
                          : 'bg-green-900/50 text-green-300'
                      }`}
                      title={paceDelta > 0 ? 'Vas más lento de lo previsto' : paceDelta < 0 ? 'Vas más rápido de lo previsto' : 'Vas según lo previsto'}
                    >
                      {formatDelta(paceDelta)}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Row 2: startTime editor + real pace + freshness chip */}
            {!livePos.error && (
              <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-1 border-t border-sky-900/40">
                {/* Inline start-time editor */}
                {liveEditingStart ? (
                  <input
                    type="time"
                    defaultValue={`${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`}
                    autoFocus
                    onBlur={(e) => {
                      const [h, m] = e.target.value.split(':').map(Number)
                      if (!isNaN(h) && !isNaN(m)) {
                        const d = new Date(startTime)
                        d.setHours(h, m, 0, 0)
                        setStartTime(d)
                      }
                      setLiveEditingStart(false)
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    className="bg-slate-800 border border-sky-500 rounded px-2 py-0.5 text-xs font-mono text-sky-200 w-24 focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => setLiveEditingStart(true)}
                    className="text-xs text-slate-400 hover:text-sky-300 transition-colors flex items-center gap-1"
                    title="Editar hora de salida real"
                  >
                    🕘 <span className="font-mono">{formatTime(startTime)}</span>
                    <span className="text-slate-600 text-[10px]">✎</span>
                  </button>
                )}
                {/* Hint when startTime looks wrong */}
                {startTime.getTime() > Date.now() && (
                  <span className="text-xs text-amber-400">← ajusta si ya saliste</span>
                )}
                {/* Real average pace — hidden when GPS is off-route (pace would be meaningless) */}
                {!isOffTrack && realPaceMinPerKm !== null && (
                  <span className="text-xs text-slate-400">
                    ⚡ <span className="font-mono text-sky-300">{formatPace(realPaceMinPerKm, paceConfig.activity)}</span>
                  </span>
                )}
                {/* Weather freshness */}
                <WeatherFreshnessChip
                  fetchedAt={weatherFetchedAt}
                  onRefresh={handleRefreshWeather}
                  refreshing={refreshingWeather}
                  etaDriftMin={weatherEtaDriftMin}
                  className="ml-auto"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Background enrichment banner (non-blocking) ── */}
        {isDone && isEnriching && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
            <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full flex-shrink-0" />
            <span className="text-slate-300">Cargando datos en segundo plano — la ruta ya es usable.</span>
            {weatherLoading && <span>🌦️ previsión…</span>}
            {locationLoading && (
              <span>
                🏘️ poblaciones
                {locationProgress.total > 0 ? ` ${locationProgress.done}/${locationProgress.total}` : '…'}
              </span>
            )}
            {pollenLoading && <span>🌿 polen…</span>}
          </div>
        )}

        {/* ── Weather summary (plan mode only) ── */}
        {appMode === 'plan' && enrichedWaypoints.some((w) => w.weather) && (
          <>
            <WeatherSummary
              waypoints={enrichedWaypoints}
              range={deferredAnalyzeRange}
              onClearRange={() => setAnalyzeRange(null)}
              daylight={appMode === 'plan' ? daylight : null}
            />
            <WeatherFreshnessChip
              fetchedAt={weatherFetchedAt}
              onRefresh={handleRefreshWeather}
              refreshing={refreshingWeather}
              etaDriftMin={weatherEtaDriftMin}
            />
          </>
        )}

        {/* ── Map ── */}
        {track && baseWaypoints.length > 0 && (
          <RouteMap
            track={track}
            waypoints={enrichedWaypoints}
            namedWaypoints={enrichedNamedWaypoints}
            mapMode={mapMode}
            onMapModeChange={setMapMode}
            liveMode={appMode === 'live'}
            liveCoords={livePos.coords}
            liveProgress={livePos.progress}
            liveTrackKm={livePos.trackKm}
            followPosition={!simActive}
            isOffTrack={isOffTrack}
            onPickPosition={simPicking ? (lat, lon) => { setSimCoords({ lat, lon }); setSimPicking(false) } : null}
            expectedKm={expectedKm}
            paceConfig={paceConfig}
            analyzeRange={analyzeRange}
            onAnalyzeRangeChange={setAnalyzeRange}
            buddyKm={appMode === 'plan' ? buddyKmNow : null}
            buddyObservations={appMode === 'plan' ? buddyObs : []}
            pollenData={pollenArr.length > 0 ? pollenArr : undefined}
            pollenType={selectedPollenType}
            onPollenTypeChange={setSelectedPollenType}
            pointTerrains={terrainPoints.length > 0 ? terrainPoints : undefined}
            terrainStatus={terrainStatus}
            terrainErrorKind={terrainErrorKind}
            terrainRetryAfterSec={terrainRetryAfterSec}
            onFetchTerrain={() => fetchTerrain()}
            onTerrainRetry={retryTerrain}
            showRainRadar={showRainRadar}
            onShowRainRadarChange={setShowRainRadar}
            rainRadarAvailable={appMode === 'live' || (appMode === 'plan' && buddyObs.length > 0)}
            showWindAnimation={showWindAnimation}
            onShowWindAnimationChange={setShowWindAnimation}
            windAnimationAvailable={weatherArr.some((w) => w !== null)}
            daylightAnchor={daylightAnchor}
          />
        )}

        {/* ── Buddy tracker (plan mode, after computing) ── */}
        {appMode === 'plan' && isDone && track && (
          <BuddyTracker
            track={track}
            startTime={startTime}
            paceConfig={paceConfig}
            observations={buddyObs}
            derived={buddyDerived}
            onAdd={handleAddBuddyObs}
            onRemove={handleRemoveBuddyObs}
            onClear={handleClearBuddy}
            onSetAll={handleSetAllBuddyObs}
            buddyKmNow={buddyKmNow}
            buddyEta={buddyEta}
            nextCutoff={buddyNextCutoff}
          />
        )}

        {/* ── Cut-off summary (plan mode, when at least one cut-off is defined) ── */}
        {appMode === 'plan' && enrichedNamedWaypoints.some((w) => w.cutoffTime) && (
          <CutoffSummary
            namedWaypoints={
              buddyKmNow !== null
                ? enrichedNamedWaypoints.filter((w) => w.distanceKm > buddyKmNow - 0.05)
                : enrichedNamedWaypoints
            }
            startTime={startTime}
          />
        )}

        {/* ── Cut-off pace strategy (plan mode, after computing, when cut-offs exist) ── */}
        {appMode === 'plan' && cutoffStrategy && (
          <CutoffStrategy
            strategy={cutoffStrategy}
            paceConfig={paceConfig}
            onApplySinglePace={handleApplySinglePace}
            onApplyVariablePaces={handleApplyVariablePaces}
            variablePacesActive={segmentPaces !== null}
            marginMin={strategyMargin}
            onMarginChange={setStrategyMargin}
            segmentTargets={segmentTargets}
            onSegmentTargetChange={handleSegmentTargetChange}
          />
        )}

        {/* ── Charts (plan mode only) ── */}
        {appMode === 'plan' && enrichedWaypoints.some((w) => w.weather) && (
          <WeatherCharts
            waypoints={enrichedWaypoints}
            range={deferredAnalyzeRange}
            onClearRange={() => setAnalyzeRange(null)}
          />
        )}

        {/* ── Waypoints table ── */}
        {baseWaypoints.length > 0 && (
          <>
            {appMode === 'live' && livePos.coords && liveWaypoints.length < enrichedWaypoints.length && (
              <p className="text-slate-500 text-xs text-center">
                Mostrando {liveWaypoints.length} waypoints restantes
                · {enrichedWaypoints.length - liveWaypoints.length} ya pasados ocultos
              </p>
            )}
            {(() => {
              const baseList = appMode === 'live' ? liveWaypoints : enrichedWaypoints
              // Combined effective lower km bound: analyze range OR buddy position (plan mode)
              const buddyMinKm = (appMode === 'plan' && buddyKmNow !== null) ? buddyKmNow - 0.05 : null
              const rangeMinKm = (appMode === 'plan' && deferredAnalyzeRange) ? deferredAnalyzeRange.from : null
              const rangeMaxKm = (appMode === 'plan' && deferredAnalyzeRange) ? deferredAnalyzeRange.to   : null

              const passesPlanFilters = (km: number) => {
                if (buddyMinKm !== null && km < buddyMinKm) return false
                if (rangeMinKm !== null && km < rangeMinKm) return false
                if (rangeMaxKm !== null && km > rangeMaxKm) return false
                return true
              }
              const tableWaypoints = appMode === 'plan'
                ? baseList.filter((wp) => passesPlanFilters(wp.distanceKm))
                : baseList
              const livePaceMinPerKm = realPaceMinPerKm ?? paceConfig.paceMinPerKm
              const tableNamedWaypoints =
                appMode === 'live'
                  ? enrichedNamedWaypoints
                      .filter((wpt) => wpt.distanceKm >= livePos.trackKm - 0.05)
                      .map((wpt) => {
                        if (!livePos.coords) return wpt
                        // Planned pauses strictly between current km and this POI.
                        // Exclude the POI's own pause: liveEstimatedTime is arrival
                        // (before pause), matching how estimatedTime is computed.
                        const pausesAhead = pauses
                          .filter((p) => p.km > livePos.trackKm && p.km < wpt.distanceKm)
                          .reduce((sum, p) => sum + p.minutes, 0)
                        const liveEstimatedTime = new Date(
                          effectiveNow
                          + Math.max(0, wpt.distanceKm - livePos.trackKm) * livePaceMinPerKm * 60_000
                          + pausesAhead * 60_000,
                        )
                        return { ...wpt, liveEstimatedTime }
                      })
                  : enrichedNamedWaypoints.filter((wpt) => passesPlanFilters(wpt.distanceKm))

              const totalPlan = enrichedWaypoints.length
              const hiddenByBuddy = appMode === 'plan' && buddyKmNow !== null
                ? enrichedWaypoints.filter((wp) => wp.distanceKm < (buddyMinKm ?? 0)).length
                : 0
              return (
                <>
                  {appMode === 'plan' && buddyKmNow !== null && hiddenByBuddy > 0 && (
                    <p className="text-slate-500 text-xs text-center">
                      🧑 Mostrando {tableWaypoints.length} de {totalPlan} waypoints
                      {' · '}
                      {hiddenByBuddy} ya pasados según la posición del compañero (km {buddyKmNow.toFixed(1)})
                      {' · '}
                      <button
                        onClick={handleClearBuddy}
                        className="text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        ver todos
                      </button>
                    </p>
                  )}
                  {deferredAnalyzeRange != null && appMode === 'plan' && (
                    <p className="text-slate-500 text-xs text-center">
                      Mostrando {tableWaypoints.length} waypoints del tramo{' '}
                      {deferredAnalyzeRange.from.toFixed(1)}–{deferredAnalyzeRange.to.toFixed(1)} km
                      {' · '}
                      <button
                        onClick={() => setAnalyzeRange(null)}
                        className="text-sky-500 hover:text-sky-300 transition-colors"
                      >
                        ver todos
                      </button>
                    </p>
                  )}
                  <WaypointsTable
                    waypoints={tableWaypoints}
                    namedWaypoints={tableNamedWaypoints}
                    startTime={startTime}
                    onSetCutoff={appMode === 'plan' ? setCutoff : undefined}
                    onSetPause={appMode === 'plan' ? setPause : undefined}
                    daylightAnchor={daylightAnchor}
                  />
                </>
              )
            })()}
          </>
        )}

        {/* ── PDF export (plan mode only) ── */}
        {isDone && appMode === 'plan' && (
          <div className="flex justify-end pt-2 pb-8">
            <button
              onClick={handleExportPdf}
              disabled={pdfLoading}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-200 font-medium py-2.5 px-5 rounded-xl transition-colors text-sm border border-slate-600"
            >
              {pdfLoading ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />
                  Generando PDF…
                </>
              ) : (
                <><span>📄</span> Exportar PDF</>
              )}
            </button>
          </div>
        )}
      </main>

      {/* ── Share card overlay ── */}
      {showShareCard && track && (
        <ShareCard
          track={track}
          waypoints={enrichedWaypoints}
          startTime={startTime}
          paceConfig={paceConfig}
          onClose={() => setShowShareCard(false)}
        />
      )}
    </div>
  )
}

// ── WeatherFreshnessChip ────────────────────────────────────────────────────
const ETA_DRIFT_STALE_MIN = 15  // ≥ this many minutes of ETA shift → forecast considered out of step

function WeatherFreshnessChip({
  fetchedAt,
  onRefresh,
  refreshing,
  etaDriftMin = 0,
  className = '',
}: {
  fetchedAt: Date | null
  onRefresh: () => void
  refreshing: boolean
  /**
   * Max minutes the current ETAs have shifted from those at last fetch — used
   * to amplify staleness when pauses / pace changes have moved waypoints far
   * enough that the cached forecast no longer matches their actual time.
   */
  etaDriftMin?: number
  className?: string
}) {
  const freshness = useFreshnessLabel(fetchedAt)
  if (!freshness) return null

  const driftLarge = etaDriftMin >= ETA_DRIFT_STALE_MIN
  // ETA drift forces at least 'stale'; if the chip was already 'very-stale' we keep red.
  const effectiveSeverity =
    freshness.severity === 'very-stale' ? 'very-stale'
    : driftLarge                        ? 'stale'
    : freshness.severity

  const colorClass =
    effectiveSeverity === 'fresh' ? 'text-green-400' :
    effectiveSeverity === 'stale' ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className={`flex items-center gap-2 text-xs flex-wrap ${className}`}>
      <span className={colorClass}>⏱ Meteo: {freshness.label}</span>
      {driftLarge && (
        <span
          className="text-amber-400"
          title="Las pausas/recálculos han desplazado las horas estimadas respecto al momento en que se descargó la previsión. Actualiza para refrescar el forecast a las horas reales de paso."
        >
          · ETAs desplazadas {Math.round(etaDriftMin)} min
        </span>
      )}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition-colors text-slate-300 border border-slate-600"
        title="Actualizar previsión meteorológica"
      >
        {refreshing
          ? <span className="animate-spin w-3 h-3 border border-slate-400 border-t-transparent rounded-full inline-block" />
          : <span>↻</span>}
        <span>Actualizar</span>
      </button>
    </div>
  )
}

// ── WeatherSummary ──────────────────────────────────────────────────────────
// Renders the route's general-info row: weather metrics + optional daylight
// metrics + a thin daylight timeline strip below. When `daylight` is provided,
// the card grid expands to 6 columns and the timeline appears underneath.
const WeatherSummary = memo(function WeatherSummary({
  waypoints,
  range,
  onClearRange,
  daylight,
}: {
  waypoints: ReturnType<typeof useMemo>
  range?: { from: number; to: number } | null
  onClearRange?: () => void
  daylight?: DaylightSummary | null
}) {
  type Wp = { weather: { temperatureC: number; precipProbability: number } | null; distanceKm: number }
  const allWps = waypoints as Wp[]

  const wps = allWps.filter((w) => {
    if (!w.weather) return false
    if (!range) return true
    return w.distanceKm >= range.from && w.distanceKm <= range.to
  })

  if (wps.length === 0 && !daylight) return null

  const hasWeather = wps.length > 0
  const temps = hasWeather ? wps.map((w) => w.weather!.temperatureC) : []
  const probs = hasWeather ? wps.map((w) => w.weather!.precipProbability) : []
  const maxProb = hasWeather ? Math.max(...probs) : 0
  const minTemp = hasWeather ? Math.min(...temps) : 0
  const maxTemp = hasWeather ? Math.max(...temps) : 0
  const rainyCount = hasWeather ? probs.filter((p) => p >= 50).length : 0
  const risk = maxProb >= 70 ? 'alto' : maxProb >= 40 ? 'moderado' : 'bajo'
  const riskColor = maxProb >= 70 ? 'text-blue-400' : maxProb >= 40 ? 'text-yellow-400' : 'text-green-400'

  type Card = { label: string; value: string; color: string; title?: string }
  const weatherCards: Card[] = hasWeather ? [
    { label: 'Riesgo lluvia',     value: risk,                                                        color: riskColor },
    { label: 'Prob. máx.',        value: `${maxProb}%`,                                               color: maxProb >= 70 ? 'text-blue-400' : 'text-slate-200' },
    { label: 'Temperatura',       value: `${minTemp.toFixed(0)}–${maxTemp.toFixed(0)}°C`,             color: 'text-slate-200' },
    { label: 'Tramos con lluvia', value: `${rainyCount} / ${wps.length}`,                             color: rainyCount > 0 ? 'text-sky-400' : 'text-green-400' },
  ] : []

  const darkRanges = daylight ? daylight.intervals.filter((iv) => iv.band === 'night') : []
  const darkRangesText = darkRanges.length === 0
    ? 'sin tramos de noche cerrada'
    : darkRanges.map((iv) => `${fmtClock(iv.from)}–${fmtClock(iv.to)}`).join(' · ')

  const lightCards: Card[] = daylight ? [
    { label: 'Luz útil',     value: fmtHM(daylight.usefulMin),                                       color: 'text-amber-300' },
    { label: 'Requiere luz', value: daylight.darknessMin > 0 ? fmtHM(daylight.darknessMin) : 'no',   color: daylight.darknessMin > 0 ? 'text-indigo-300' : 'text-green-400', title: darkRanges.length > 0 ? `Tramos sin luz natural — ${darkRangesText}` : undefined },
  ] : []

  const allCards = [...weatherCards, ...lightCards]
  const totalCols = allCards.length
  const gridCls = totalCols === 6
    ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'
    : totalCols === 4
    ? 'grid grid-cols-2 sm:grid-cols-4 gap-3'
    : 'grid grid-cols-2 gap-3'

  return (
    <div className="space-y-2">
      {/* Range chip */}
      {range && (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-2 bg-sky-900/30 border border-sky-700/50 text-sky-400 px-3 py-1 rounded-full">
            🔍 Tramo {range.from.toFixed(1)}–{range.to.toFixed(1)} km
            {onClearRange && (
              <button
                onClick={onClearRange}
                className="text-sky-600 hover:text-sky-300 transition-colors ml-1 font-bold"
                title="Ver todo el recorrido"
              >
                ×
              </button>
            )}
          </span>
        </div>
      )}
      <div className={gridCls}>
        {allCards.map(({ label, value, color, title }) => (
          <div key={label} className="bg-slate-800 rounded-xl px-4 py-4 text-center" title={title}>
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Daylight timeline strip — slim, integrated below the card grid */}
      {daylight && <DaylightStrip summary={daylight} darkRangesText={darkRangesText} darkRangesCount={darkRanges.length} />}
    </div>
  )
})

// Pre-declare for use above (defined after WeatherSummary)
type DaylightStripProps = { summary: DaylightSummary; darkRangesText: string; darkRangesCount: number }
function DaylightStrip({ summary, darkRangesText, darkRangesCount }: DaylightStripProps) {
  const totalMin = (summary.to.getTime() - summary.from.getTime()) / 60_000
  if (totalMin <= 0) return null
  return (
    <div className="bg-slate-800 rounded-xl px-4 py-2 flex flex-col gap-1.5">
      <div className="flex h-2 rounded-sm overflow-hidden border border-slate-700/60">
        {summary.intervals.map((iv, i) => (
          <div
            key={i}
            className={BAND_CLS[iv.band]}
            style={{ width: `${(iv.minutes / totalMin) * 100}%` }}
            title={`${BAND_LABEL[iv.band]}: ${fmtClock(iv.from)} → ${fmtClock(iv.to)} (${fmtHM(iv.minutes)})`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono gap-3 flex-wrap">
        <span>{fmtClock(summary.from)}</span>
        <span className="flex items-center gap-2 normal-case">
          <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-sm ${BAND_CLS.day}`} />Día</span>
          <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-sm ${BAND_CLS.civil}`} />Crep.</span>
          <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-sm ${BAND_CLS.night}`} />Noche</span>
          {darkRangesCount > 0 && (
            <span className="text-indigo-400 normal-case hidden md:inline">· 🌙 {darkRangesText}</span>
          )}
        </span>
        <span>{fmtClock(summary.to)}</span>
      </div>
    </div>
  )
}

// ── Daylight helpers used by WeatherSummary / DaylightStrip ────────────────
const BAND_CLS: Record<DaylightBand, string> = {
  day:   'bg-amber-400',
  civil: 'bg-orange-700',
  night: 'bg-indigo-950',
}
const BAND_LABEL: Record<DaylightBand, string> = {
  day:   'Día',
  civil: 'Crepúsculo civil',
  night: 'Noche',
}

function fmtHM(min: number): string {
  const m = Math.round(min)
  if (m < 1) return '0m'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r.toString().padStart(2, '0')}m`
}

function fmtClock(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

