import 'leaflet/dist/leaflet.css'
import '../lib/gestureHandling'
import { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint, EnrichedNamedWaypoint } from '../lib/places'
import type { PaceConfig } from '../lib/timing'
import { formatTime, formatDuration, haversineKm, elevationStatsForSegment, splitHoursMinutes } from '../lib/timing'
import { weatherLabel, windImpact, windImpactStyle, windDirectionLabel } from '../lib/weather'
import { precipToColor, impactToColor, gradeToColor, tempToColor } from '../lib/mapColors'
import type { ViewMode } from '../lib/viewMode'
import type { PollenData, PollenType, PollenLevel } from '../lib/pollen'
import { POLLEN_META, POLLEN_TYPES, pollenLevel, pollenLevelStyle, pollenLevelColor } from '../lib/pollen'
import type { TerrainType } from '../lib/terrain'
import { TERRAIN_META, TERRAIN_TYPES, terrainSummary } from '../lib/terrain'
import { useNowTick } from '../lib/useNowTick'
import type { AnalyzeRange } from './WeatherCharts'
import type { RadarFrame } from '../lib/rainRadar'
import { fetchRadarFrames, findNowFrameIndex } from '../lib/rainRadar'
import { RainRadarLayer } from './RainRadarLayer'
import { RainPlayer } from './RainPlayer'
import type { WindFrame } from '../lib/windField'
import { fetchWindField, trackBbox, findCurrentWindIndex } from '../lib/windField'
import type { DaylightBand } from '../lib/daylight'
import { bandAt } from '../lib/daylight'
import { solarIrradiance, sunTempUplift } from '../lib/sunTemp'
import { WindLayer } from './WindLayer'
import { WindPlayer } from './WindPlayer'

export type { AnalyzeRange }

interface Props {
  track: GpxTrack
  waypoints: EnrichedWaypoint[]
  /** Shared colouring mode (driven by the single ModeSelector). */
  mode: ViewMode
  /** When true, slider is replaced by a GPS progress bar */
  liveMode?: boolean
  /** Current GPS coordinates in live mode */
  liveCoords?: { lat: number; lon: number } | null
  /**
   * When false, the map does NOT auto-pan to follow the GPS dot.
   * Use false in simulation mode so the dot moves visibly across a static map.
   * Defaults to true (real GPS tracking behaviour).
   */
  followPosition?: boolean
  /** 0..1 progress derived from GPS position */
  liveProgress?: number
  /** Km along the track where the user currently is (live mode) */
  liveTrackKm?: number
  /**
   * True when the GPS fix is implausibly far from the route (>500 m).
   * The GPS dot is drawn in amber to signal that snapped-km values are
   * unreliable — the dot still shows the true device location.
   */
  isOffTrack?: boolean
  /**
   * When set, the map captures clicks and reports the clicked lat/lon. Used by
   * the dev GPS simulator to drop a fake fix at an arbitrary point. The cursor
   * turns into a crosshair while active.
   */
  onPickPosition?: ((lat: number, lon: number) => void) | null
  /** Km on the track where the user "should be" per the plan (live mode) */
  expectedKm?: number | null
  /** Pace config — used for section time estimates in analyze mode */
  paceConfig?: PaceConfig
  /** Controlled analyze range — null means play mode */
  analyzeRange?: AnalyzeRange | null
  /** Called when the user changes the analyze range or toggles modes */
  onAnalyzeRangeChange?: (range: AnalyzeRange | null) => void
  /** GPX <wpt> POIs enriched with estimated time + weather */
  namedWaypoints?: EnrichedNamedWaypoint[]
  /** Buddy's projected km on the track (plan-mode buddy tracker). */
  buddyKm?: number | null
  /** Reported buddy observations — drawn as small dots with popups. */
  buddyObservations?: { km: number; time: Date }[]
  /** Pollen data per waypoint (same order/length as waypoints). Only populated for European routes. */
  pollenData?: (PollenData | null)[]
  /** Currently selected pollen type for the pollen map mode. */
  pollenType?: PollenType
  /** Called when the user changes the selected pollen type. */
  onPollenTypeChange?: (type: PollenType) => void
  /**
   * OSM terrain type per **track point** (same order/length as `track.points`).
   * The map renderer groups consecutive same-terrain points into colored
   * polyline runs, giving ~10 m visual granularity in terrain mode.
   * Undefined while the Overpass fetch hasn't completed yet.
   */
  pointTerrains?: TerrainType[]
  /**
   * Lifecycle of the terrain fetch — drives the loading/retry UI inside
   * the terrain mode button.
   */
  terrainStatus?: 'idle' | 'loading' | 'done' | 'error'
  /**
   * Failure kind when terrainStatus === 'error'. The legend text adapts to
   * give the user actionable feedback (rate limit → wait time, network → check
   * connection, server → just retry).
   */
  terrainErrorKind?: 'rate-limit' | 'network' | 'server'
  /** When errorKind === 'rate-limit', seconds until the next Overpass slot opens. */
  terrainRetryAfterSec?: number
  /** Called when the user clicks the retry button after a fetch failure. */
  onTerrainRetry?: () => void
  /**
   * Whether the animated rain-radar overlay is enabled. Only used when
   * `mapMode === 'rain'` and `rainRadarAvailable` is true.
   */
  showRainRadar?: boolean
  /** Toggle the rain-radar overlay on/off (persisted by the parent). */
  onShowRainRadarChange?: (v: boolean) => void
  /**
   * Whether the rain-radar feature is available in the current context
   * (live mode, or plan mode while the buddy tracker is active). Hides the
   * toggle button when false.
   */
  rainRadarAvailable?: boolean
  /**
   * Whether the animated wind layer is enabled. Only shown when
   * `mapMode === 'wind'` and `windAnimationAvailable` is true.
   */
  showWindAnimation?: boolean
  /** Toggle the wind animation on/off (persisted by the parent). */
  onShowWindAnimationChange?: (v: boolean) => void
  /**
   * Whether the wind-animation feature is available (route loaded + weather
   * data present). Hides the toggle button when false.
   */
  windAnimationAvailable?: boolean
  /**
   * Geographic anchor (lat/lon) for sun-position calculations in daylight mode.
   * Typically the track's midpoint — sun-time differences across hundreds of km
   * in temperate latitudes are only a few minutes, irrelevant at our scale.
   */
  daylightAnchor?: { lat: number; lon: number }
  /**
   * Km position the user is hovering on the elevation profile. When set, a
   * marker is shown at that point on the map so the two views stay in sync.
   */
  hoverKm?: number | null
  /**
   * Slot rendered on the left side of the map header, sharing the row with
   * the legend on the right. Used to host the shared ModeSelector so the
   * vista chips and the map's own legend live on the same line.
   */
  headerSlot?: React.ReactNode
}

const DAYLIGHT_COLOR: Record<DaylightBand, string> = {
  day:   '#fbbf24',  // amber-400
  civil: '#c2410c',  // orange-700
  night: '#1e1b4b',  // indigo-950
}

const RAIN_LEGEND = [
  { label: '0–20%', color: '#22c55e' },
  { label: '20–40%', color: '#eab308' },
  { label: '40–60%', color: '#f97316' },
  { label: '60–80%', color: '#ef4444' },
  { label: '>80%', color: '#7c3aed' },
]

const WIND_LEGEND = [
  { label: 'A favor', color: '#22c55e' },
  { label: 'Lateral', color: '#eab308' },
  { label: 'En contra', color: '#ef4444' },
  { label: 'Calmado', color: '#94a3b8' },
]

const SLIDER_STEPS = 1000
const PLAY_STEP = 0.003
const PLAY_INTERVAL_MS = 30
const PRECISION_STEP_KM = 0.1

/** Format a cut-off margin (minutes) as "+2h 05m" or "−8 min" */
function cutoffMarginText(min: number): string {
  const { h, m } = splitHoursMinutes(Math.abs(min))
  const t = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  return min >= 0 ? `+${t}` : `−${t}`
}

// Flag icon for GPX named waypoints — created once at module level (browser-only SPA)
const FLAG_ICON = L.divIcon({
  className: '',
  html: '<div style="font-size:18px;line-height:1;user-select:none;pointer-events:none">🚩</div>',
  iconSize: [20, 22],
  iconAnchor: [3, 21],
  popupAnchor: [0, -20],
})

// Pause auto-follow this long after the user pans/zooms, so they can study
// another part of the map without the view snapping back to the GPS dot.
const FOLLOW_GRACE_MS = 20_000

