import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { GpxUploader } from './components/GpxUploader'
import { PaceConfigPanel } from './components/PaceConfig'
import { SamplingPanel } from './components/SamplingPanel'
import { RouteMap } from './components/RouteMap'
import type { MapMode } from './components/RouteMap'
import { WeatherCharts } from './components/WeatherCharts'
import { WaypointsTable } from './components/WaypointsTable'
import type { GpxTrack } from './lib/gpx'
import type { PaceConfig, SamplingConfig, Waypoint } from './lib/timing'
import { ACTIVITY_MAX_SPEED_KMH, computeWaypoints, DEFAULT_SAMPLING, expectedKmAtElapsed, expectedMinutesForSegment, formatDelta, formatPace, formatTime } from './lib/timing'
import type { WeatherData } from './lib/weather'
import { fetchWeatherForWaypoints } from './lib/weather'
import type { LocationInfo, EnrichedNamedWaypoint } from './lib/places'
import { fetchLocationForWaypoints } from './lib/places'
import { CutoffSummary } from './components/CutoffSummary'
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

// ── Cut-off time helpers ───────────────────────────────────────────────────────
/** Stable key for a named waypoint based on its coordinates. */
function wptKey(lat: number, lon: number) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

const CUTOFF_LS_PREFIX = 'silosenosalgo-cutoffs-'

function loadCutoffTimes(trackName: string): Map<string, Date> {
  try {
    const raw = localStorage.getItem(CUTOFF_LS_PREFIX + trackName)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, string>
    const map = new Map<string, Date>()
    for (const [key, val] of Object.entries(obj)) {
      const d = new Date(val)
      if (!isNaN(d.getTime())) map.set(key, d)
    }
    return map
  } catch { return new Map() }
}

