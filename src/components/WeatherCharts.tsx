import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { EnrichedWaypoint } from '../lib/places'
import { formatTime } from '../lib/timing'
import { windImpact, windImpactStyle } from '../lib/weather'

export interface AnalyzeRange {
  from: number
  to: number
}

interface Props {
  waypoints: EnrichedWaypoint[]
  range?: AnalyzeRange | null
  onClearRange?: () => void
}

const GRID_COLOR = '#1e293b'
const TICK_STYLE = { fill: '#64748b', fontSize: 11 }
const TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
}

// Custom dot: coloreado según impacto del viento
function WindDot(props: { cx?: number; cy?: number; payload?: { windImpactColor: string } }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={payload?.windImpactColor ?? '#a78bfa'}
      stroke="#0f172a"
      strokeWidth={1}
    />
  )
}

export function WeatherCharts({ waypoints, range, onClearRange }: Props) {
  const data = waypoints
    .filter((w) => w.weather !== null)
    .map((w) => {
      const impact = windImpact(w.weather!.windDirection, w.bearing, w.weather!.windSpeedKmh)
      const { color } = windImpactStyle(impact)
      return {
        km: w.distanceKm,
        kmLabel: `${w.distanceKm.toFixed(1)}`,
        hora: formatTime(w.estimatedTime),
        temp: parseFloat(w.weather!.temperatureC.toFixed(1)),
        precip: w.weather!.precipProbability,
        precipMm: parseFloat(w.weather!.precipMm.toFixed(1)),
        wind: Math.round(w.weather!.windSpeedKmh),
        windImpactColor: color,
        ele: Math.round(w.ele),
      }
    })

  if (data.length === 0) return null

  // ── Range filtering (include one adjacent point each side as boundary) ───────
  const chartData = (() => {
    if (!range || data.length < 2) return data

    // Last index with km ≤ range.from (left boundary / adjacent point)
    let startIdx = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i].km <= range.from) startIdx = i
    }
    // First index with km ≥ range.to (right boundary / adjacent point)
    let endIdx = data.length - 1
    for (let i = 0; i < data.length; i++) {
      if (data[i].km >= range.to) { endIdx = i; break }
    }

    if (startIdx > endIdx) return data
    const slice = data.slice(startIdx, endIdx + 1)
    return slice.length >= 2 ? slice : data
  })()

  const isFiltered = range != null && chartData !== data

  return (
    <div className="space-y-4">
      {/* ── Range chip ── */}
      {isFiltered && (
        <div className="flex items-center gap-2 px-1">
          <span className="inline-flex items-center gap-2 bg-sky-900/30 border border-sky-700/50 text-sky-400 text-xs px-3 py-1 rounded-full">
            🔍 Tramo {range!.from.toFixed(1)}–{range!.to.toFixed(1)} km
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

      {/* Temperatura + altitud */}
      <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-4">
          Temperatura y altitud
        </h3>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis
              dataKey="kmLabel"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v} km`}
              interval="preserveStartEnd"
            />
            <YAxis yAxisId="ele" orientation="right" tick={TICK_STYLE} tickFormatter={(v) => `${v}m`} width={45} />
            <YAxis yAxisId="temp" tick={TICK_STYLE} tickFormatter={(v) => `${v}°`} width={35} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as typeof data[0] | undefined
                return p ? `${p.kmLabel} km · ${p.hora}` : ''
              }}
              formatter={(value, name) => {
                if (name === 'Altitud') return [`${value} m`, name as string]
                if (name === 'Temperatura') return [`${value}°C`, name as string]
                return [`${value}`, name as string]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            <Area
              yAxisId="ele"
              type="monotone"
              dataKey="ele"
              name="Altitud"
              fill="#1e293b"
              stroke="#334155"
              strokeWidth={1}
              dot={false}
              fillOpacity={1}
            />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temp"
              name="Temperatura"
              stroke="#f97316"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Lluvia + viento */}
      <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">
          Probabilidad de lluvia y viento
        </h3>
        {/* Leyenda de impacto de viento */}
        <div className="flex items-center gap-3 mb-3 text-xs text-slate-500 flex-wrap">
          <span>Impacto viento:</span>
          {(['tailwind', 'crosswind', 'headwind', 'calm'] as const).map((imp) => {
            const { label, color } = windImpactStyle(imp)
            return (
              <span key={imp} className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full border border-slate-700" style={{ background: color }} />
                {label}
              </span>
            )
          })}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis
              dataKey="kmLabel"
              tick={TICK_STYLE}
              tickFormatter={(v) => `${v} km`}
              interval="preserveStartEnd"
            />
            <YAxis yAxisId="precip" domain={[0, 100]} tick={TICK_STYLE} tickFormatter={(v) => `${v}%`} width={44} />
            <YAxis yAxisId="wind" orientation="right" tick={TICK_STYLE} tickFormatter={(v) => `${v} km/h`} width={58} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as typeof data[0] | undefined
                return p ? `${p.kmLabel} km · ${p.hora}` : ''
              }}
              formatter={(value, name) => {
                if (name === 'Lluvia') return [`${value}%`, name as string]
                if (name === 'Viento') return [`${value} km/h`, name as string]
                return [`${value}`, name as string]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            <Bar
              yAxisId="precip"
              dataKey="precip"
              name="Lluvia"
              fill="#38bdf8"
              fillOpacity={0.8}
              radius={[3, 3, 0, 0]}
            />
            <Line
              yAxisId="wind"
              type="monotone"
              dataKey="wind"
              name="Viento"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={<WindDot />}
              activeDot={{ r: 5, fill: '#a78bfa' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