// ── Sub-component: auto-centers the map on live GPS position, but yields to the
// user. Panning/zooming pauses the follow (re-armed on each interaction); it
// resumes and re-centers after FOLLOW_GRACE_MS of quiet, or immediately when the
// "volver a mi posición" button bumps `recenterNonce`. Reports follow state up
// so the parent can show that button.
function MapCentering({ coords, recenterNonce, onFollowingChange }: {
  coords: { lat: number; lon: number } | null
  recenterNonce: number
  onFollowingChange: (following: boolean) => void
}) {
  const map = useMap()
  const pausedRef = useRef(false)
  const coordsRef = useRef(coords)
  const timerRef = useRef<number | null>(null)
  coordsRef.current = coords

  const setPaused = (p: boolean) => {
    if (pausedRef.current === p) return
    pausedRef.current = p
    onFollowingChange(!p)
  }
  const recenter = () => {
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    setPaused(false)
    const c = coordsRef.current
    if (c) map.panTo([c.lat, c.lon], { animate: true, duration: 0.8 })
  }

  // Reset to "following" whenever this controller (re)mounts.
  useEffect(() => { onFollowingChange(true) }, [onFollowingChange])

  // Follow the GPS dot, unless the user is currently studying the map.
  useEffect(() => {
    if (coords && !pausedRef.current) {
      map.panTo([coords.lat, coords.lon], { animate: true, duration: 1 })
    }
  }, [coords, map])

  // User pan/zoom → pause; resume after a quiet grace period.
  useEffect(() => {
    const armResume = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(recenter, FOLLOW_GRACE_MS)
    }
    const onStart = () => {
      setPaused(true)
      if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    }
    map.on('dragstart', onStart)
    map.on('zoomstart', onStart)
    map.on('dragend', armResume)
    map.on('zoomend', armResume)
    return () => {
      map.off('dragstart', onStart)
      map.off('zoomstart', onStart)
      map.off('dragend', armResume)
      map.off('zoomend', armResume)
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
    // refs keep the handlers current; only `map` needs to re-bind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Explicit recenter from the button.
  const seenNonce = useRef(recenterNonce)
  useEffect(() => {
    if (recenterNonce === seenNonce.current) return
    seenNonce.current = recenterNonce
    recenter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce])

  return null
}

// ── Sub-component: reports map clicks (dev GPS simulator pick mode) ──────────
function MapClickPicker({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  const map = useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng) },
  })
  useEffect(() => {
    const el = map.getContainer()
    el.style.cursor = 'crosshair'
    return () => { el.style.cursor = '' }
  }, [map])
  return null
}

/** Interpolate [lat, lon] at a given km along the track. Shared by the play
 *  pointer, the expected-position dot and the elevation-profile hover marker. */
function coordsAtKm(
  points: GpxTrack['points'],
  cumKm: ArrayLike<number>,
  totalKm: number,
  kmRaw: number,
): [number, number] | null {
  if (points.length < 2) return null
  const km = Math.max(0, Math.min(totalKm, kmRaw))
  let i = 0
  while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
  if (i >= cumKm.length - 1) {
    const last = points[points.length - 1]
    return [last.lat, last.lon]
  }
  const span = cumKm[i + 1] - cumKm[i]
  const t = span > 0 ? (km - cumKm[i]) / span : 0
  return [
    points[i].lat + t * (points[i + 1].lat - points[i].lat),
    points[i].lon + t * (points[i + 1].lon - points[i].lon),
  ]
}

// ── Small stat pill for the analyze panel ────────────────────────────────────
function StatPill({ label, value, color = 'text-slate-200' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  )
}

