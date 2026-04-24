import 'leaflet/dist/leaflet.css'
import { useState, useMemo, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import type { GpxTrack } from '../lib/gpx'
import type { EnrichedWaypoint } from '../lib/places'
import { formatTime } from '../lib/timing'
import { haversineKm } from '../lib/timing'
import { weatherLabel, windImpact, windImpactStyle, windDirectionLabel } from '../lib/weather'
import { precipToColor, impactToColor } from '../lib/mapColors'

export type MapMode = 'rain' | 'wind'

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

export function RouteMap({
  track,
  waypoints,
  mapMode,
  onMapModeChange,
  liveMode = false,
  liveCoords = null,
  liveProgress = 0,
}: Props) {
  const { points } = track

  const [progress, setProgress] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // ── Visible colored segments (truncated at targetKm) ──────────────────────
  const visibleSegments = useMemo(() => {
    if (effectiveProgress >= 1) {
      return allSegments.map((s) => ({ key: s.key, positions: s.pts, color: s.color }))
    }

    const result: { key: number; positions: [number, number][]; color: string }[] = []

    for (const seg of allSegments) {
      if (seg.startKm >= targetKm) break

      if (seg.endKm <= targetKm) {
        result.push({ key: seg.key, positions: seg.pts, color: seg.color })
        continue
      }

      // Partial segment: truncate with linear interpolation
      const truncated: [number, number][] = []
      for (let pi = seg.ptStart; pi <= seg.ptEnd; pi++) {
        if (cumKm[pi] > targetKm) {
          if (pi > seg.ptStart) {
            const span = cumKm[pi] - cumKm[pi - 1]
            if (span > 0) {
              const t = (targetKm - cumKm[pi - 1]) / span
              truncated.push([
                points[pi - 1].lat + t * (points[pi].lat - points[pi - 1].lat),
                points[pi - 1].lon + t * (points[pi].lon - points[pi - 1].lon),
              ])
            }
          }
          break
        }
        truncated.push([points[pi].lat, points[pi].lon])
      }

      if (truncated.length >= 2) {
        result.push({ key: seg.key, positions: truncated, color: seg.color })
      }
      break
    }

    return result
  }, [allSegments, effectiveProgress, targetKm, cumKm, points])

  // ── Visible waypoint markers ──────────────────────────────────────────────
  const visibleWaypoints = useMemo(() => {
    if (effectiveProgress >= 1) return waypoints
    return waypoints.filter((wp, i) => i === 0 || wp.distanceKm <= targetKm)
  }, [waypoints, effectiveProgress, targetKm])

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

  return (
    <div className="space-y-2">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-200">Mapa de ruta</h2>
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
          </div>
        </div>
      </div>

      {/* ── Progress row: slider (plan) or GPS bar (live) ── */}
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
      ) : (
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

          {/* Auto-center on GPS position in live mode */}
          {liveMode && <MapCentering coords={liveCoords} />}

          {/* Dark shadow for the full route */}
          <Polyline
            positions={fullRoute}
            pathOptions={{ color: '#0f172a', weight: 9, opacity: 0.5 }}
          />

          {/* Grey "pending" route */}
          <Polyline
            positions={fullRoute}
            pathOptions={{ color: '#475569', weight: 5, opacity: effectiveProgress < 1 ? 0.55 : 0 }}
          />

          {/* Colored segments */}
          {visibleSegments.length > 0
            ? visibleSegments.map((seg) => (
                <Polyline
                  key={`${seg.key}-${seg.color}`}
                  positions={seg.positions}
                  pathOptions={{ color: seg.color, weight: 5, opacity: 1 }}
                />
              ))
            : effectiveProgress >= 1 && (
                <Polyline
                  positions={fullRoute}
                  pathOptions={{ color: '#94a3b8', weight: 5, opacity: 0.9 }}
                />
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

          {/* Live GPS position markers */}
          {liveMode && liveCoords && (
            <>
              {/* Outer glow */}
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={14}
                pathOptions={{ fillColor: '#38bdf8', color: 'transparent', fillOpacity: 0.25 }}
              />
              {/* Inner solid dot */}
              <CircleMarker
                center={[liveCoords.lat, liveCoords.lon]}
                radius={7}
                pathOptions={{ fillColor: '#38bdf8', color: 'white', weight: 2.5, fillOpacity: 1 }}
              />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
