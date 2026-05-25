import { memo, useMemo, useRef } from 'react'
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
import type { ViewMode } from '../lib/viewMode'
import { precipToColor, impactToColor, gradeToColor, tempToColor } from '../lib/mapColors'
import { windImpactStyle } from '../lib/weather'
import type { TerrainType } from '../lib/terrain'
import { TERRAIN_META } from '../lib/terrain'
import type { PollenData, PollenType } from '../lib/pollen'
import { pollenLevelColor, pollenLevelStyle, POLLEN_META } from '../lib/pollen'
import type { DaylightBand } from '../lib/daylight'
import { bandAt } from '../lib/daylight'

/**
 * Elevation profile — a route "canvas" parallel to the map. The silhouette is
 * recoloured by the *shared* view mode (the same selector drives the map), so
 * both views always show the same variable. Daylight is drawn as background
 * bands behind the silhouette; everything else recolours the silhouette itself.
 */

const DAYLIGHT_COLOR: Record<DaylightBand, string> = {
  day: '#fbbf24',
  civil: '#c2410c',
  night: '#1e1b4b',
}

interface Props {
  track: GpxTrack
  mode: ViewMode
  /** POIs to mark (amber dot; red when they carry a cut-off). */
  namedWaypoints?: GpxNamedWaypoint[]
  /** Selected analyze range (km). Highlighted as a band, synced with the map. */
  analyzeRange?: { from: number; to: number } | null
  /** Reports the km under the cursor so the map can show a matching marker. */
  onHoverKm?: (km: number | null) => void
  /** Enriched waypoints (weather + ETA). Drives temp/rain/wind/pollen/daylight. */
  waypoints?: EnrichedWaypoint[]
  /** Per-track-point terrain types (for the terrain mode). */
  pointTerrains?: TerrainType[]
  /** Per-waypoint pollen data (for the pollen mode). */
  pollenData?: (PollenData | null)[]
  /** Selected pollen species (chosen on the map; shared). */
  pollenType?: PollenType
  /** Sun-position anchor for the daylight bands. */
  daylightAnchor?: { lat: number; lon: number }
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

interface Datum {
  km: number
  ele: number
  grade: number
  pointIdx: number
  temp: number | null
  precip: number | null
  windKmh: number | null
  windColor: string | null
  nearestWpIdx: number
  etaMs: number | null
}

function ProfileTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean
  payload?: { payload: Datum }[]
  mode?: ViewMode
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  let extra: string | null = null
  if (mode === 'temp' && p.temp != null) extra = `🌡️ ${Math.round(p.temp)}°C`
  else if (mode === 'rain' && p.precip != null) extra = `🌧️ ${Math.round(p.precip)}%`
  else if (mode === 'wind' && p.windKmh != null) extra = `💨 ${Math.round(p.windKmh)} km/h`
  else if (mode === 'daylight' && p.etaMs != null) {
    extra = `🕘 ${new Date(p.etaMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
  }
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
  mode,
  namedWaypoints = [],
  analyzeRange = null,
  onHoverKm,
  waypoints = [],
  pointTerrains,
  pollenData,
  pollenType = 'grass',
  daylightAnchor,
}: Props) {
  const { points, cumKm } = track
  const total = track.totalDistanceKm

  // De-dupe hover reports: recharts fires onMouseMove often, and each change
  // re-renders the (heavy) map. Only report when the km changes by ≥ 0.1.
  const lastHover = useRef<number | null>(null)
  const reportHover = (km: number | null) => {
    if (km != null) km = Math.round(km * 10) / 10
    if (km === lastHover.current) return
    lastHover.current = km
    onHoverKm?.(km)
  }

  // Weather waypoints (sorted by km), prepared for interpolation.
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

  // All waypoints' km + ETA (for pollen nearest-lookup and daylight bands).
  const wpAll = useMemo(
    () => ({
      km: waypoints.map((w) => w.distanceKm),
      eta: waypoints.map((w) => w.estimatedTime?.getTime() ?? NaN),
    }),
    [waypoints],
  )

  // Downsample to ~MAX_SAMPLES evenly-spaced points (also smooths the gradient),
  // and attach the interpolated weather / ETA + nearest-waypoint index per sample.
  const data = useMemo<Datum[]>(() => {
    if (points.length < 2) return []
    const step = Math.max(1, Math.ceil(points.length / MAX_SAMPLES))
    const idx: number[] = []
    for (let i = 0; i < points.length; i += step) idx.push(i)
    if (idx[idx.length - 1] !== points.length - 1) idx.push(points.length - 1)
    const nW = wx.km.length
    const nA = wpAll.km.length
    return idx.map((i, k) => {
      const prev = k > 0 ? idx[k - 1] : i
      const dEle = points[i].ele - points[prev].ele
      const dM = Math.max(1, (cumKm[i] - cumKm[prev]) * 1000)
      const km = cumKm[i]

      // Weather interpolation (over weather-bearing waypoints)
      let temp: number | null = null, precip: number | null = null
      let windKmh: number | null = null, windColor: string | null = null
      if (nW > 0) {
        let j = 0
        while (j < nW - 1 && wx.km[j + 1] <= km) j++
        const j1 = Math.min(j + 1, nW - 1)
        const span = wx.km[j1] - wx.km[j]
        const t = span > 0 ? Math.max(0, Math.min(1, (km - wx.km[j]) / span)) : 0
        temp = wx.temp[j] + t * (wx.temp[j1] - wx.temp[j])
        precip = wx.precip[j] + t * (wx.precip[j1] - wx.precip[j])
        windKmh = wx.windKmh[j] + t * (wx.windKmh[j1] - wx.windKmh[j])
        windColor = t < 0.5 ? wx.windColor[j] : wx.windColor[j1]
      }

      // Nearest waypoint (for pollen) + ETA interpolation (for daylight)
      let nearestWpIdx = 0
      let etaMs: number | null = null
      if (nA > 0) {
        let j = 0
        while (j < nA - 1 && wpAll.km[j + 1] <= km) j++
        const j1 = Math.min(j + 1, nA - 1)
        const span = wpAll.km[j1] - wpAll.km[j]
        const t = span > 0 ? Math.max(0, Math.min(1, (km - wpAll.km[j]) / span)) : 0
        nearestWpIdx = t < 0.5 ? j : j1
        if (!Number.isNaN(wpAll.eta[j]) && !Number.isNaN(wpAll.eta[j1])) {
          etaMs = wpAll.eta[j] + t * (wpAll.eta[j1] - wpAll.eta[j])
        }
      }

      return { km, ele: Math.round(points[i].ele), grade: k > 0 ? (dEle / dM) * 100 : 0, pointIdx: i, temp, precip, windKmh, windColor, nearestWpIdx, etaMs }
    })
  }, [points, cumKm, wx, wpAll])

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
  // Daylight keeps the slope silhouette (it shows as background bands instead).
  const stops = useMemo(() => {
    return data.map((d) => {
      let color: string
      if (mode === 'temp' && d.temp != null) color = tempToColor(d.temp)
      else if (mode === 'rain' && d.precip != null) color = precipToColor(d.precip)
      else if (mode === 'wind' && d.windColor) color = d.windColor
      else if (mode === 'terrain' && pointTerrains && pointTerrains[d.pointIdx]) {
        color = TERRAIN_META[pointTerrains[d.pointIdx]].color
      } else if (mode === 'pollen' && pollenData) {
        color = pollenLevelColor(pollenType, pollenData[d.nearestWpIdx]?.[pollenType] ?? null)
      } else color = gradeToColor(d.grade)
      return { offset: total > 0 ? (d.km / total) * 100 : 0, color }
    })
  }, [data, mode, total, pointTerrains, pollenData, pollenType])

  // Daylight background bands: runs of constant band along the route.
  const daylightBands = useMemo(() => {
    if (mode !== 'daylight' || !daylightAnchor || data.length < 2) return []
    const bandFor = (etaMs: number | null): DaylightBand | null =>
      etaMs == null ? null : bandAt(new Date(etaMs), daylightAnchor.lat, daylightAnchor.lon)
    const out: { from: number; to: number; band: DaylightBand }[] = []
    let runStart = data[0].km
    let runBand = bandFor(data[0].etaMs)
    for (let i = 1; i < data.length; i++) {
      const b = bandFor(data[i].etaMs)
      if (b !== runBand) {
        if (runBand) out.push({ from: runStart, to: data[i].km, band: runBand })
        runStart = data[i].km
        runBand = b
      }
    }
    if (runBand) out.push({ from: runStart, to: data[data.length - 1].km, band: runBand })
    return out
  }, [mode, data, daylightAnchor])

  if (data.length < 2) return null

  const gradId = 'elev-fill'

  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
          Perfil de altura
        </h3>
        <span className="flex items-center gap-2 text-[11px] font-mono">
          <span className="text-orange-400">+{Math.round(track.elevGainM)} m</span>
          <span className="text-blue-400">−{Math.round(track.elevLossM)} m</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
          onMouseMove={(s) => {
            // recharts v3: handler gets MouseHandlerDataParam (no activePayload).
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
          <Tooltip content={<ProfileTooltip mode={mode} />} />
          {/* Daylight background bands (behind the silhouette) */}
          {daylightBands.map((b, i) => (
            <ReferenceArea
              key={`dl-${i}`}
              x1={b.from}
              x2={b.to}
              fill={DAYLIGHT_COLOR[b.band]}
              fillOpacity={b.band === 'day' ? 0.1 : b.band === 'civil' ? 0.18 : 0.28}
              stroke="none"
            />
          ))}
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

      {/* Legend — follows the active mode */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-500">
        {mode === 'slope' && (
          <>
            <span>Pendiente:</span>
            {([['#2563eb', 'bajada'], ['#64748b', 'llano'], ['#fbbf24', 'suave'], ['#f97316', 'fuerte'], ['#b91c1c', 'muy fuerte']] as const).map(([c, l]) => (
              <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </>
        )}
        {mode === 'temp' && (
          <>
            <span>Temperatura:</span>
            {([['#1d4ed8', '≤0°'], ['#22d3ee', '~10°'], ['#22c55e', '~16°'], ['#fbbf24', '~22°'], ['#f97316', '~28°'], ['#b91c1c', '35°+']] as const).map(([c, l]) => (
              <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </>
        )}
        {mode === 'rain' && (
          <>
            <span>Prob. lluvia:</span>
            {([['#22c55e', '0–20%'], ['#eab308', '20–40%'], ['#f97316', '40–60%'], ['#ef4444', '60–80%'], ['#7c3aed', '80%+']] as const).map(([c, l]) => (
              <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </>
        )}
        {mode === 'wind' && (
          <>
            <span>Viento:</span>
            {(['tailwind', 'crosswind', 'headwind', 'calm'] as const).map((imp) => {
              const { label, color } = windImpactStyle(imp)
              return <span key={imp} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />{label}</span>
            })}
          </>
        )}
        {mode === 'terrain' && pointTerrains && (
          <>
            <span>Firme:</span>
            {Array.from(new Set(pointTerrains.filter((t) => t !== 'unknown'))).map((t) => (
              <span key={t} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: TERRAIN_META[t].color }} />{TERRAIN_META[t].label}</span>
            ))}
          </>
        )}
        {mode === 'pollen' && (
          <>
            <span>{POLLEN_META[pollenType].emoji} {POLLEN_META[pollenType].name}:</span>
            {([1, 2, 3, 4] as const).map((lvl) => {
              const { label, color } = pollenLevelStyle(lvl)
              return <span key={lvl} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: color }} />{label}</span>
            })}
          </>
        )}
        {mode === 'daylight' && (
          <>
            <span>Luz:</span>
            {([['day', 'Día'], ['civil', 'Crepúsculo'], ['night', 'Noche']] as const).map(([b, l]) => (
              <span key={b} className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: DAYLIGHT_COLOR[b] }} />{l}</span>
            ))}
          </>
        )}
        {namedWaypoints.length > 0 && (
          <>
            <span className="ml-1 flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#f59e0b' }} />POI</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />corte</span>
          </>
        )}
      </div>
    </div>
  )
})