export function RouteMap({
  track,
  waypoints,
  mode,
  liveMode = false,
  liveCoords = null,
  liveProgress = 0,
  liveTrackKm = 0,
  followPosition = true,
  isOffTrack = false,
  onPickPosition = null,
  expectedKm = null,
  paceConfig,
  analyzeRange = null,
  onAnalyzeRangeChange,
  namedWaypoints = [],
  buddyKm = null,
  buddyObservations = [],
  pollenData,
  pollenType,
  onPollenTypeChange,
  pointTerrains,
  terrainStatus = 'idle',
  terrainErrorKind = 'network',
  terrainRetryAfterSec = 0,
  onTerrainRetry,
  showRainRadar = false,
  onShowRainRadarChange,
  rainRadarAvailable = false,
  showWindAnimation = false,
  onShowWindAnimationChange,
  windAnimationAvailable = false,
  daylightAnchor,
  hoverKm = null,
  headerSlot,
}: Props) {
  const { points } = track

  // The shared mode drives all colouring/legend/overlay branches below. Kept as
  // a local `mapMode` alias so the rest of the component is unchanged.
  const mapMode = mode

  // ── Rain-radar state (RainViewer animated overlay) ────────────────────────
  const [radarFrames, setRadarFrames]   = useState<RadarFrame[]>([])
  const [radarIndex, setRadarIndex]     = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(true)   // auto-play per spec
  const radarActive = mapMode === 'rain' && rainRadarAvailable && showRainRadar

  // Fetch frames when the radar becomes active. Refresh every 5 min while
  // it stays active so the manifest doesn't go stale during long sessions.
  useEffect(() => {
    if (!radarActive) return
    let cancelled = false
    const load = () => {
      fetchRadarFrames()
        .then((frames) => {
          if (cancelled || frames.length === 0) return
          setRadarFrames((prev) => {
            // Preserve current index if the new manifest still has the same frame
            const nowIdx = findNowFrameIndex(frames)
            setRadarIndex((curIdx) => {
              if (prev.length === 0) return nowIdx
              const curTime = prev[curIdx]?.timeMs
              const match   = frames.findIndex((f) => f.timeMs === curTime)
              return match >= 0 ? match : nowIdx
            })
            return frames
          })
        })
        .catch(() => { /* silently ignore — radar is best-effort */ })
    }
    load()
    const refresh = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(refresh) }
  }, [radarActive])

  // ── Wind-animation state (leaflet-velocity / Open-Meteo) ──────────────────
  const [windFrames, setWindFrames]   = useState<WindFrame[]>([])
  const [windIndex,  setWindIndex]    = useState(0)
  const [windPlaying, setWindPlaying] = useState(false)  // paused by default; user advances manually
  const windActive = mapMode === 'wind' && windAnimationAvailable && showWindAnimation

  // Fetch wind grid when the animation becomes active.
  // Re-fetches every 15 min (cached in windField.ts, so cheap after first call).
  useEffect(() => {
    if (!windActive) return
    let cancelled = false
    const bbox = trackBbox(points)
    const load = () => {
      fetchWindField(bbox)
        .then((frames) => {
          if (cancelled || frames.length === 0) return
          setWindFrames(frames)
          setWindIndex(findCurrentWindIndex(frames))
        })
        .catch(() => { /* silently ignore — wind overlay is best-effort */ })
    }
    load()
    const refresh = setInterval(load, 15 * 60_000)
    return () => { cancelled = true; clearInterval(refresh) }
  }, [windActive, points])

  // ── Play-mode state ───────────────────────────────────────────────────────
  const [progress, setProgress] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  // Live-mode follow state: false while the user is studying the map (paused).
  const [followingLive, setFollowingLive] = useState(true)
  const [recenterNonce, setRecenterNonce] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Derived from controlled prop: null = play mode, object = analyze mode
  const interactionMode = analyzeRange != null ? 'analyze' : 'play'
  const analyzeFrom = analyzeRange?.from ?? 0
  const analyzeTo = analyzeRange?.to ?? track.totalDistanceKm

  // Deferred range: slider thumb stays snappy; heavy segment/marker re-computes
  // only when React is idle (useDeferredValue, React 19)
  const deferredRange = useDeferredValue(analyzeRange)
  const deferredFrom = deferredRange?.from ?? 0
  const deferredTo = deferredRange?.to ?? track.totalDistanceKm

  // In live mode the progress is driven externally; in plan mode it's the slider
  const effectiveProgress = liveMode ? liveProgress : progress

  // ── Cumulative km per track point ─────────────────────────────────────────
  const cumKm = useMemo(() => {
    const arr = new Float64Array(points.length)
    for (let i = 1; i < points.length; i++) {
      arr[i] = arr[i - 1] + haversineKm(points[i - 1], points[i])
    }
    return arr
  }, [points])

  const totalKm = track.totalDistanceKm
  const targetKm = effectiveProgress * totalKm

  // ── Pollen-related derived values ──────────────────────────────────────────
  const hasPollen = pollenData != null && pollenData.some((p) => p !== null)
  const effectivePollenType: PollenType = pollenType ?? 'grass'

  /**
   * O(1) waypoint-index lookup: needed for per-marker pollen data.
   * Built whenever the waypoints array reference changes.
   */
  const wpIndexMap = useMemo(() => {
    const m = new WeakMap<(typeof waypoints)[0], number>()
    waypoints.forEach((wp, i) => m.set(wp, i))
    return m
  }, [waypoints])

  // ── Pre-compute colored segment metadata ──────────────────────────────────
  // Two segmentation strategies share the same shape so the play-mode /
  // analyze-range / "isPast" logic downstream works without branching:
  //
  //   • Weather modes (rain/wind/pollen): one segment per waypoint pair, colored
  //     by the segment's destination waypoint. Coarse but matches forecast data
  //     granularity (one weather sample per waypoint).
  //
  //   • Terrain mode: one segment per **run of consecutive same-terrain track
  //     points**. Much finer (~10 m) — surface changes visible mid-leg. ETAs
  //     are interpolated from the bracketing waypoints since runs don't align
  //     with sampled waypoint positions.
  const allSegments = useMemo(() => {
    type Seg = {
      key: number
      pts: [number, number][]
      color: string
      startKm: number
      endKm: number
      ptStart: number
      ptEnd: number
      endTimeMs: number
    }

    // ── Terrain runs (per-point granularity) ────────────────────────────
    if (mapMode === 'terrain' && pointTerrains && pointTerrains.length === points.length && points.length >= 2) {
      // Linear-time ETA lookup at any point index, interpolated between
      // the two bracketing waypoints' estimatedTime values
      const wpKm: number[] = waypoints.map((w) => w.distanceKm)
      const wpMs: number[] = waypoints.map((w) => w.estimatedTime.getTime())
      const pointEta = (idx: number): number => {
        if (wpKm.length === 0) return 0
        const km = cumKm[idx]
        let lo = 0
        let hi = wpKm.length - 1
        // Binary search: find largest lo with wpKm[lo] <= km
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (wpKm[mid] <= km) lo = mid
          else hi = mid - 1
        }
        const next = Math.min(lo + 1, wpKm.length - 1)
        const span = wpKm[next] - wpKm[lo]
        if (span <= 0) return wpMs[lo]
        const t = Math.max(0, Math.min(1, (km - wpKm[lo]) / span))
        return wpMs[lo] + t * (wpMs[next] - wpMs[lo])
      }

      const out: Seg[] = []
      let runStart = 0
      let runTerrain = pointTerrains[0]
      let key = 0

      const flush = (endIdx: number) => {
        if (endIdx <= runStart) return
        const segPts: [number, number][] = []
        for (let k = runStart; k <= endIdx; k++) {
          segPts.push([points[k].lat, points[k].lon])
        }
        out.push({
          key: key++,
          pts: segPts,
          color: TERRAIN_META[runTerrain].color,
          startKm: cumKm[runStart],
          endKm: cumKm[endIdx],
          ptStart: runStart,
          ptEnd: endIdx,
          endTimeMs: pointEta(endIdx),
        })
      }

      for (let i = 1; i < points.length; i++) {
        if (pointTerrains[i] !== runTerrain) {
          flush(i - 1)
          // Overlap by one point so adjacent polylines meet visually
          runStart = i - 1
          runTerrain = pointTerrains[i]
        }
      }
      flush(points.length - 1)
      return out
    }

    // ── Slope per-point sampling (matches the elevation profile) ────────
    // Waypoint-based sampling averages climbs and descents over long stretches
    // and most segments end up in the flat (grey) bucket. Resample to ~320
    // evenly-spaced points like the profile so the slope coloring is faithful
    // — and works in Capa 1 (no plan, no waypoints).
    if (mapMode === 'slope' && points.length >= 2) {
      const SLOPE_SAMPLES = 320
      const step = Math.max(1, Math.ceil(points.length / SLOPE_SAMPLES))
      const idx: number[] = []
      for (let i = 0; i < points.length; i += step) idx.push(i)
      if (idx[idx.length - 1] !== points.length - 1) idx.push(points.length - 1)

      const out: Seg[] = []
      for (let k = 1; k < idx.length; k++) {
        const a = idx[k - 1]
        const b = idx[k]
        const segPts: [number, number][] = []
        for (let j = a; j <= b; j++) segPts.push([points[j].lat, points[j].lon])
        const dEle = points[b].ele - points[a].ele
        const dM = Math.max(1, (cumKm[b] - cumKm[a]) * 1000)
        const grade = (dEle / dM) * 100
        out.push({
          key: k,
          pts: segPts,
          color: gradeToColor(grade),
          startKm: cumKm[a],
          endKm: cumKm[b],
          ptStart: a,
          ptEnd: b,
          // No ETA in slope mode (works without a plan). Inf disables the
          // "past" fade in the play renderer below.
          endTimeMs: Number.POSITIVE_INFINITY,
        })
      }
      return out
    }

    // ── Daylight runs (per-point granularity) ───────────────────────────
    // Each point's "estimated time" is interpolated from the bracketing
    // waypoints; its band (day / civil / night) drives the color. Bands
    // change at most a handful of times per route so the runs coalesce.
    if (mapMode === 'daylight' && daylightAnchor && waypoints.length >= 2) {
      const wpKm: number[] = waypoints.map((w) => w.distanceKm)
      const wpMs: number[] = waypoints.map((w) => w.estimatedTime.getTime())
      const pointEta = (idx: number): number => {
        const km = cumKm[idx]
        let lo = 0
        let hi = wpKm.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (wpKm[mid] <= km) lo = mid
          else hi = mid - 1
        }
        const next = Math.min(lo + 1, wpKm.length - 1)
        const span = wpKm[next] - wpKm[lo]
        if (span <= 0) return wpMs[lo]
        const t = Math.max(0, Math.min(1, (km - wpKm[lo]) / span))
        return wpMs[lo] + t * (wpMs[next] - wpMs[lo])
      }

      const out: Seg[] = []
      let runStart = 0
      let runBand: DaylightBand = bandAt(new Date(pointEta(0)), daylightAnchor.lat, daylightAnchor.lon)
      let key = 0

      const flushDl = (endIdx: number) => {
        if (endIdx <= runStart) return
        const segPts: [number, number][] = []
        for (let k = runStart; k <= endIdx; k++) {
          segPts.push([points[k].lat, points[k].lon])
        }
        out.push({
          key: key++,
          pts: segPts,
          color: DAYLIGHT_COLOR[runBand],
          startKm: cumKm[runStart],
          endKm: cumKm[endIdx],
          ptStart: runStart,
          ptEnd: endIdx,
          endTimeMs: pointEta(endIdx),
        })
      }

      for (let i = 1; i < points.length; i++) {
        const b = bandAt(new Date(pointEta(i)), daylightAnchor.lat, daylightAnchor.lon)
        if (b !== runBand) {
          flushDl(i - 1)
          runStart = i - 1
          runBand = b
        }
      }
      flushDl(points.length - 1)
      return out
    }

    // ── Default: waypoint-based segments (weather/pollen colored) ────────
    return waypoints.slice(1).map((curr, i) => {
      const prev = waypoints[i]
      const pts = points
        .slice(prev.index, curr.index + 1)
        .map((p): [number, number] => [p.lat, p.lon])
      // When terrain mode is active but data isn't ready yet, fall through to
      // rain coloring so the map stays informative instead of going all-grey.
      const segGrade =
        ((points[curr.index].ele - points[prev.index].ele) /
          Math.max(1, (cumKm[curr.index] - cumKm[prev.index]) * 1000)) * 100
      const color =
        mapMode === 'slope'
          ? gradeToColor(segGrade)
          : mapMode === 'temp'
          ? (curr.weather ? tempToColor(curr.weather.temperatureC) : '#64748b')
          : mapMode === 'sunTemp'
          ? (curr.weather
              ? tempToColor(
                  curr.weather.temperatureC +
                    sunTempUplift(
                      solarIrradiance(
                        curr.estimatedTime,
                        curr.lat,
                        curr.lon,
                        curr.weather.cloudCoverPct,
                      ),
                    ),
                )
              : '#64748b')
          : mapMode === 'wind'
          ? impactToColor(curr)
          : mapMode === 'pollen'
          ? pollenLevelColor(effectivePollenType, pollenData?.[i + 1]?.[effectivePollenType] ?? null)
          : precipToColor(curr.weather?.precipProbability)
      return {
        key: i + 1,
        pts,
        color,
        startKm: cumKm[prev.index],
        endKm: cumKm[curr.index],
        ptStart: prev.index,
        ptEnd: curr.index,
        endTimeMs: curr.estimatedTime.getTime(),
      }
    })
  }, [waypoints, points, mapMode, cumKm, pollenData, effectivePollenType, pointTerrains, daylightAnchor])

  // ── "Now" tick (60 s) used to mute weather-colored segments whose ETA is
  //    already in the past — those colors come from forecast/reanalysis data
  //    that may not reflect what actually happened when the buddy/runner
  //    passed through.
  const nowTick = useNowTick(60_000, !liveMode)

  // ── Split allSegments at targetKm into "before" and "after" (play mode) ──
  const { beforeSegments, afterSegments } = useMemo(() => {
    type SegRender = { key: number; positions: [number, number][]; color: string; endTimeMs: number }
    // Idle (progress 0, not playing) defaults to "fully painted" so a freshly
    // loaded route looks complete — same visual as having finished playback.
    // Pressing play resets the visual to the progressive trail state.
    const idleDefault = !isPlaying && effectiveProgress <= 0
    if (effectiveProgress >= 1 || idleDefault) {
      return {
        beforeSegments: allSegments.map((s) => ({ key: s.key, positions: s.pts, color: s.color, endTimeMs: s.endTimeMs })),
        afterSegments: [] as SegRender[],
      }
    }
    if (effectiveProgress <= 0) {
      return {
        beforeSegments: [] as SegRender[],
        afterSegments: allSegments.map((s) => ({ key: s.key, positions: s.pts, color: s.color, endTimeMs: s.endTimeMs })),
      }
    }

    const before: SegRender[] = []
    const after: SegRender[] = []

    for (const seg of allSegments) {
      if (seg.endKm <= targetKm) {
        before.push({ key: seg.key, positions: seg.pts, color: seg.color, endTimeMs: seg.endTimeMs })
        continue
      }
      if (seg.startKm >= targetKm) {
        after.push({ key: seg.key, positions: seg.pts, color: seg.color, endTimeMs: seg.endTimeMs })
        continue
      }
      const beforePts: [number, number][] = []
      const afterPts: [number, number][] = []
      let crossed = false
      for (let pi = seg.ptStart; pi <= seg.ptEnd; pi++) {
        if (cumKm[pi] <= targetKm) {
          beforePts.push([points[pi].lat, points[pi].lon])
        } else {
          if (!crossed && pi > seg.ptStart) {
            const span = cumKm[pi] - cumKm[pi - 1]
            if (span > 0) {
              const t = (targetKm - cumKm[pi - 1]) / span
              const crossPt: [number, number] = [
                points[pi - 1].lat + t * (points[pi].lat - points[pi - 1].lat),
                points[pi - 1].lon + t * (points[pi].lon - points[pi - 1].lon),
              ]
              beforePts.push(crossPt)
              afterPts.push(crossPt)
            }
            crossed = true
          }
          afterPts.push([points[pi].lat, points[pi].lon])
        }
      }
      if (beforePts.length >= 2) before.push({ key: seg.key, positions: beforePts, color: seg.color, endTimeMs: seg.endTimeMs })
      if (afterPts.length >= 2) after.push({ key: seg.key, positions: afterPts, color: seg.color, endTimeMs: seg.endTimeMs })
    }

    return { beforeSegments: before, afterSegments: after }
  }, [allSegments, effectiveProgress, isPlaying, targetKm, cumKm, points])

  // Leading-edge pointer at the current play position. Geometry-based (not
  // derived from the weather-coloured segments) so it shows even in Capa 1,
  // where there are no segments yet.
  const tipPoint = useMemo<[number, number] | null>(() => {
    if (liveMode || effectiveProgress >= 1 || effectiveProgress <= 0) return null
    return coordsAtKm(points, cumKm, totalKm, targetKm)
  }, [liveMode, effectiveProgress, targetKm, points, cumKm, totalKm])

  // Track geometry from the start up to the current play position — the
  // "travelled" trail, drawn under the weather-coloured segments so play mode
  // is meaningful before any forecast exists.
  const playedRoutePositions = useMemo<[number, number][]>(() => {
    // Only meaningful mid-playback. At progress ≥ 1 (the default full-route view)
    // the whole route would be drawn as one sky line, bleeding through any faded
    // past segments and muddying the mode colouring — so bail out.
    if (liveMode || interactionMode !== 'play' || effectiveProgress <= 0 || effectiveProgress >= 1) return []
    const out: [number, number][] = []
    for (let i = 0; i < points.length; i++) {
      if (cumKm[i] <= targetKm) {
        out.push([points[i].lat, points[i].lon])
      } else {
        const tip = coordsAtKm(points, cumKm, totalKm, targetKm)
        if (tip) out.push(tip)
        break
      }
    }
    return out
  }, [liveMode, interactionMode, effectiveProgress, targetKm, points, cumKm, totalKm])

  // ── Analyze inside segments: only the weather-colored portion [from, to] ──
  // Uses deferredFrom/deferredTo so slider drags don't block Leaflet repaints.
  const analyzeInsideSegments = useMemo<{ key: string; positions: [number, number][]; color: string; endTimeMs: number }[]>(() => {
    if (liveMode || interactionMode !== 'analyze') return []

    const result: { key: string; positions: [number, number][]; color: string; endTimeMs: number }[] = []

    for (const seg of allSegments) {
      if (seg.endKm <= deferredFrom || seg.startKm >= deferredTo) continue

      if (seg.startKm >= deferredFrom && seg.endKm <= deferredTo) {
        result.push({ key: `an-${seg.key}`, positions: seg.pts, color: seg.color, endTimeMs: seg.endTimeMs })
        continue
      }

      const iPts: [number, number][] = []

      for (let pi = seg.ptStart; pi <= seg.ptEnd; pi++) {
        const km = cumKm[pi]

        if (pi > seg.ptStart) {
          const prevKm = cumKm[pi - 1]

          if (prevKm < deferredFrom && km > deferredFrom) {
            const t = (deferredFrom - prevKm) / (km - prevKm)
            iPts.push([
              points[pi - 1].lat + t * (points[pi].lat - points[pi - 1].lat),
              points[pi - 1].lon + t * (points[pi].lon - points[pi - 1].lon),
            ])
          }

          if (prevKm < deferredTo && km > deferredTo) {
            const t = (deferredTo - prevKm) / (km - prevKm)
            iPts.push([
              points[pi - 1].lat + t * (points[pi].lat - points[pi - 1].lat),
              points[pi - 1].lon + t * (points[pi].lon - points[pi - 1].lon),
            ])
          }
        }

        if (km >= deferredFrom && km <= deferredTo) {
          iPts.push([points[pi].lat, points[pi].lon])
        }
      }

      if (iPts.length >= 2) {
        result.push({ key: `an-${seg.key}`, positions: iPts, color: seg.color, endTimeMs: seg.endTimeMs })
      }
    }

    return result
  }, [liveMode, interactionMode, deferredFrom, deferredTo, allSegments, cumKm, points])

  // ── Analyze-range geometry highlight ──────────────────────────────────────
  // A plain polyline of the track between [from, to], independent of weather
  // colouring. This is what makes the selected segment visible *before* the
  // forecast is computed (Capa 1): there are no weather-coloured segments yet,
  // so analyzeInsideSegments is empty and nothing would otherwise be drawn.
  // When the forecast exists, the coloured segments draw on top of this.
  const analyzeRoutePositions = useMemo<[number, number][]>(() => {
    if (liveMode || interactionMode !== 'analyze') return []
    const out: [number, number][] = []
    for (let i = 0; i < points.length; i++) {
      const km = cumKm[i]
      const prevKm = i > 0 ? cumKm[i - 1] : null
      // entry boundary: interpolate the point where the route crosses `from`
      if (prevKm != null && prevKm < deferredFrom && km >= deferredFrom) {
        const t = (deferredFrom - prevKm) / (km - prevKm)
        out.push([
          points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
          points[i - 1].lon + (points[i].lon - points[i - 1].lon) * t,
        ])
      }
      if (km >= deferredFrom && km <= deferredTo) {
        out.push([points[i].lat, points[i].lon])
      }
      // exit boundary: interpolate the point where the route crosses `to`
      if (prevKm != null && prevKm <= deferredTo && km > deferredTo) {
        const t = (deferredTo - prevKm) / (km - prevKm)
        out.push([
          points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
          points[i - 1].lon + (points[i].lon - points[i - 1].lon) * t,
        ])
        break
      }
    }
    return out
  }, [liveMode, interactionMode, deferredFrom, deferredTo, points, cumKm])

  // ── Section stats (analyze mode) ──────────────────────────────────────────
  const analyzeStats = useMemo(() => {
    if (liveMode || interactionMode !== 'analyze' || !paceConfig) return null
    return elevationStatsForSegment(track, deferredFrom, deferredTo, paceConfig)
  }, [liveMode, interactionMode, track, deferredFrom, deferredTo, paceConfig])

  // ── Visible waypoint markers ──────────────────────────────────────────────
  const visibleWaypoints = useMemo(() => {
    if (liveMode) return waypoints.filter((wp) => wp.distanceKm >= liveTrackKm - 0.05)
    if (interactionMode === 'analyze') {
      return waypoints.filter(
        (wp) => wp.distanceKm >= deferredFrom - 0.05 && wp.distanceKm <= deferredTo + 0.05,
      )
    }
    if (effectiveProgress >= 1) return waypoints
    return waypoints.filter((wp, i) => i === 0 || wp.distanceKm <= targetKm)
  }, [waypoints, liveMode, liveTrackKm, interactionMode, deferredFrom, deferredTo, effectiveProgress, targetKm])

  // ── Projected on-track position (live mode) ───────────────────────────────
  // The point on the track at liveTrackKm — i.e. the nearest plausible location
  // used for all position/progress calculations. When the GPS fix drifts off
  // the route we draw a dashed leader from the raw fix to this point.
  const liveTrackCoords = useMemo<[number, number] | null>(() => {
    if (!liveMode || points.length < 2) return null
    const km = Math.max(0, Math.min(totalKm, liveTrackKm))
    let i = 0
    while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
    if (i >= cumKm.length - 1) return [points[points.length - 1].lat, points[points.length - 1].lon]
    const span = cumKm[i + 1] - cumKm[i]
    const t = span > 0 ? (km - cumKm[i]) / span : 0
    return [
      points[i].lat + t * (points[i + 1].lat - points[i].lat),
      points[i].lon + t * (points[i + 1].lon - points[i].lon),
    ]
  }, [liveMode, liveTrackKm, cumKm, points, totalKm])

  // ── Expected position dot (live mode) ─────────────────────────────────────
  const expectedCoords = useMemo<[number, number] | null>(
    () => (expectedKm === null ? null : coordsAtKm(points, cumKm, totalKm, expectedKm)),
    [expectedKm, cumKm, points, totalKm],
  )

  // ── Elevation-profile hover marker ────────────────────────────────────────
  const hoverCoords = useMemo<[number, number] | null>(
    () => (hoverKm == null ? null : coordsAtKm(points, cumKm, totalKm, hoverKm)),
    [hoverKm, cumKm, points, totalKm],
  )

  // ── Buddy projected position (plan mode buddy tracker) ────────────────────
  const buddyCoords = useMemo<[number, number] | null>(() => {
    if (buddyKm === null || points.length < 2) return null
    const km = Math.max(0, Math.min(totalKm, buddyKm))
    let i = 0
    while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
    if (i >= cumKm.length - 1) return [points[points.length - 1].lat, points[points.length - 1].lon]
    const span = cumKm[i + 1] - cumKm[i]
    const t = span > 0 ? (km - cumKm[i]) / span : 0
    return [
      points[i].lat + t * (points[i + 1].lat - points[i].lat),
      points[i].lon + t * (points[i + 1].lon - points[i].lon),
    ]
  }, [buddyKm, cumKm, points, totalKm])

  // ── Buddy trail (already-done portion, from km 0 to buddyKm) ──────────────
  const buddyTrail = useMemo<[number, number][] | null>(() => {
    if (buddyKm === null || buddyKm <= 0 || points.length < 2) return null
    const km = Math.min(totalKm, buddyKm)
    const trail: [number, number][] = []
    for (let i = 0; i < points.length; i++) {
      if (cumKm[i] <= km) {
        trail.push([points[i].lat, points[i].lon])
      } else {
        // interpolate the exact endpoint at km so the trail meets the marker
        if (i > 0) {
          const span = cumKm[i] - cumKm[i - 1]
          const t = span > 0 ? (km - cumKm[i - 1]) / span : 0
          trail.push([
            points[i - 1].lat + t * (points[i].lat - points[i - 1].lat),
            points[i - 1].lon + t * (points[i].lon - points[i - 1].lon),
          ])
        }
        break
      }
    }
    return trail.length >= 2 ? trail : null
  }, [buddyKm, cumKm, points, totalKm])

  // ── Coordinates for each reported observation (small dots on the trail) ───
  const buddyObservationCoords = useMemo<{ km: number; time: Date; lat: number; lon: number }[]>(() => {
    if (buddyObservations.length === 0 || points.length < 2) return []
    return buddyObservations.map((obs) => {
      const km = Math.max(0, Math.min(totalKm, obs.km))
      let i = 0
      while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
      if (i >= cumKm.length - 1) {
        const last = points[points.length - 1]
        return { km: obs.km, time: obs.time, lat: last.lat, lon: last.lon }
      }
      const span = cumKm[i + 1] - cumKm[i]
      const t = span > 0 ? (km - cumKm[i]) / span : 0
      return {
        km: obs.km,
        time: obs.time,
        lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
        lon: points[i].lon + t * (points[i + 1].lon - points[i].lon),
      }
    })
  }, [buddyObservations, cumKm, points, totalKm])

  // ── Static helpers ────────────────────────────────────────────────────────
  const fullRoute = useMemo(
    () => points.map((p): [number, number] => [p.lat, p.lon]),
    [points],
  )

  const bounds = useMemo((): [[number, number], [number, number]] => {
    const lats = points.map((p) => p.lat)
    const lons = points.map((p) => p.lon)
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ]
  }, [points])

  // ── Auto-play (plan mode only) ────────────────────────────────────────────
  useEffect(() => {
    if (liveMode || !isPlaying) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + PLAY_STEP
        if (next >= 1) { setIsPlaying(false); return 1 }
        return next
      })
    }, PLAY_INTERVAL_MS)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isPlaying, liveMode])

  const handlePlayPause = () => {
    if (progress >= 1 && !isPlaying) { setProgress(0); setIsPlaying(true) }
    else setIsPlaying((p) => !p)
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPlaying) setIsPlaying(false)
    setProgress(parseInt(e.target.value) / SLIDER_STEPS)
  }

  // ── Interpolated time label ───────────────────────────────────────────────
  const currentTimeLabel = useMemo(() => {
    if (waypoints.length === 0) return null
    if (effectiveProgress <= 0) return formatTime(waypoints[0].estimatedTime)
    if (effectiveProgress >= 1) return formatTime(waypoints[waypoints.length - 1].estimatedTime)

    let prevWp = waypoints[0]
    let nextWp = waypoints[waypoints.length - 1]
    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].distanceKm >= targetKm) {
        prevWp = waypoints[i - 1]
        nextWp = waypoints[i]
        break
      }
    }

    const span = nextWp.distanceKm - prevWp.distanceKm
    if (span <= 0) return formatTime(prevWp.estimatedTime)
    const t = (targetKm - prevWp.distanceKm) / span
    const ms =
      prevWp.estimatedTime.getTime() +
      t * (nextWp.estimatedTime.getTime() - prevWp.estimatedTime.getTime())
    return formatTime(new Date(ms))
  }, [waypoints, targetKm, effectiveProgress])

  // ── Derived UI values ─────────────────────────────────────────────────────
  const legend = mapMode === 'wind' ? WIND_LEGEND : RAIN_LEGEND
  const legendTitle = mapMode === 'wind' ? 'Viento:' : 'Prob. lluvia:'
  const sliderAtFull = progress >= 1
  const playIcon = isPlaying ? '⏸' : sliderAtFull ? '↺' : '▶'
  const POLLEN_LEGEND_LEVELS: PollenLevel[] = [1, 2, 3, 4]

  // Terrain: available once the async Overpass fetch + per-point matching completes
  const hasTerrain = pointTerrains != null && pointTerrains.length > 0
  // Terrain types actually present in this route (for legend); excludes 'unknown'
  const activeTerrainTypes = useMemo<TerrainType[]>(() => {
    if (!pointTerrains) return []
    const seen = new Set<TerrainType>()
    for (const t of pointTerrains) if (t !== 'unknown') seen.add(t)
    return TERRAIN_TYPES.filter((t) => seen.has(t))
  }, [pointTerrains])
  // Summary: km + % per type — now precise to GPX-point granularity instead
  // of per-waypoint approximation, so percentages reflect real surface mix
  const terrainBreakdown = useMemo(
    () => (hasTerrain ? terrainSummary(pointTerrains!, cumKm) : []),
    [hasTerrain, pointTerrains, cumKm],
  )

  // ── Handlers for analyze mode (delegated to parent) ───────────────────────
  const enterAnalyze = () => onAnalyzeRangeChange?.({ from: 0, to: totalKm })
  const exitAnalyze = () => onAnalyzeRangeChange?.(null)
  const resetRange = () => onAnalyzeRangeChange?.({ from: 0, to: totalKm })

  const handleFromSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const km = (parseInt(e.target.value) / SLIDER_STEPS) * totalKm
    onAnalyzeRangeChange?.({ from: Math.min(km, analyzeTo - 0.05), to: analyzeTo })
  }

  const handleToSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const km = (parseInt(e.target.value) / SLIDER_STEPS) * totalKm
    onAnalyzeRangeChange?.({ from: analyzeFrom, to: Math.max(km, analyzeFrom + 0.05) })
  }

  // ── Precision step handlers (±0.1 km) ────────────────────────────────────
  const handleFromMinus = () =>
    onAnalyzeRangeChange?.({
      from: Math.max(0, Math.min(analyzeFrom - PRECISION_STEP_KM, analyzeTo - 0.05)),
      to: analyzeTo,
    })
  const handleFromPlus = () =>
    onAnalyzeRangeChange?.({
      from: Math.min(analyzeFrom + PRECISION_STEP_KM, analyzeTo - 0.05),
      to: analyzeTo,
    })
  const handleToMinus = () =>
    onAnalyzeRangeChange?.({
      from: analyzeFrom,
      to: Math.max(analyzeTo - PRECISION_STEP_KM, analyzeFrom + 0.05),
    })
  const handleToPlus = () =>
    onAnalyzeRangeChange?.({
      from: analyzeFrom,
      to: Math.min(analyzeTo + PRECISION_STEP_KM, totalKm),
    })

  return (
    <div className="space-y-2">
      {/* ── Header row: mode-selector slot on the left, legend on the right ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">{headerSlot}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            {mapMode === 'terrain' && terrainStatus === 'loading' ? (
              /* ── Loading: spinner + helper text instead of legend ── */
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Cargando terreno desde OpenStreetMap…
              </span>
            ) : mapMode === 'terrain' && terrainStatus === 'error' ? (
              <span className="flex items-center gap-2 text-red-400 flex-wrap">
                <span>⚠️</span>
                <span>
                  {terrainErrorKind === 'rate-limit'
                    ? `Servidor OpenStreetMap saturado. Espera ${Math.max(terrainRetryAfterSec, 5)}s e intenta de nuevo.`
                    : terrainErrorKind === 'network'
                    ? 'Error de red al consultar OpenStreetMap.'
                    : 'Error del servidor OpenStreetMap.'}
                </span>
                <button
                  onClick={onTerrainRetry}
                  className="underline hover:text-red-300 transition-colors"
                >
                  Reintentar
                </button>
              </span>
            ) : mapMode === 'terrain' && hasTerrain ? (
              /* ── Terrain legend: one chip per type found in the route ── */
              <>
                {activeTerrainTypes.length === 0 ? (
                  <span className="text-slate-500">Sin datos de terreno en esta zona</span>
                ) : (
                  activeTerrainTypes.map((t) => {
                    const entry = terrainBreakdown.find((e) => e.type === t)
                    return (
                      <span key={t} className="flex items-center gap-1 font-medium">
                        <span
                          className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ background: TERRAIN_META[t].color }}
                        />
                        <span className="text-slate-300">{TERRAIN_META[t].label}</span>
                        {entry && (
                          <span className="text-slate-500 font-normal">
                            {entry.pct.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    )
                  })
                )}
              </>
            ) : mapMode === 'daylight' ? (
              <>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: DAYLIGHT_COLOR.day }} />
                  Día
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: DAYLIGHT_COLOR.civil }} />
                  Crepúsculo civil
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: DAYLIGHT_COLOR.night }} />
                  Noche
                </span>
              </>
            ) : mapMode === 'pollen' && hasPollen ? (
              <>
                {/* Pollen type selector */}
                <select
                  value={effectivePollenType}
                  onChange={(e) => onPollenTypeChange?.(e.target.value as PollenType)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-green-600"
                >
                  {POLLEN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {POLLEN_META[t].emoji} {POLLEN_META[t].name}
                    </option>
                  ))}
                </select>
                {/* Pollen level legend */}
                {POLLEN_LEGEND_LEVELS.map((lvl) => {
                  const { label, color } = pollenLevelStyle(lvl)
                  return (
                    <span key={lvl} className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                  )
                })}
              </>
            ) : mapMode === 'terrain' ? (
              /* Terrain mode but not loaded yet (idle) — the typical pre-plan /
                 Capa 1 state. Without this branch the chain falls through to the
                 rain legend below, which makes no sense before any forecast. */
              <span className="text-slate-500">Pulsa «🏔️ Terreno» para ver el tipo de firme</span>
            ) : mapMode === 'slope' ? (
              <>
                {([['#2563eb', 'bajada'], ['#64748b', 'llano'], ['#fbbf24', 'suave'], ['#f97316', 'fuerte'], ['#b91c1c', 'muy fuerte']] as const).map(([c, l]) => (
                  <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>
                ))}
              </>
            ) : mapMode === 'temp' ? (
              <>
                <span>Temperatura:</span>
                {([['#1d4ed8', '≤0°'], ['#22d3ee', '~10°'], ['#22c55e', '~16°'], ['#fbbf24', '~22°'], ['#f97316', '~28°'], ['#b91c1c', '35°+']] as const).map(([c, l]) => (
                  <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>
                ))}
              </>
            ) : (
              <>
                <span>{legendTitle}</span>
                {legend.map((l) => (
                  <span key={l.label} className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: l.color }} />
                    {l.label}
                  </span>
                ))}
                {mapMode === 'rain' && rainRadarAvailable && onShowRainRadarChange && (
                  <>
                    <span className="text-slate-600">·</span>
                    <button
                      onClick={() => onShowRainRadarChange(!showRainRadar)}
                      title={
                        showRainRadar
                          ? 'Ocultar capa de radar animado (RainViewer)'
                          : 'Mostrar capa de radar animado (RainViewer)'
                      }
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                        showRainRadar
                          ? 'bg-purple-600/30 border-purple-500/60 text-purple-200 hover:bg-purple-600/40'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <span>🛰️</span>
                      <span className="font-medium">Radar</span>
                    </button>
                  </>
                )}
                {mapMode === 'wind' && windAnimationAvailable && onShowWindAnimationChange && (
                  <>
                    <span className="text-slate-600">·</span>
                    <button
                      onClick={() => onShowWindAnimationChange(!showWindAnimation)}
                      title={
                        showWindAnimation
                          ? 'Ocultar animación de viento (Open-Meteo)'
                          : 'Mostrar animación de partículas de viento (Open-Meteo)'
                      }
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                        showWindAnimation
                          ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-200 hover:bg-cyan-600/40'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <span>🌬️</span>
                      <span className="font-medium">Animación</span>
                    </button>
                  </>
                )}
              </>
            )}
            {liveMode && (
              <>
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1" title="Posición real (GPS)">
                  <span className="inline-block w-3 h-3 rounded-full bg-sky-400 border-2 border-white" />
                  GPS
                </span>
                <span
                  className="flex items-center gap-1"
                  title="Posición prevista según la hora de salida y el ritmo planificado"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ border: '2px dashed #ec4899', background: 'transparent' }}
                  />
                  Prevista
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="relative rounded-xl overflow-hidden border border-slate-700" style={{ height: 420 }}>
        <MapContainer
          key={track.name + track.points.length}
          bounds={bounds}
          boundsOptions={{ padding: [30, 30] }}
          style={{ height: '100%', width: '100%' }}
          gestureHandling
          gestureHandlingOptions={{
            duration: 1500,
            text: {
              touch: 'Usa dos dedos para mover el mapa',
              scroll: 'Usa Ctrl + scroll para hacer zoom',
              scrollMac: 'Usa ⌘ + scroll para hacer zoom',
            },
          }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />

          {radarActive && radarFrames.length > 0 && (
            <RainRadarLayer
              frames={radarFrames}
              currentIndex={radarIndex}
              /* RainViewer's hard limit is z=7 with size=256. We snap the
                 map down to z=7 on activation so the user lands on the
                 regional view where weather is meaningful, but they keep
                 full zoom freedom afterwards: the TileLayer's
                 maxNativeZoom=7 makes Leaflet upscale the z=7 tile
                 (browser bilinear) at higher zooms — blurrier but still
                 useful as route-level context. */
              clampZoom={7}
            />
          )}

          {windActive && windFrames.length > 0 && (
            <WindLayer
              frames={windFrames}
              currentIndex={windIndex}
            />
          )}

          {liveMode && followPosition && (
            <MapCentering
              coords={liveCoords}
              recenterNonce={recenterNonce}
              onFollowingChange={setFollowingLive}
            />
          )}
          {onPickPosition && <MapClickPicker onPick={onPickPosition} />}

          {/* Dark shadow */}
          <Polyline
            positions={fullRoute}
            pathOptions={{ color: '#0f172a', weight: 9, opacity: 0.5 }}
          />

          {/* Grey background (plan mode). Only shown when there's contrast to
             provide: during active playback or while paused mid-route. Idle
             (progress 0 + not playing) hides it so the colored route is the
             default visual, matching the finished state. */}
          {!liveMode && (
            <Polyline
              positions={fullRoute}
              pathOptions={{
                color: '#475569',
                weight: 5,
                opacity:
                  interactionMode === 'analyze' ? 0.55
                  : effectiveProgress >= 1 ? 0
                  : !isPlaying && effectiveProgress <= 0 ? 0
                  : 0.55,
              }}
            />
          )}

          {/* Plan / play: travelled trail (geometry) — Capa 1 ONLY (no mode
              segments). When the mode gradient exists, beforeSegments already
              carry the colour for the travelled portion, and this sky trail must
              NOT draw: a conditionally-mounted Polyline gets appended on top of
              the already-mounted segment lines, so it would hide the gradient
              behind a flat blue line from start to the cursor. */}
          {!liveMode && interactionMode === 'play' && allSegments.length === 0 && playedRoutePositions.length >= 2 && (
            <Polyline
              positions={playedRoutePositions}
              pathOptions={{ color: '#38bdf8', weight: 5, opacity: 0.95 }}
            />
          )}

          {/* Plan / play: weather-colored before segments */}
          {!liveMode && interactionMode === 'play' && beforeSegments.map((seg) => {
            // Only fade "already passed" segments during active playback. In the
            // static view this would dim the whole route when the plan's ETAs are
            // in the past (e.g. a recorded GPX whose own timestamps drive timing),
            // making the mode colouring look washed out.
            const isPast = isPlaying && seg.endTimeMs < nowTick
            return (
              <Polyline
                key={`before-${seg.key}`}
                positions={seg.positions}
                pathOptions={
                  isPast
                    ? { color: seg.color, weight: 4, opacity: 0.45, dashArray: '4 3' }
                    : { color: seg.color, weight: 5, opacity: 1 }
                }
              />
            )
          })}

          {/* Plan / play: the not-yet-reached (ahead) portion, drawn in the flat
              base colour — NOT the mode gradient. The slider is a progress fill:
              travelled (start→cursor) keeps the mode colouring, and whatever you
              "un-do" by dragging the slider back reverts to the base slate. The
              tip marker sits exactly on the boundary between the two. */}
          {!liveMode && interactionMode === 'play' && afterSegments.map((seg) => (
            <Polyline
              key={`after-${seg.key}`}
              positions={seg.positions}
              pathOptions={{ color: '#475569', weight: 5, opacity: 1 }}
            />
          ))}

          {/* Tip marker at the leading edge of the painted route */}
          {!liveMode && interactionMode === 'play' && tipPoint && (
            <>
              <CircleMarker
                center={tipPoint}
                radius={7}
                pathOptions={{ color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, weight: 0 }}
              />
              <CircleMarker
                center={tipPoint}
                radius={4}
                pathOptions={{ color: '#0f172a', fillColor: '#0f172a', fillOpacity: 1, weight: 0 }}
              />
            </>
          )}

          {/* Plan / analyze: geometry highlight of the selected range. Drawn
              under the weather-colored segments so it shows on its own before
              the forecast exists (Capa 1) and is covered by color afterwards. */}
          {!liveMode && interactionMode === 'analyze' && analyzeRoutePositions.length >= 2 && (
            <Polyline
              positions={analyzeRoutePositions}
              pathOptions={{ color: '#38bdf8', weight: 5, opacity: 0.95 }}
            />
          )}

          {/* Plan / analyze: weather-colored inside-range segments */}
          {!liveMode && interactionMode === 'analyze' && analyzeInsideSegments.map((seg) => {
            // Only fade "already passed" segments during active playback. In the
            // static view this would dim the whole route when the plan's ETAs are
            // in the past (e.g. a recorded GPX whose own timestamps drive timing),
            // making the mode colouring look washed out.
            const isPast = isPlaying && seg.endTimeMs < nowTick
            return (
              <Polyline
                key={seg.key}
                positions={seg.positions}
                pathOptions={
                  isPast
                    ? { color: seg.color, weight: 4, opacity: 0.45, dashArray: '4 3' }
                    : { color: seg.color, weight: 5, opacity: 1 }
                }
              />
            )
          })}

          {/* Live: muted traveled */}
          {liveMode && beforeSegments.map((seg) => (
            <Polyline
              key={`before-${seg.key}`}
              positions={seg.positions}
              pathOptions={{ color: '#64748b', weight: 4, opacity: 0.6 }}
            />
          ))}

          {/* Live: weather-colored pending */}
          {liveMode && afterSegments.map((seg) => (
            <Polyline
              key={`after-${seg.key}`}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 5, opacity: 1 }}
            />
          ))}

          {/* Fallbacks */}
          {!liveMode && interactionMode === 'play' && effectiveProgress >= 1 && beforeSegments.length === 0 && (
            <Polyline positions={fullRoute} pathOptions={{ color: '#94a3b8', weight: 5, opacity: 0.9 }} />
          )}
          {liveMode && allSegments.length === 0 && (
            <Polyline positions={fullRoute} pathOptions={{ color: '#94a3b8', weight: 5, opacity: 0.9 }} />
          )}

          {/* Waypoint markers */}
          {visibleWaypoints.map((wp, i) => {
            const isStart = i === 0
            const isEnd = wp === waypoints[waypoints.length - 1]
            const isEndpoint = isStart || isEnd
            const w = wp.weather
            const { emoji, label } = w ? weatherLabel(w.weatherCode) : { emoji: '', label: '' }
            const impact = w ? windImpact(w.windDirection, wp.bearing, w.windSpeedKmh) : null
            const { label: impactLabel, color: impactColor } = impact
              ? windImpactStyle(impact)
              : { label: '', color: '#94a3b8' }

            // Pollen data for this specific waypoint
            const wpPollenIdx = wpIndexMap.get(wp) ?? -1
            const wpPollen = wpPollenIdx >= 0 ? (pollenData?.[wpPollenIdx] ?? null) : null

            const dotColor =
              mapMode === 'wind'
                ? impactToColor(wp)
                : mapMode === 'pollen' && wpPollen
                ? pollenLevelColor(effectivePollenType, wpPollen[effectivePollenType])
                : precipToColor(w?.precipProbability)

            // Pollen types with non-zero levels (for popup)
            const pollenRows = wpPollen
              ? POLLEN_TYPES
                  .map((type) => {
                    const grains = wpPollen[type]
                    const lvl = pollenLevel(type, grains)
                    return { type, grains, lvl }
                  })
                  .filter((r) => r.lvl > 0)
              : []

            return (
              <CircleMarker
                key={wp.index}
                center={[wp.lat, wp.lon]}
                radius={isEndpoint ? 9 : 5}
                pathOptions={{
                  fillColor: dotColor,
                  color: '#0f172a',
                  weight: isEndpoint ? 2.5 : 1.5,
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <div style={{ minWidth: 170, lineHeight: 1.6 }}>
                    <p style={{ fontWeight: 700, marginBottom: 2 }}>
                      {formatTime(wp.estimatedTime)} · {wp.distanceKm.toFixed(1)} km
                    </p>
                    <p style={{ color: '#64748b', marginBottom: 4 }}>
                      Alt: {Math.round(wp.ele)} m{'  '}
                      <span style={{ color: '#fb923c' }}>+{Math.round(wp.elevGainM)}</span>
                      <span style={{ color: '#475569' }}>/</span>
                      <span style={{ color: '#60a5fa' }}>-{Math.round(wp.elevLossM)}</span>
                      {' m'}
                    </p>
                    {w ? (
                      <>
                        <p>{emoji} {label}</p>
                        <p>
                          🌡️ {w.temperatureC.toFixed(1)}°C
                          {(() => {
                            const upl = sunTempUplift(solarIrradiance(wp.estimatedTime, wp.lat, wp.lon, w.cloudCoverPct))
                            if (upl < 0.5) return null
                            return (
                              <span style={{ color: '#f97316', marginLeft: 6 }}>
                                · 🌞 {(w.temperatureC + upl).toFixed(1)}°C al sol (+{upl.toFixed(1)}°)
                              </span>
                            )
                          })()}
                        </p>
                        <p>🌧️ {w.precipProbability}% lluvia</p>
                        <p>
                          💨 {Math.round(w.windSpeedKmh)} km/h {windDirectionLabel(w.windDirection)}
                          {impact && impact !== 'calm' && (
                            <span style={{ color: impactColor, marginLeft: 4 }}>· {impactLabel}</span>
                          )}
                        </p>
                      </>
                    ) : (
                      <p style={{ color: '#94a3b8' }}>Sin datos meteo</p>
                    )}
                    {/* Pollen breakdown */}
                    {pollenRows.length > 0 && (
                      <div style={{ marginTop: 6, borderTop: '1px solid #334155', paddingTop: 6 }}>
                        <p style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4, fontWeight: 600 }}>
                          🌿 Polen
                        </p>
                        {pollenRows.map(({ type, grains, lvl }) => {
                          const { label: lvlLabel, color } = pollenLevelStyle(lvl as PollenLevel)
                          return (
                            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                              <span>{POLLEN_META[type].emoji}</span>
                              <span style={{ fontSize: 11 }}>{POLLEN_META[type].name}</span>
                              <span style={{ marginLeft: 'auto', color, fontSize: 11, fontWeight: 600 }}>{lvlLabel}</span>
                              {grains !== null && (
                                <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }}>
                                  {grains.toFixed(0)} g
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {wp.location?.nearestPlace && (
                      <p style={{ color: '#94a3b8', marginTop: 4 }}>
                        📍 {wp.location.nearestPlace.name}
                      </p>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}

          {/* ── GPX named waypoints (🚩 flags) ── */}
          {namedWaypoints
            .filter((wpt) => {
              if (liveMode) return wpt.distanceKm >= liveTrackKm - 0.05
              if (interactionMode === 'analyze') {
                return wpt.distanceKm >= deferredFrom - 0.1 && wpt.distanceKm <= deferredTo + 0.1
              }
              return true
            })
            .map((wpt, i) => {
              // Pin the flag to the POI's position ON THE TRACK (its distanceKm),
              // not the raw <wpt> lat/lon. When a GPX carries a persisted
              // distanceKm — or its coords snapped to the wrong pass of a route
              // that overlaps itself — the raw coords sit at a different km than
              // the value the rest of the app uses (table, cut-offs, carousel,
              // popup). nearestTrackIndex is kept consistent with distanceKm by
              // the parser, so this keeps the flag where the app says the POI is.
              const snap = track.points[Math.min(Math.max(0, wpt.nearestTrackIndex), track.points.length - 1)]
              const flagPos: [number, number] = snap ? [snap.lat, snap.lon] : [wpt.lat, wpt.lon]
              return (
              <Marker key={`nwp-${i}`} position={flagPos} icon={FLAG_ICON}>
                <Popup>
                  <div style={{ minWidth: 160, lineHeight: 1.6 }}>
                    <p style={{ fontWeight: 700, marginBottom: 2 }}>🚩 {wpt.name}</p>
                    {wpt.desc && (
                      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{wpt.desc}</p>
                    )}
                    <p style={{ color: '#64748b', marginBottom: 4 }}>
                      {wpt.distanceKm.toFixed(1)} km
                      {wpt.ele != null && ` · ${Math.round(wpt.ele)} m`}
                    </p>
                    {wpt.estimatedTime && (
                      <p>⏱️ Llegada: {formatTime(wpt.estimatedTime)}</p>
                    )}
                    {wpt.cutoffTime && (
                      <>
                        <p style={{ color: '#fbbf24' }}>
                          🚧 Corte: {formatTime(wpt.cutoffTime)}
                        </p>
                        {wpt.cutoffMarginMin !== undefined && (
                          <p style={{
                            fontWeight: 600,
                            color: wpt.cutoffMarginMin >= 20 ? '#4ade80'
                              : wpt.cutoffMarginMin >= 0 ? '#fbbf24'
                              : '#f87171',
                          }}>
                            {wpt.cutoffMarginMin >= 0 ? '✅' : '❌'}{' '}
                            {cutoffMarginText(wpt.cutoffMarginMin)}
                          </p>
                        )}
                      </>
                    )}
                    {wpt.weather && (
                      <p>
                        🌡️ {wpt.weather.temperatureC.toFixed(1)}°C
                        {'  '}🌧️ {wpt.weather.precipProbability}%
                        {'  '}💨 {Math.round(wpt.weather.windSpeedKmh)} km/h
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
              )
            })}

          {/* Expected position dot */}
          {liveMode && expectedCoords && (
            <CircleMarker
              center={expectedCoords}
              radius={9}
              pathOptions={{
                color: '#ec4899',
                fillColor: '#ec4899',
                fillOpacity: 0.15,
                weight: 2.5,
                dashArray: '5 4',
              }}
            >
              <Popup>
                <div style={{ minWidth: 140, fontSize: 12, lineHeight: 1.5 }}>
                  <p style={{ fontWeight: 700, margin: 0, color: '#be185d' }}>📍 Posición prevista</p>
                  {expectedKm !== null && (
                    <p style={{ color: '#64748b', margin: '4px 0 0' }}>
                      Km {expectedKm.toFixed(1)} · según ritmo planificado
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )}

          {/* Elevation-profile hover marker — follows the cursor on the profile
              so the user can locate that km on the map. */}
          {hoverCoords && (
            <>
              <CircleMarker
                center={hoverCoords}
                radius={9}
                pathOptions={{ color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.18, weight: 2 }}
              />
              <CircleMarker
                center={hoverCoords}
                radius={4}
                pathOptions={{ color: '#ffffff', fillColor: '#0ea5e9', fillOpacity: 1, weight: 2 }}
              />
            </>
          )}

          {/* Buddy already-done trail (halo + purple line) */}
          {buddyTrail && (
            <>
              <Polyline
                positions={buddyTrail}
                pathOptions={{ color: 'white', weight: 5, opacity: 0.5 }}
                interactive={false}
              />
              <Polyline
                positions={buddyTrail}
                pathOptions={{ color: '#a855f7', weight: 3, opacity: 1 }}
                interactive={false}
              />
            </>
          )}

          {/* Reported buddy observation dots */}
          {buddyObservationCoords.map((o, idx) => (
            <CircleMarker
              key={`buddy-obs-${idx}-${o.km}`}
              center={[o.lat, o.lon]}
              radius={4}
              pathOptions={{
                fillColor: '#a855f7',
                color: 'white',
                weight: 1.5,
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div style={{ minWidth: 140, fontSize: 12, lineHeight: 1.5 }}>
                  <p style={{ fontWeight: 700, margin: 0, color: '#7e22ce' }}>
                    🧑 Observación #{idx + 1}
                  </p>
                  <p style={{ color: '#475569', margin: '4px 0 0', fontFamily: 'monospace' }}>
                    km {o.km.toFixed(1)} · {o.time.getHours().toString().padStart(2, '0')}:{o.time.getMinutes().toString().padStart(2, '0')}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Buddy projected position dot (plan mode tracker) */}
          {buddyCoords && (
            <>
              <CircleMarker
                center={buddyCoords}
                radius={13}
                pathOptions={{ fillColor: '#a855f7', color: 'transparent', fillOpacity: 0.22 }}
              />
              <CircleMarker
                center={buddyCoords}
                radius={7}
                pathOptions={{ fillColor: '#a855f7', color: 'white', weight: 2.5, fillOpacity: 1 }}
              >
                <Popup>
                  <div style={{ minWidth: 140, fontSize: 12, lineHeight: 1.5 }}>
                    <p style={{ fontWeight: 700, margin: 0, color: '#7e22ce' }}>🧑 Compañero</p>
                    {buddyKm !== null && (
                      <p style={{ color: '#64748b', margin: '4px 0 0' }}>
                        Km {buddyKm.toFixed(1)} · proyectado al ritmo observado
                      </p>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            </>
          )}

          {/* Off-route leader: dashed line from the raw GPS fix to the nearest
              point on the track (the reference used for position calculations) */}
          {liveMode && isOffTrack && liveCoords && liveTrackCoords && (
            <>
              <Polyline
                positions={[[liveCoords.lat, liveCoords.lon], liveTrackCoords]}
                pathOptions={{ color: '#f59e0b', weight: 2.5, opacity: 0.85, dashArray: '6 6' }}
              />
              <CircleMarker
                center={liveTrackCoords}
                radius={5}
                pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#fde68a', fillOpacity: 0.95 }}
              />
            </>
          )}

          {/* Live GPS position dot — amber when off-route, sky-blue when on-route */}
          {liveMode && liveCoords && (
            <>
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={14}
                pathOptions={{
                  fillColor: isOffTrack ? '#f59e0b' : '#38bdf8',
                  color: 'transparent',
                  fillOpacity: 0.25,
                }}
              />
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={7}
                pathOptions={{
                  fillColor: isOffTrack ? '#f59e0b' : '#38bdf8',
                  color: 'white',
                  weight: 2.5,
                  fillOpacity: 1,
                }}
              />
            </>
          )}
        </MapContainer>

        {/* ── Recenter button (live mode): shown only while the user has panned
             away from the GPS dot; taps re-center immediately. ── */}
        {liveMode && followPosition && !followingLive && (
          <button
            onClick={() => { setFollowingLive(true); setRecenterNonce((n) => n + 1) }}
            className="absolute z-[1000] top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-600/95 hover:bg-sky-500 text-white text-xs font-medium shadow-lg border border-sky-400/40 backdrop-blur-sm transition-colors"
          >
            📍 Volver a mi posición
          </button>
        )}

        {/* ── Rain radar player (overlay, only when radar active) ── */}
        {radarActive && radarFrames.length > 0 && (
          <RainPlayer
            frames={radarFrames}
            currentIndex={radarIndex}
            isPlaying={radarPlaying}
            onIndexChange={setRadarIndex}
            onTogglePlay={() => setRadarPlaying((p) => !p)}
          />
        )}

        {/* ── Wind animation player (overlay, only when wind active + data ready) ── */}
        {windActive && windFrames.length > 0 && (
          <WindPlayer
            frames={windFrames}
            currentIndex={windIndex}
            isPlaying={windPlaying}
            onIndexChange={setWindIndex}
            onTogglePlay={() => setWindPlaying((p) => !p)}
          />
        )}

        {/* ── Wind loading badge (while the grid fetch is in flight) ── */}
        {windActive && windFrames.length === 0 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-slate-900/90 backdrop-blur-sm border border-cyan-700/50 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-cyan-300 shadow-lg pointer-events-none">
            <span className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            Cargando datos de viento…
          </div>
        )}
      </div>

      {/* ── Interaction row: mode toggle + slider (under the map). In analyze
         mode the dual-thumb bar shares the row with the toggle; values + reset
         drop to a second line. In play mode everything lives in a single row. */}
      {liveMode ? (
        <div className="flex items-center gap-3 px-1">
          <span className="flex items-center gap-2 text-xs text-sky-400 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse inline-block" />
            GPS en vivo
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-1000"
              style={{ width: `${effectiveProgress * 100}%` }}
            />
          </div>
          <span className="flex-shrink-0 text-xs font-mono text-slate-400 text-right">
            <span className="text-sky-400 font-semibold">{targetKm.toFixed(1)}</span>
            {' / '}
            <span>{totalKm.toFixed(1)} km</span>
            {currentTimeLabel && (
              <span className="text-slate-300">
                {' · '}
                <span className="text-sky-300 font-semibold">{currentTimeLabel}</span>
              </span>
            )}
          </span>
        </div>
      ) : interactionMode === 'analyze' ? (
        <div className="space-y-2 px-1">
          {/* Toggle + dual-thumb range share the first row. We're in the
             analyze branch here, so the analyze button is the active one. */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs flex-shrink-0">
              <button
                onClick={exitAnalyze}
                className="px-3 py-1.5 transition-colors bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                🎬 Reproducir
              </button>
              <button
                onClick={enterAnalyze}
                className="px-3 py-1.5 transition-colors bg-sky-600 text-white"
              >
                🔍 Analizar tramo
              </button>
            </div>
            <div className="relative h-5 flex items-center mx-2 flex-1 min-w-[200px]">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-700" />
              <div
                className="absolute h-1.5 rounded-full bg-sky-500/70"
                style={{
                  left: `${(analyzeFrom / totalKm) * 100}%`,
                  right: `${100 - (analyzeTo / totalKm) * 100}%`,
                }}
              />
              <input
                type="range"
                min={0}
                max={SLIDER_STEPS}
                step={1}
                value={Math.round((analyzeFrom / totalKm) * SLIDER_STEPS)}
                onChange={handleFromSlider}
                aria-label="Inicio del tramo"
                className="range-dual range-dual-from absolute inset-x-0 w-full"
                style={{ zIndex: (analyzeFrom / totalKm) > 0.5 ? 6 : 4 }}
              />
              <input
                type="range"
                min={0}
                max={SLIDER_STEPS}
                step={1}
                value={Math.round((analyzeTo / totalKm) * SLIDER_STEPS)}
                onChange={handleToSlider}
                aria-label="Final del tramo"
                className="range-dual range-dual-to absolute inset-x-0 w-full"
                style={{ zIndex: 5 }}
              />
            </div>
          </div>

          {/* Values + fine controls + reset on a second sub-row */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
            <span className="flex items-center gap-1">
              <span className="text-slate-400">De</span>
              <span className="font-mono text-sky-400 w-14 text-right">{analyzeFrom.toFixed(1)} km</span>
              <button
                onClick={handleFromMinus}
                title="−0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white font-bold transition-colors leading-none"
              >−</button>
              <button
                onClick={handleFromPlus}
                title="+0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white font-bold transition-colors leading-none"
              >+</button>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-slate-400">A</span>
              <span className="font-mono text-emerald-400 w-14 text-right">{analyzeTo.toFixed(1)} km</span>
              <button
                onClick={handleToMinus}
                title="−0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white font-bold transition-colors leading-none"
              >−</button>
              <button
                onClick={handleToPlus}
                title="+0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white font-bold transition-colors leading-none"
              >+</button>
            </span>
            <span className="text-slate-500">· Tramo {(analyzeTo - analyzeFrom).toFixed(1)} km</span>
            <button
              onClick={resetRange}
              className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      ) : (
        /* Play mode: toggle + play button + slider + km/time on a single row */
        <div className="flex items-center gap-3 px-1 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs flex-shrink-0">
            <button
              onClick={exitAnalyze}
              className="px-3 py-1.5 transition-colors bg-sky-600 text-white"
            >
              🎬 Reproducir
            </button>
            <button
              onClick={enterAnalyze}
              className="px-3 py-1.5 transition-colors bg-slate-800 text-slate-400 hover:text-slate-200"
            >
              🔍 Analizar tramo
            </button>
          </div>
          <button
            onClick={handlePlayPause}
            title={isPlaying ? 'Pausar' : sliderAtFull ? 'Reproducir desde el inicio' : 'Reproducir'}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors text-sm"
          >
            {playIcon}
          </button>
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={Math.round(progress * SLIDER_STEPS)}
            onChange={handleSliderChange}
            className="flex-1 min-w-[150px] h-1.5 rounded-full appearance-none cursor-pointer accent-sky-500"
            style={{ background: `linear-gradient(to right, #0ea5e9 ${progress * 100}%, #334155 ${progress * 100}%)` }}
          />
          <span className="flex-shrink-0 text-xs font-mono text-slate-400 text-right">
            <span className="text-sky-400 font-semibold">{targetKm.toFixed(1)}</span>
            {' / '}
            <span>{totalKm.toFixed(1)} km</span>
            {currentTimeLabel && (
              <span className="text-slate-300">
                {' · '}
                <span className="text-sky-300 font-semibold">{currentTimeLabel}</span>
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── Section stats panel (analyze mode only) ── */}
      {!liveMode && interactionMode === 'analyze' && analyzeStats && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 px-4 py-3">
          <h3 className="text-slate-400 text-[10px] uppercase tracking-widest font-semibold mb-3">
            Análisis del tramo · km {deferredFrom.toFixed(1)} → {deferredTo.toFixed(1)}
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <StatPill label="Distancia" value={`${analyzeStats.distanceKm.toFixed(2)} km`} />
            <StatPill label="D+" value={`+${Math.round(analyzeStats.elevGainM)} m`} color="text-orange-400" />
            <StatPill label="D−" value={`−${Math.round(analyzeStats.elevLossM)} m`} color="text-blue-400" />
            <StatPill label="Tiempo est." value={formatDuration(analyzeStats.estimatedMinutes * 60_000)} />
            <StatPill label="Pendiente" value={`${analyzeStats.avgGradePct.toFixed(1)} %`} />
            <StatPill label="Velocidad" value={`${analyzeStats.avgSpeedKmh.toFixed(1)} km/h`} />
          </div>
        </div>
      )}
    </div>
  )
}
