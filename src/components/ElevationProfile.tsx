import { memo, useMemo } from 'react'
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

/**
 * Elevation profile — a "Capa 1" (track-only) view that renders as soon as a
 * GPX is loaded, in parallel to the map. It needs no pace and no start time:
 * just the track geometry.
 *
 * The silhouette is colour-coded by gradient (descents cool, climbs warm) via
 * an SVG linear gradient whose stops follow the route, mirroring how the map
 * colour-codes the route by a variable. POIs and cut-offs are marked at their
 * km, and the analyze-range selection is highlighted in sync with the map.
 *
 * Weather overlays (temperature, precipitation, …) are intentionally NOT here:
 * those are Capa 2 and live in WeatherCharts. A later phase can fold them in as
 * selectable overlays on this same profile.
 */

interface Props {
  track: GpxTrack
  /** POIs to mark on the profile (amber dot; red when they carry a cut-off). */
  namedWaypoints?: GpxNamedWaypoint[]
  /** Selected analyze range (km). Highlighted as a band, synced with the map. */
  analyzeRange?: { from: number; to: number } | null
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

// Auto-scaling to [min,max] makes a near-flat route look mountainous. Enforce a
// minimum visible span so flat looks flat (same rationale as WeatherCharts).
const ELE_MIN_SPAN_M = 400
const MAX_SAMPLES = 320

/** Signed gradient (%) → colour. Descents cool, climbs warm. */
function gradeColor(g: number): string {
  if (g <= -9) return '#2563eb'    // steep descent
  if (g <= -4) return '#60a5fa'
  if (g < -1.5) return '#93c5fd'
  if (g <= 1.5) return '#64748b'   // flat — slate
  if (g <= 4) return '#fbbf24'     // gentle climb
  if (g <= 8) return '#f97316'
  if (g <= 12) return '#ef4444'
  return '#b91c1c'                 // very steep climb
}

interface Datum { km: number; ele: number; grade: number }

function ProfileTooltip({ active, payload }: { active?: boolean; payload?: { payload: Datum }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div style={TOOLTIP_STYLE}>
      <div className="text-slate-200 font-mono">{p.km.toFixed(1)} km</div>
      <div className="text-slate-400">
        {p.ele} m · {p.grade >= 0 ? '+' : ''}{p.grade.toFixed(1)}%
      </div>
    </div>
  )
}

export const ElevationProfile = memo(function ElevationProfile({
  track,
  namedWaypoints = [],
  analyzeRange = null,
}: Props) {
  const { points, cumKm } = track
  const total = track.totalDistanceKm

  // Downsample to ~MAX_SAMPLES evenly-spaced points. The coarser spacing also
  // smooths the per-segment gradient, damping GPS-altitude noise spikes.
  const data = useMemo<Datum[]>(() => {
    if (points.length < 2) return []
    const step = Math.max(1, Math.ceil(points.length / MAX_SAMPLES))
    const idx: number[] = []
    for (let i = 0; i < points.length; i += step) idx.push(i)
    if (idx[idx.length - 1] !== points.length - 1) idx.push(points.length - 1)
    return idx.map((i, k) => {
      const prev = k > 0 ? idx[k - 1] : i
      const dEle = points[i].ele - points[prev].ele
      const dM = Math.max(1, (cumKm[i] - cumKm[prev]) * 1000)
      return { km: cumKm[i], ele: Math.round(points[i].ele), grade: k > 0 ? (dEle / dM) * 100 : 0 }
    })
  }, [points, cumKm])

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

  if (data.length < 2) return null

  const gradId = 'elev-grade-fill'

  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
          Perfil de altura
        </h3>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="text-orange-400">+{Math.round(track.elevGainM)} m</span>
          <span className="text-blue-400">−{Math.round(track.elevLossM)} m</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              {data.map((d, i) => (
                <stop
                  key={i}
                  offset={`${total > 0 ? (d.km / total) * 100 : 0}%`}
                  stopColor={gradeColor(d.grade)}
                />
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
          <Tooltip content={<ProfileTooltip />} />
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

      {/* Gradient + marker legend */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-500">
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
