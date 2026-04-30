import 'leaflet/dist/leaflet.css'
import { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint, EnrichedNamedWaypoint } from '../lib/places'
import type { PaceConfig } from '../lib/timing'
import { formatTime, formatDuration, haversineKm, elevationStatsForSegment } from '../lib/timing'
import { weatherLabel, windImpact, windImpactStyle, windDirectionLabel } from '../lib/weather'
import { precipToColor, impactToColor } from '../lib/mapColors'
import type { AnalyzeRange } from './WeatherCharts'

export type MapMode = 'rain' | 'wind'
export type { AnalyzeRange }

interface Props {
  track: GpxTrack
  waypoints: EnrichedWaypoint[]
  mapMode: MapMode
  onMapModeChange: (m: MapMode) => void
  /** When true, slider is replaced by a GPS progress bar */
  liveMode?: boolean
  /** Current GPS coordinates in live mode */
  liveCoords?: { lat: number; lon: number } | null
  /** 0..1 progress derived from GPS position */
  liveProgress?: number
  /** Km along the track where the user currently is (live mode) */
  liveTrackKm?: number
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
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = Math.round(abs % 60)
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

// ── Sub-component: auto-centers the map on live GPS position ─────────────────
function MapCentering({ coords }: { coords: { lat: number; lon: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (coords) {
      map.panTo([coords.lat, coords.lon], { animate: true, duration: 1 })
    }
  }, [coords, map])
  return null
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
  mapMode,
  onMapModeChange,
  liveMode = false,
  liveCoords = null,
  liveProgress = 0,
  liveTrackKm = 0,
  expectedKm = null,
  paceConfig,
  analyzeRange = null,
  onAnalyzeRangeChange,
  namedWaypoints = [],
}: Props) {
  const { points } = track

  // ── Play-mode state ───────────────────────────────────────────────────────
  const [progress, setProgress] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
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

  // ── Pre-compute colored segment metadata ──────────────────────────────────
  const allSegments = useMemo(() => {
    return waypoints.slice(1).map((curr, i) => {
      const prev = waypoints[i]
      const pts = points
        .slice(prev.index, curr.index + 1)
        .map((p): [number, number] => [p.lat, p.lon])
      const color =
        mapMode === 'wind'
          ? impactToColor(curr)
          : precipToColor(curr.weather?.precipProbability)
      return {
        key: i + 1,
        pts,
        color,
        startKm: cumKm[prev.index],
        endKm: cumKm[curr.index],
        ptStart: prev.index,
        ptEnd: curr.index,
      }
    })
  }, [waypoints, points, mapMode, cumKm])

  // ── Split allSegments at targetKm into "before" and "after" (play mode) ──
  const { beforeSegments, afterSegments } = useMemo(() => {
    type SegRender = { key: number; positions: [number, number][]; color: string }
    if (effectiveProgress >= 1) {
      return {
        beforeSegments: allSegments.map((s) => ({ key: s.key, positions: s.pts, color: s.color })),
        afterSegments: [] as SegRender[],
      }
    }
    if (effectiveProgress <= 0) {
      return {
        beforeSegments: [] as SegRender[],
        afterSegments: allSegments.map((s) => ({ key: s.key, positions: s.pts, color: s.color })),
      }
    }

    const before: SegRender[] = []
    const after: SegRender[] = []

    for (const seg of allSegments) {
      if (seg.endKm <= targetKm) {
        before.push({ key: seg.key, positions: seg.pts, color: seg.color })
        continue
      }
      if (seg.startKm >= targetKm) {
        after.push({ key: seg.key, positions: seg.pts, color: seg.color })
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
      if (beforePts.length >= 2) before.push({ key: seg.key, positions: beforePts, color: seg.color })
      if (afterPts.length >= 2) after.push({ key: seg.key, positions: afterPts, color: seg.color })
    }

    return { beforeSegments: before, afterSegments: after }
  }, [allSegments, effectiveProgress, targetKm, cumKm, points])

  // ── Analyze inside segments: only the weather-colored portion [from, to] ──
  // Uses deferredFrom/deferredTo so slider drags don't block Leaflet repaints.
  const analyzeInsideSegments = useMemo<{ key: string; positions: [number, number][]; color: string }[]>(() => {
    if (liveMode || interactionMode !== 'analyze') return []

    const result: { key: string; positions: [number, number][]; color: string }[] = []

    for (const seg of allSegments) {
      if (seg.endKm <= deferredFrom || seg.startKm >= deferredTo) continue

      if (seg.startKm >= deferredFrom && seg.endKm <= deferredTo) {
        result.push({ key: `an-${seg.key}`, positions: seg.pts, color: seg.color })
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
        result.push({ key: `an-${seg.key}`, positions: iPts, color: seg.color })
      }
    }

    return result
  }, [liveMode, interactionMode, deferredFrom, deferredTo, allSegments, cumKm, points])

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

  // ── Expected position dot (live mode) ─────────────────────────────────────
  const expectedCoords = useMemo<[number, number] | null>(() => {
    if (expectedKm === null || points.length < 2) return null
    const km = Math.max(0, Math.min(totalKm, expectedKm))
    let i = 0
    while (i < cumKm.length - 1 && cumKm[i + 1] < km) i++
    if (i >= cumKm.length - 1) return [points[points.length - 1].lat, points[points.length - 1].lon]
    const span = cumKm[i + 1] - cumKm[i]
    const t = span > 0 ? (km - cumKm[i]) / span : 0
    return [
      points[i].lat + t * (points[i + 1].lat - points[i].lat),
      points[i].lon + t * (points[i + 1].lon - points[i].lon),
    ]
  }, [expectedKm, cumKm, points, totalKm])

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
  const hasWeather = waypoints.some((w) => w.weather !== null)
  const legend = mapMode === 'wind' ? WIND_LEGEND : RAIN_LEGEND
  const legendTitle = mapMode === 'wind' ? 'Viento:' : 'Prob. lluvia:'
  const sliderAtFull = progress >= 1
  const playIcon = isPlaying ? '⏸' : sliderAtFull ? '↺' : '▶'

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
      {/* ── Header row ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-200">Mapa de ruta</h2>
          {/* Interaction mode toggle — plan mode only */}
          {!liveMode && (
            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
              <button
                onClick={exitAnalyze}
                className={`px-3 py-1.5 transition-colors ${interactionMode === 'play' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                🎬 Reproducir
              </button>
              <button
                onClick={enterAnalyze}
                className={`px-3 py-1.5 transition-colors ${interactionMode === 'analyze' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                🔍 Analizar tramo
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {hasWeather && (
            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
              <button
                onClick={() => onMapModeChange('rain')}
                className={`px-3 py-1.5 transition-colors ${mapMode === 'rain' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                🌧️ Lluvia
              </button>
              <button
                onClick={() => onMapModeChange('wind')}
                className={`px-3 py-1.5 transition-colors ${mapMode === 'wind' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                💨 Viento
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>{legendTitle}</span>
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
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

      {/* ── Progress row: slider (play) or GPS bar (live) or analyze sliders ── */}
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
        /* ── Dual-handle analyze sliders ── */
        <div className="space-y-1.5 px-1">
          {/* From slider */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-5 shrink-0">De</span>
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              step={1}
              value={Math.round((analyzeFrom / totalKm) * SLIDER_STEPS)}
              onChange={handleFromSlider}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                accentColor: '#0ea5e9',
                background: `linear-gradient(to right, #0ea5e9 ${(analyzeFrom / totalKm) * 100}%, #334155 ${(analyzeFrom / totalKm) * 100}%)`,
              }}
            />
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleFromMinus}
                title="−0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white text-xs font-bold transition-colors leading-none"
              >−</button>
              <button
                onClick={handleFromPlus}
                title="+0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white text-xs font-bold transition-colors leading-none"
              >+</button>
            </div>
            <span className="text-xs font-mono text-sky-400 w-14 text-right shrink-0">
              {analyzeFrom.toFixed(1)} km
            </span>
          </div>

          {/* To slider */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-5 shrink-0">A</span>
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              step={1}
              value={Math.round((analyzeTo / totalKm) * SLIDER_STEPS)}
              onChange={handleToSlider}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                accentColor: '#10b981',
                background: `linear-gradient(to right, #10b981 ${(analyzeTo / totalKm) * 100}%, #334155 ${(analyzeTo / totalKm) * 100}%)`,
              }}
            />
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleToMinus}
                title="−0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white text-xs font-bold transition-colors leading-none"
              >−</button>
              <button
                onClick={handleToPlus}
                title="+0.1 km"
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 hover:text-white text-xs font-bold transition-colors leading-none"
              >+</button>
            </div>
            <span className="text-xs font-mono text-emerald-400 w-14 text-right shrink-0">
              {analyzeTo.toFixed(1)} km
            </span>
          </div>

          {/* Range info + reset */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 pl-8">
              Tramo: {(analyzeTo - analyzeFrom).toFixed(1)} km
            </span>
            <button
              onClick={resetRange}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors pr-14"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      ) : (
        /* ── Play slider ── */
        <div className="flex items-center gap-3 px-1">
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
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-sky-500"
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

      {/* ── Map ── */}
      <div className="rounded-xl overflow-hidden border border-slate-700" style={{ height: 420 }}>
        <MapContainer
          key={track.name + track.points.length}
          bounds={bounds}
          boundsOptions={{ padding: [30, 30] }}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />

          {liveMode && <MapCentering coords={liveCoords} />}

          {/* Dark shadow */}
          <Polyline
            positions={fullRoute}
            pathOptions={{ color: '#0f172a', weight: 9, opacity: 0.5 }}
          />

          {/* Grey background (plan mode) */}
          {!liveMode && (
            <Polyline
              positions={fullRoute}
              pathOptions={{
                color: '#475569',
                weight: 5,
                opacity: interactionMode === 'analyze' ? 0.55 : (effectiveProgress < 1 ? 0.55 : 0),
              }}
            />
          )}

          {/* Plan / play: weather-colored before segments */}
          {!liveMode && interactionMode === 'play' && beforeSegments.map((seg) => (
            <Polyline
              key={`before-${seg.key}`}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 5, opacity: 1 }}
            />
          ))}

          {/* Plan / analyze: weather-colored inside-range segments */}
          {!liveMode && interactionMode === 'analyze' && analyzeInsideSegments.map((seg) => (
            <Polyline
              key={seg.key}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 5, opacity: 1 }}
            />
          ))}

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
            const dotColor =
              mapMode === 'wind' ? impactToColor(wp) : precipToColor(w?.precipProbability)
            const impact = w ? windImpact(w.windDirection, wp.bearing, w.windSpeedKmh) : null
            const { label: impactLabel, color: impactColor } = impact
              ? windImpactStyle(impact)
              : { label: '', color: '#94a3b8' }

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
                  <div style={{ minWidth: 160, lineHeight: 1.6 }}>
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
                        <p>🌡️ {w.temperatureC.toFixed(1)}°C</p>
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
            .map((wpt, i) => (
              <Marker key={`nwp-${i}`} position={[wpt.lat, wpt.lon]} icon={FLAG_ICON}>
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
            ))}

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

          {/* Live GPS position dot */}
          {liveMode && liveCoords && (
            <>
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={14}
                pathOptions={{ fillColor: '#38bdf8', color: 'transparent', fillOpacity: 0.25 }}
              />
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={7}
                pathOptions={{ fillColor: '#38bdf8', color: 'white', weight: 2.5, fillOpacity: 1 }}
              />
            </>
          )}
        </MapContainer>
      </div>

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
