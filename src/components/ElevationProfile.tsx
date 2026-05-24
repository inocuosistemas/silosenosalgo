import { memo, useMemo, useRef, useState } from 'react'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceDot,
} from 'recharts'
import type { GpxTrack, GpxNamedWaypoint } from '../lib/gpx'
import type { EnrichedWaypoint } from '../lib/places'
import { precipToColor, impactToColor } from '../lib/mapColors'
import { windImpactStyle } from '../lib/weather'

/**
 * Elevation profile — a route "canvas" parallel to the map.
 *
 * Capa 1 (track-only, always): the silhouette coloured by gradient, POI/cut-off
 * markers, analyze-range highlight, and hover→map sync.
 *
 * Capa 2 (once the forecast exists): a mode selector — like the map's — recolours
 * the same silhouette by temperature / rain / wind. One overlay at a time, using
 * the same colour scales as the map (precipToColor, impactToColor) so both views
 * share a visual language. The weather modes appear only when weather data is
 * present; pre-plan only "Pendiente" is shown.
 */

type ProfileMode = 'slope' | 'temp' | 'rain' | 'wind'

interface Props {
  track: GpxTrack
  /** POIs to mark on the profile (amber dot; red when they carry a cut-off). */
  namedWaypoints?: GpxNamedWaypoint[]
  /** Selected analyze range (km). Highlighted as a band, synced with the map. */
  analyzeRange?: { from: number; to: number } | null
  /** Reports the km under the cursor so the map can show a matching marker. */
  onHoverKm?: (km: number | null) => void
  /** Enriched waypoints (weather + bearing). Drives the Capa 2 colour overlays. */
  waypoints?: EnrichedWaypoint[]
}

const GRID_COLOR = '#1e293b'
const TICK_STYLE = { fill: '#64748b', fontSize: 11 }
const TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
  padding: '6px 10px',
}

const ELE_MIN_SPAN_M = 400
const MAX_SAMPLES = 320

/** Signed gradient (%) → colour. Descents cool, climbs warm. */
function gradeColor(g: number): string {
  if (g <= -9) return '#2563eb'
  if (g <= -4) return '#60a5fa'
  if (g < -1.5) return '#93c5fd'
  if (g <= 1.5) return '#64748b'
  if (g <= 4) return '#fbbf24'
  if (g <= 8) return '#f97316'
  if (g <= 12) return '#ef4444'
  return '#b91c1c'
}

/** Temperature (°C) → colour. Cold blue → hot red. */
function tempColor(t: number): string {
  if (t <= 0) return '#1d4ed8'
  if (t <= 6) return '#3b82f6'
  if (t <= 12) return '#22d3ee'
  if (t <= 18) return '#22c55e'
  if (t <= 24) return '#fbbf24'
  if (t <= 30) return '#f97316'
  if (t <= 35) return '#ef4444'
  return '#b91c1c'
}

interface Datum {
  km: number
  ele: number
  grade: number
  temp: number | null
  precip: number | null
  windKmh: number | null
  windColor: string | null
}

const MODE_LABEL: Record<ProfileMode, string> = {
  slope: '⛰️ Pendiente',
  temp: '🌡️ Temp',
  rain: '🌧️ Lluvia',
  wind: '💨 Viento',
}

function ProfileTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean
  payload?: { payload: Datum }[]
  mode?: ProfileMode
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  let extra: string | null = null
  if (mode === 'temp' && p.temp != null) extra = `🌡️ ${Math.round(p.temp)}°C`
  else if (mode === 'rain' && p.precip != null) extra = `🌧️ ${Math.round(p.precip)}%`
  else if (mode === 'wind' && p.windKmh != null) extra = `💨 ${Math.round(p.windKmh)} km/h`
  return (
    <div style={TOOLTIP_STYLE}>
      <div className="text-slate-200 font-mono">{p.km.toFixed(1)} km</div>
      <div className="text-slate-400">
        {p.ele} m · {p.grade >= 0 ? '+' : ''}{p.grade.toFixed(1)}%
      </div>
      {extra && <div className="text-slate-300 mt-0.5">{extra}</div>}
    </div>
  )
}

