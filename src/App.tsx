import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { GpxUploader } from './components/GpxUploader'
import { PaceConfigPanel } from './components/PaceConfig'
import { SamplingPanel } from './components/SamplingPanel'
import { RouteMap } from './components/RouteMap'
import type { MapMode } from './components/RouteMap'
import { WeatherCharts } from './components/WeatherCharts'
import { WaypointsTable } from './components/WaypointsTable'
import type { GpxTrack, GpxNamedWaypoint } from './lib/gpx'
import { downloadGpx } from './lib/gpxSerialize'
import { PoisPanel, type MaterialisedPoi } from './components/PoisPanel'
import type { CutoffWallClock } from './lib/cutoffInference'
import { inferCutoffDatesFromWaypoints } from './lib/cutoffInference'
import type { PaceConfig, SamplingConfig, Waypoint } from './lib/timing'
import { ACTIVITY_LABEL, ACTIVITY_MAX_SPEED_KMH, computeWaypoints, DEFAULT_SAMPLING, expectedKmAtElapsed, expectedMinutesForSegment, formatDelta, formatPace, formatTime } from './lib/timing'
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
import { useFreshnessLabel } from './lib/useFreshnessLabel'
import { useNowTick } from './lib/useNowTick'
import { checkGpxTimes } from './lib/gpxValidity'
import type { GpxTimesValidity } from './lib/gpxValidity'

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
      mode: obj.mode === 'naismith' || obj.mode === 'gpx' ? obj.mode : 'fixed',
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
  try {
    localStorage.setItem(
      SESSION_LS_KEY,
      JSON.stringify({ ...s, savedAt: new Date().toISOString() }),
    )
  } catch { /* quota — silently skip */ }
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
  if (p.mode === 'gpx') return 'tiempos GPX'
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

  // Autosave current planning session whenever a track is loaded.
  useEffect(() => {
    if (!track) return
    saveSession({ track, startTimeISO: startTime.toISOString(), paceConfig, sampling })
  }, [track, startTime, paceConfig, sampling])

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
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)

  // ── Weather freshness ──────────────────────────────────────────────────────
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<Date | null>(null)
  const [refreshingWeather, setRefreshingWeather] = useState(false)
  /** true = show "has estado fuera X min" banner */
  const [returnBanner, setReturnBanner] = useState(false)

  // ── App mode ───────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>('plan')

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

  // ── GPS live position ──────────────────────────────────────────────────────
  /** Distance threshold in km above which we consider the GPS fix off-route. */
  const OFF_TRACK_KM = 0.5

  const livePos = useLivePosition(track, appMode === 'live', ACTIVITY_MAX_SPEED_KMH[paceConfig.activity])

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
  const gpxValidity = useMemo<GpxTimesValidity | null>(
    () => (track && hasGpxTimes ? checkGpxTimes(track, paceConfig.activity) : null),
    [track, hasGpxTimes, paceConfig.activity],
  )

  // Fall back to 'fixed' automatically when activity changes and makes GPX invalid
  useEffect(() => {
    if (paceConfig.mode !== 'gpx') return
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
  // Only valid when ≥ 0.3 km covered AND startTime is in the past
  const realPaceMinPerKm = useMemo(() => {
    if (appMode !== 'live' || !livePos.coords || livePos.trackKm < 0.3) return null
    const elapsedMin = (Date.now() - startTime.getTime()) / 60_000
    if (elapsedMin <= 0) return null
    return elapsedMin / livePos.trackKm
  }, [appMode, livePos.coords, livePos.trackKm, startTime])

  // ── Tick every 30s in live mode so the "expected position" dot moves ──────
  // even when GPS is silent (user standing still).
  const nowTick = useNowTick(30_000, appMode === 'live')

  // ── Expected km on the track at this point in time (per the plan) ─────────
  const expectedKm = useMemo<number | null>(() => {
    if (appMode !== 'live' || !track) return null
    const elapsedMin = (nowTick - startTime.getTime()) / 60_000
    if (elapsedMin <= 0) return null
    return expectedKmAtElapsed(track, elapsedMin, paceConfig)
  }, [appMode, track, startTime, paceConfig, nowTick])

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
        estimatedTime = new Date(
          prev.estimatedTime.getTime() + t * (next.estimatedTime.getTime() - prev.estimatedTime.getTime()),
        )
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
    const now = Date.now()
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
  }, [appMode, livePos.coords, livePos.trackKm, enrichedWaypoints, paceConfig.paceMinPerKm, realPaceMinPerKm])

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
   * Force-bypasses the localStorage cache: a retry implies the user wants
   * fresh data (the cached entry, if any, would only be there from a previous
   * successful fetch — which means we wouldn't be in the error state).
   */
  const retryTerrain = useCallback(() => {
    if (!track) return
    setTerrainStatus('loading')
    fetchTerrainForTrack(track, { force: true })
      .then((results) => {
        setTerrainPoints(results)
        setTerrainStatus('done')
      })
      .catch((err) => {
        console.error('Terrain retry failed:', err)
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

  function handleDownloadGpx() {
    if (!track) return
    // Pass wall-clocks (not Dates) — the serializer writes them directly into
    // <silosenosalgo:cutoffWallClock> without any day component, since the
    // day is meant to be inferred at re-import time.
    downloadGpx(track, cutoffWallClocks)
    setTrackDirty(false)
  }

  // ── Core compute helper (accepts explicit config + segmentPaces overrides) ──
  async function doCompute(
    computeConfig: typeof paceConfig,
    computeSegPaces: SegmentPace[] | null,
  ) {
    if (!track) return
    setStatus('loading')
    setErrorMsg(null)
    setLocationProgress({ done: 0, total: 0 })

    try {
      const wps = computeWaypoints(track, startTime, computeConfig, sampling, computeSegPaces ?? undefined)
      setBaseWaypoints(wps)
      setWeatherArr(wps.map(() => null))
      setLocationArr(wps.map(() => null))

      const weatherPromise = fetchWeatherForWaypoints(wps).then((results) => {
        setWeatherArr(results.map((r) => r.weather))
        setWeatherFetchedAt(new Date())
      })

      const locationPromise = fetchLocationForWaypoints(
        wps,
        track.totalDistanceKm,
        (done, total) => setLocationProgress({ done, total }),
      )
        .then((results) => setLocationArr(results))
        .catch((err: unknown) => {
          setLocationWarning(
            err instanceof Error ? err.message : 'No se pudieron obtener localidades',
          )
        })

      // Pollen: only for European routes (CAMS coverage). Errors are swallowed —
      // the feature degrades gracefully when the API is unavailable or the route
      // is outside Europe. Initialise with nulls first so the array length is correct.
      setPollenArr(wps.map(() => null))
      const pollenPromise = isInEurope(wps)
        ? fetchPollenForWaypoints(wps)
            .then((results) => setPollenArr(results.map((r) => r.pollen)))
            .catch(() => { /* silently ignore — route stays with null pollen */ })
        : Promise.resolve()

      // Terrain: Overpass API query for the route corridor + per-point matching.
      // Hits a localStorage cache (14-day TTL) before going to the network, so
      // re-computing the same route is instant. Runs independently of weather/
      // location/pollen — the terrain mode button shows a spinner until data
      // arrives, or a retry button on failure.
      setTerrainPoints([])
      setTerrainStatus('loading')
      fetchTerrainForTrack(track)
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

      await Promise.all([weatherPromise, locationPromise, pollenPromise])
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('error')
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
      const wps = computeWaypoints(track, now, paceConfig, DEFAULT_SAMPLING, segmentPaces ?? undefined)
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

  const isLoading = status === 'loading'
  const isLiveLoading = status === 'live-loading'
  const isDone = status === 'done' && baseWaypoints.length > 0

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
      )
    }
    return computeCutoffStrategy(
      track, withCutoffs, startTime, effectivePaceConfig, strategyMargin,
      0, 'Salida', segmentTargets,
    )
  }, [track, isDone, enrichedNamedWaypoints, startTime, effectivePaceConfig, strategyMargin, segmentTargets, buddyDerived, buddyKmNow, buddyTick])

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
    const now = Date.now()
    if (startTime.getTime() >= now) return null  // startTime is in the future
    const actualMin = (now - startTime.getTime()) / 60_000
    const expectedMin = expectedMinutesForSegment(track, 0, livePos.trackKm, paceConfig)
    return actualMin - expectedMin  // positive = slow, negative = fast
  }, [appMode, livePos.coords, livePos.trackKm, startTime, track, paceConfig])

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
                  onClick={() => setAppMode('plan')}
                  className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'plan' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  🗺️ <span className="hidden sm:inline">Planificar</span>
                </button>
                <button
                  onClick={() => { setAppMode('live') }}
                  className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'live' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  📍 <span className="hidden sm:inline">En vivo</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Paso 1: GPX ── */}
        <section className="space-y-3">
          {(!track || paramsExpanded) && (
            <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">1 · Carga tu ruta</h2>
          )}
          {track ? (
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
                onClick={() => { setTrack(null); setAppMode('plan'); reset() }}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors shrink-0"
              >
                Cambiar
              </button>
            </div>
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
                    disabled={isLoading || isLiveLoading}
                    className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors text-base flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Consultando…
                      </>
                    ) : hasComputedOnce ? (
                      'Recalcular previsión →'
                    ) : (
                      'Calcular y obtener previsión →'
                    )}
                  </button>

                  {/* Cancel button: only shown when there is a previous compute to return to */}
                  {hasComputedOnce && (
                    <button
                      onClick={handleCancelModify}
                      disabled={isLoading || isLiveLoading}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-slate-400 hover:text-slate-200 font-medium py-2.5 rounded-xl transition-colors text-sm"
                    >
                      Cancelar — volver sin recalcular
                    </button>
                  )}

                  {/* Secondary: live shortcut */}
                  <button
                    onClick={handleComputeLive}
                    disabled={isLoading || isLiveLoading}
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

            {isLoading && locationProgress.total > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Obteniendo comarcas…</span>
                  <span>{locationProgress.done}/{locationProgress.total}</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${(locationProgress.done / locationProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl px-5 py-4 text-red-300 text-sm">
                <strong>Error:</strong> {errorMsg}
              </div>
            )}

            {locationWarning && (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-3 text-amber-400 text-sm flex items-center gap-2">
                <span>⚠️</span>
                <span>Población/comarca no disponible ({locationWarning}). La previsión meteorológica sigue activa.</span>
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
                  className="ml-auto"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Weather summary (plan mode only) ── */}
        {appMode === 'plan' && enrichedWaypoints.some((w) => w.weather) && (
          <>
            <WeatherSummary
              waypoints={enrichedWaypoints}
              range={deferredAnalyzeRange}
              onClearRange={() => setAnalyzeRange(null)}
            />
            <WeatherFreshnessChip
              fetchedAt={weatherFetchedAt}
              onRefresh={handleRefreshWeather}
              refreshing={refreshingWeather}
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
            isOffTrack={isOffTrack}
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
            onTerrainRetry={retryTerrain}
            showRainRadar={showRainRadar}
            onShowRainRadarChange={setShowRainRadar}
            rainRadarAvailable={appMode === 'live' || (appMode === 'plan' && buddyObs.length > 0)}
            showWindAnimation={showWindAnimation}
            onShowWindAnimationChange={setShowWindAnimation}
            windAnimationAvailable={weatherArr.some((w) => w !== null)}
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
              const tableNamedWaypoints =
                appMode === 'live'
                  ? enrichedNamedWaypoints.filter((wpt) => wpt.distanceKm >= livePos.trackKm - 0.05)
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
function WeatherFreshnessChip({
  fetchedAt,
  onRefresh,
  refreshing,
  className = '',
}: {
  fetchedAt: Date | null
  onRefresh: () => void
  refreshing: boolean
  className?: string
}) {
  const freshness = useFreshnessLabel(fetchedAt)
  if (!freshness) return null

  const colorClass =
    freshness.severity === 'fresh' ? 'text-green-400' :
    freshness.severity === 'stale' ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <span className={colorClass}>⏱ Meteo: {freshness.label}</span>
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
const WeatherSummary = memo(function WeatherSummary({
  waypoints,
  range,
  onClearRange,
}: {
  waypoints: ReturnType<typeof useMemo>
  range?: { from: number; to: number } | null
  onClearRange?: () => void
}) {
  type Wp = { weather: { temperatureC: number; precipProbability: number } | null; distanceKm: number }
  const allWps = waypoints as Wp[]

  const wps = allWps.filter((w) => {
    if (!w.weather) return false
    if (!range) return true
    return w.distanceKm >= range.from && w.distanceKm <= range.to
  })

  if (wps.length === 0) return null

  const temps = wps.map((w) => w.weather!.temperatureC)
  const probs = wps.map((w) => w.weather!.precipProbability)
  const maxProb = Math.max(...probs)
  const minTemp = Math.min(...temps)
  const maxTemp = Math.max(...temps)
  const rainyCount = probs.filter((p) => p >= 50).length
  const risk = maxProb >= 70 ? 'alto' : maxProb >= 40 ? 'moderado' : 'bajo'
  const riskColor = maxProb >= 70 ? 'text-blue-400' : maxProb >= 40 ? 'text-yellow-400' : 'text-green-400'

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Riesgo lluvia', value: risk, color: riskColor },
          { label: 'Prob. máx.', value: `${maxProb}%`, color: maxProb >= 70 ? 'text-blue-400' : 'text-slate-200' },
          { label: 'Temperatura', value: `${minTemp.toFixed(0)}–${maxTemp.toFixed(0)}°C`, color: 'text-slate-200' },
          { label: 'Tramos con lluvia', value: `${rainyCount} / ${wps.length}`, color: rainyCount > 0 ? 'text-sky-400' : 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800 rounded-xl px-4 py-4 text-center">
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
})