function saveCutoffTimes(trackName: string, times: Map<string, Date>) {
  try {
    const obj: Record<string, string> = {}
    for (const [key, val] of times) obj[key] = val.toISOString()
    localStorage.setItem(CUTOFF_LS_PREFIX + trackName, JSON.stringify(obj))
  } catch { /* ignore quota errors */ }
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  const [baseWaypoints, setBaseWaypoints] = useState<Waypoint[]>([])
  const [weatherArr, setWeatherArr] = useState<(WeatherData | null)[]>([])
  const [locationArr, setLocationArr] = useState<(LocationInfo | null)[]>([])

  const [mapMode, setMapMode] = useState<MapMode>('rain')
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [locationProgress, setLocationProgress] = useState({ done: 0, total: 0 })
  const [pdfLoading, setPdfLoading] = useState(false)

  // ── Weather freshness ──────────────────────────────────────────────────────
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<Date | null>(null)
  const [refreshingWeather, setRefreshingWeather] = useState(false)
  /** true = show "has estado fuera X min" banner */
  const [returnBanner, setReturnBanner] = useState(false)

  // ── App mode ───────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>('plan')

  // ── Analyze range (null = play mode / full view) ───────────────────────────
  const [analyzeRange, setAnalyzeRange] = useState<{ from: number; to: number } | null>(null)

  // ── Cut-off times for named waypoints (persisted per track name) ──────────
  const [cutoffTimes, setCutoffTimesState] = useState<Map<string, Date>>(new Map())

  // ── Variable segment paces (set by the cut-off strategy panel) ────────────
  // null = use paceConfig.paceMinPerKm uniformly (normal mode)
  const [segmentPaces, setSegmentPaces] = useState<SegmentPace[] | null>(null)

  // ── Safety margin for cut-off strategy (minutes) ───────────────────────────
  const [strategyMargin, setStrategyMargin] = useState(0)

  // ── Buddy tracking: list of observations { km, time } sorted by km ─────────
  // [] = no observation; when populated, ETAs are projected from the observed
  // per-segment paces (latest segment is used for the unknown future).
  const [buddyObs, setBuddyObs] = useState<BuddyObservation[]>([])

  const setCutoff = useCallback((lat: number, lon: number, time: Date | null) => {
    if (!track) return
    const key = wptKey(lat, lon)
    setCutoffTimesState((prev) => {
      const next = new Map(prev)
      if (time === null) next.delete(key)
      else next.set(key, time)
      saveCutoffTimes(track.name, next)
      return next
    })
  }, [track])
  // Deferred: WeatherCharts, WeatherSummary and the waypoints table only re-render
  // when React is idle, keeping slider drag at 60 fps.
  const deferredAnalyzeRange = useDeferredValue(analyzeRange)

  // ── GPS live position ──────────────────────────────────────────────────────
  const livePos = useLivePosition(track, appMode === 'live', ACTIVITY_MAX_SPEED_KMH[paceConfig.activity])

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
    setStatus('idle')
    setErrorMsg(null)
    setLocationWarning(null)
    setLocationProgress({ done: 0, total: 0 })
    setWeatherFetchedAt(null)
    setReturnBanner(false)
  }

  function handleTrack(t: GpxTrack) {
    setTrack(t)
    setAppMode('plan')
    liveWeatherFetchedRef.current = false
    setAnalyzeRange(null)
    setSegmentPaces(null)
    setBuddyObs([])
    setCutoffTimesState(loadCutoffTimes(t.name))  // restore persisted cut-offs for this track
    reset()
    if (t.points.some((p) => p.time)) {
      // Only auto-switch to 'gpx' when the times are actually valid for the current activity
      const validity = checkGpxTimes(t, paceConfig.activity)
      if (validity.issue === 'ok') {
        setPaceConfig((c) => ({ ...c, mode: 'gpx' }))
      }
    }
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

      await Promise.all([weatherPromise, locationPromise])
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
      )
    }
    return computeCutoffStrategy(track, withCutoffs, startTime, effectivePaceConfig, strategyMargin)
  }, [track, isDone, enrichedNamedWaypoints, startTime, effectivePaceConfig, strategyMargin, buddyDerived, buddyKmNow, buddyTick])

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
            <div className="ml-auto flex rounded-lg overflow-hidden border border-slate-700 text-xs">
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
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Paso 1: GPX ── */}
        <section className="space-y-3">
          <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">1 · Carga tu ruta</h2>
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
            <GpxUploader onTrackLoaded={handleTrack} />
          )}
        </section>

        {/* ── Plan mode sections ── */}
        {appMode === 'plan' && (
          <>
            {track && (
              <section className="space-y-3">
                <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">2 · Fecha y hora de salida</h2>
                <input
                  type="datetime-local"
                  value={toLocalInputValue(startTime)}
                  onChange={(e) => { setStartTime(new Date(e.target.value)); setBuddyObs([]); reset() }}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 font-mono focus:outline-none focus:border-sky-400 text-slate-100"
                />
              </section>
            )}

            {track && (
              <section className="space-y-3">
                <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">3 · Ritmo</h2>
                <PaceConfigPanel
                  config={paceConfig}
                  hasGpxTimes={hasGpxTimes}
                  gpxValidity={gpxValidity}
                  onChange={(c) => { setPaceConfig(c); setSegmentPaces(null); setBuddyObs([]); reset() }}
                />
                {/* Variable-pace active indicator — shown when strategy panel has been applied */}
                {segmentPaces && (
                  <div className="flex items-center justify-between gap-3 text-xs bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2">
                    <span className="text-emerald-300 flex items-center gap-1.5">
                      <span>🔀</span>
                      <span>Ritmo variable por tramos activo</span>
                    </span>
                    <button
                      onClick={() => { setSegmentPaces(null); reset() }}
                      className="text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 transition-colors shrink-0"
                    >
                      Volver a ritmo único
                    </button>
                  </div>
                )}
              </section>
            )}

            {track && (
              <section className="space-y-3">
                <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">4 · Detalle de waypoints</h2>
                <SamplingPanel
                  config={sampling}
                  totalKm={track.totalDistanceKm}
                  onChange={(c) => { setSampling(c); reset() }}
                />
              </section>
            )}

            {track && (
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
                  ) : (
                    'Calcular y obtener previsión →'
                  )}
                </button>

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
                {/* Real average pace */}
                {realPaceMinPerKm !== null && (
                  <span className="text-xs text-slate-400">
                    ⚡ <span className="font-mono text-sky-300">{formatPace(realPaceMinPerKm)}</span>
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
            expectedKm={expectedKm}
            paceConfig={paceConfig}
            analyzeRange={analyzeRange}
            onAnalyzeRangeChange={setAnalyzeRange}
            buddyKm={appMode === 'plan' ? buddyKmNow : null}
            buddyObservations={appMode === 'plan' ? buddyObs : []}
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