export const ElevationProfile = memo(function ElevationProfile({
  track,
  namedWaypoints = [],
  analyzeRange = null,
  onHoverKm,
  waypoints = [],
}: Props) {
  const { points, cumKm } = track
  const total = track.totalDistanceKm

  const [mode, setMode] = useState<ProfileMode>('slope')
  const weatherAvailable = waypoints.some((w) => w.weather != null)
  // Fall back to the track-only mode whenever weather isn't (yet) available.
  const activeMode: ProfileMode = weatherAvailable ? mode : 'slope'

  // De-dupe hover reports: recharts fires onMouseMove often, and each change
  // re-renders the (heavy) map. Only report when the km changes by ≥ 0.1.
  const lastHover = useRef<number | null>(null)
  const reportHover = (km: number | null) => {
    if (km != null) km = Math.round(km * 10) / 10
    if (km === lastHover.current) return
    lastHover.current = km
    onHoverKm?.(km)
  }

  // Weather sampled at waypoints (sorted by km), prepared once for interpolation.
  const wx = useMemo(() => {
    const ww = waypoints.filter((w) => w.weather != null)
    return {
      km: ww.map((w) => w.distanceKm),
      temp: ww.map((w) => w.weather!.temperatureC),
      precip: ww.map((w) => w.weather!.precipProbability),
      windKmh: ww.map((w) => w.weather!.windSpeedKmh),
      windColor: ww.map((w) => impactToColor(w)),
    }
  }, [waypoints])

  // Downsample to ~MAX_SAMPLES evenly-spaced points (also smooths the gradient),
  // then interpolate the weather variables at each sample's km.
  const data = useMemo<Datum[]>(() => {
    if (points.length < 2) return []
    const step = Math.max(1, Math.ceil(points.length / MAX_SAMPLES))
    const idx: number[] = []
    for (let i = 0; i < points.length; i += step) idx.push(i)
    if (idx[idx.length - 1] !== points.length - 1) idx.push(points.length - 1)
    const n = wx.km.length
    return idx.map((i, k) => {
      const prev = k > 0 ? idx[k - 1] : i
      const dEle = points[i].ele - points[prev].ele
      const dM = Math.max(1, (cumKm[i] - cumKm[prev]) * 1000)
      const km = cumKm[i]
      let temp: number | null = null
      let precip: number | null = null
      let windKmh: number | null = null
      let windColor: string | null = null
      if (n > 0) {
        let j = 0
        while (j < n - 1 && wx.km[j + 1] <= km) j++
        const j1 = Math.min(j + 1, n - 1)
        const span = wx.km[j1] - wx.km[j]
        const t = span > 0 ? Math.max(0, Math.min(1, (km - wx.km[j]) / span)) : 0
        temp = wx.temp[j] + t * (wx.temp[j1] - wx.temp[j])
        precip = wx.precip[j] + t * (wx.precip[j1] - wx.precip[j])
        windKmh = wx.windKmh[j] + t * (wx.windKmh[j1] - wx.windKmh[j])
        windColor = t < 0.5 ? wx.windColor[j] : wx.windColor[j1]
      }
      return { km, ele: Math.round(points[i].ele), grade: k > 0 ? (dEle / dM) * 100 : 0, temp, precip, windKmh, windColor }
    })
  }, [points, cumKm, wx])

  const eleDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, ELE_MIN_SPAN_M]
    const eles = data.map((d) => d.ele)
    const eMin = Math.min(...eles)
    const eMax = Math.max(...eles)
    const relief = eMax - eMin
    const pad = Math.max(20, relief * 0.15)
    let lo: number, hi: number
    if (relief + 2 * pad >= ELE_MIN_SPAN_M) {
      lo = eMin - pad; hi = eMax + pad
    } else {
      const extra = (ELE_MIN_SPAN_M - relief) / 2
      lo = eMin - extra; hi = eMax + extra
    }
    lo = Math.max(0, Math.floor(lo / 50) * 50)
    hi = Math.ceil(hi / 50) * 50
    return [lo, hi]
  }, [data])

  // Per-sample fill colour for the active mode → SVG gradient stops along the route.
  const stops = useMemo(() => {
    return data.map((d) => {
      let color: string
      if (activeMode === 'temp' && d.temp != null) color = tempColor(d.temp)
      else if (activeMode === 'rain' && d.precip != null) color = precipToColor(d.precip)
      else if (activeMode === 'wind' && d.windColor) color = d.windColor
      else color = gradeColor(d.grade)
      return { offset: total > 0 ? (d.km / total) * 100 : 0, color }
    })
  }, [data, activeMode, total])

  if (data.length < 2) return null

  const gradId = 'elev-fill'

  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
          Perfil de altura
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode selector (weather modes appear only when forecast data exists) */}
          {weatherAvailable && (
            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px]">
              {(['slope', 'temp', 'rain', 'wind'] as ProfileMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 transition-colors ${
                    activeMode === m ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
          <span className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-orange-400">+{Math.round(track.elevGainM)} m</span>
            <span className="text-blue-400">−{Math.round(track.elevLossM)} m</span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
          onMouseMove={(s) => {
            // recharts v3: the chart handler gets MouseHandlerDataParam (no
            // activePayload). Resolve the hovered km from the active index, with
            // the numeric x-axis value (activeLabel) as fallback; both coerced.
            const i = Number(s.activeTooltipIndex)
            const lbl = Number(s.activeLabel)
            const km =
              Number.isInteger(i) && data[i] ? data[i].km
              : Number.isFinite(lbl) ? lbl
              : null
            reportHover(km)
          }}
          onMouseLeave={() => reportHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              {stops.map((s, i) => (
                <stop key={i} offset={`${s.offset}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            type="number"
            dataKey="km"
            domain={[0, total]}
            tick={TICK_STYLE}
            tickFormatter={(v) => `${Math.round(v)} km`}
            allowDecimals={false}
          />
          <YAxis
            orientation="right"
            domain={eleDomain}
            tick={TICK_STYLE}
            tickFormatter={(v) => `${v}m`}
            width={45}
            allowDecimals={false}
          />
          <Tooltip content={<ProfileTooltip mode={activeMode} />} />
          {analyzeRange && (
            <ReferenceArea
              x1={analyzeRange.from}
              x2={analyzeRange.to}
              fill="#38bdf8"
              fillOpacity={0.12}
              stroke="#38bdf8"
              strokeOpacity={0.4}
            />
          )}
          <Area
            type="monotone"
            dataKey="ele"
            stroke="#475569"
            strokeWidth={1}
            fill={`url(#${gradId})`}
            fillOpacity={0.9}
            dot={false}
            isAnimationActive={false}
          />
          {namedWaypoints.map((w, i) => {
            const idx = Math.max(0, Math.min(points.length - 1, w.nearestTrackIndex))
            const isCut = !!w.cutoffWallClock
            return (
              <ReferenceDot
                key={i}
                x={Math.max(0, Math.min(total, w.distanceKm))}
                y={Math.round(points[idx].ele)}
                r={3.5}
                fill={isCut ? '#ef4444' : '#f59e0b'}
                stroke="#0f172a"
                strokeWidth={1}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend — adapts to the active mode */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-500">
        {activeMode === 'slope' && (
          <>
            <span>Pendiente:</span>
            {([
              ['#2563eb', 'bajada'],
              ['#64748b', 'llano'],
              ['#fbbf24', 'suave'],
              ['#f97316', 'fuerte'],
              ['#b91c1c', 'muy fuerte'],
            ] as const).map(([color, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />
                {label}
              </span>
            ))}
          </>
        )}
        {activeMode === 'temp' && (
          <>
            <span>Temperatura:</span>
            {([
              ['#1d4ed8', '≤0°'],
              ['#22d3ee', '~10°'],
              ['#22c55e', '~16°'],
              ['#fbbf24', '~22°'],
              ['#f97316', '~28°'],
              ['#b91c1c', '35°+'],
            ] as const).map(([color, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />
                {label}
              </span>
            ))}
          </>
        )}
        {activeMode === 'rain' && (
          <>
            <span>Prob. lluvia:</span>
            {([
              ['#22c55e', '0–20%'],
              ['#eab308', '20–40%'],
              ['#f97316', '40–60%'],
              ['#ef4444', '60–80%'],
              ['#7c3aed', '80%+'],
            ] as const).map(([color, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />
                {label}
              </span>
            ))}
          </>
        )}
        {activeMode === 'wind' && (
          <>
            <span>Viento:</span>
            {(['tailwind', 'crosswind', 'headwind', 'calm'] as const).map((imp) => {
              const { label, color } = windImpactStyle(imp)
              return (
                <span key={imp} className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />
                  {label}
                </span>
              )
            })}
          </>
        )}
        {namedWaypoints.length > 0 && (
          <>
            <span className="ml-1 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#f59e0b' }} />
              POI
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />
              corte
            </span>
          </>
        )}
      </div>
    </div>
  )
})
