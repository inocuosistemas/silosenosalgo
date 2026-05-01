import { useMemo } from 'react'
import type { EnrichedWaypoint, EnrichedNamedWaypoint } from '../lib/places'
import { weatherLabel, windImpact, windImpactStyle, windDirectionLabel } from '../lib/weather'
import { formatTime, formatDuration, splitHoursMinutes } from '../lib/timing'

interface Props {
  waypoints: EnrichedWaypoint[]
  namedWaypoints?: EnrichedNamedWaypoint[]
  startTime: Date
  onSetCutoff?: (lat: number, lon: number, time: Date | null) => void
}

type TableRow =
  | { kind: 'computed'; wp: EnrichedWaypoint; idx: number }
  | { kind: 'gpx-wpt'; wpt: EnrichedNamedWaypoint }

const PLACE_TYPE_LABEL: Record<string, string> = {
  city: 'Ciudad',
  town: 'Ciudad',
  village: 'Pueblo',
  hamlet: 'Aldea',
}

function gradeColor(g: number) {
  if (g > 15) return 'text-red-400'
  if (g > 8) return 'text-orange-400'
  if (g > 3) return 'text-yellow-400'
  if (g < -8) return 'text-blue-400'
  return 'text-slate-400'
}

function precipColor(p: number) {
  if (p >= 70) return 'text-blue-400 font-semibold'
  if (p >= 40) return 'text-sky-400'
  return 'text-slate-400'
}

function tempColor(t: number) {
  if (t >= 30) return 'text-red-400'
  if (t >= 20) return 'text-orange-400'
  if (t >= 10) return 'text-yellow-300'
  if (t >= 0) return 'text-sky-300'
  return 'text-blue-400'
}

/** Format a Date as "HH:MM" for an <input type="time"> */
function cutoffToTimeStr(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/**
 * Parse "HH:MM" anchored to `anchorTime` (the waypoint's estimated arrival).
 * We snap HH:MM to the same calendar day as the anchor, then shift ±1 day
 * if the result is more than 12 h away — this handles any day offset
 * without an upper limit, making it safe for multi-day ultra routes.
 */
function cutoffFromTimeStr(timeStr: string, anchorTime: Date): Date {
  const [hStr, mStr] = timeStr.split(':')
  const d = new Date(anchorTime)
  d.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0)
  const diffMs = d.getTime() - anchorTime.getTime()
  if (diffMs >  12 * 3_600_000) d.setDate(d.getDate() - 1)
  if (diffMs < -12 * 3_600_000) d.setDate(d.getDate() + 1)
  return d
}

/**
 * How many calendar days after `startTime` does `cutoff` fall?
 * Day 0 = same day as start, Day 1 = next day, etc.
 */
function dayOffset(cutoff: Date, startTime: Date): number {
  const startMidnight = new Date(startTime)
  startMidnight.setHours(0, 0, 0, 0)
  const cutoffMidnight = new Date(cutoff)
  cutoffMidnight.setHours(0, 0, 0, 0)
  return Math.round((cutoffMidnight.getTime() - startMidnight.getTime()) / 86_400_000)
}

/** Shows "+1d", "+2d" etc. next to a cut-off time when it falls on a later calendar day. */
function DayBadge({ cutoff, startTime }: { cutoff: Date; startTime: Date }) {
  const offset = dayOffset(cutoff, startTime)
  if (offset <= 0) return null
  return (
    <span className="text-[10px] font-mono text-slate-400 leading-none select-none" title={`Día ${offset + 1} de ruta`}>
      +{offset}d
    </span>
  )
}

/** Default cut-off = estimated arrival + 1 h, rounded to nearest 5 min. */
function defaultCutoff(estimatedTime: Date | null, startTime: Date): Date {
  const base = new Date((estimatedTime ?? startTime).getTime() + 60 * 60 * 1000)
  base.setMinutes(Math.round(base.getMinutes() / 5) * 5, 0, 0)
  return base
}

function CutoffBadge({ min }: { min: number }) {
  const { h, m } = splitHoursMinutes(Math.abs(min))
  const t = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  const label = min >= 0 ? `+${t}` : `−${t}`
  const cls = min >= 20 ? 'text-green-400' : min >= 0 ? 'text-amber-400' : 'text-red-400'
  const dotCls = min >= 20 ? 'bg-green-400' : min >= 0 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold font-mono ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotCls}`} />
      {label}
    </span>
  )
}

export function WaypointsTable({ waypoints, namedWaypoints = [], startTime, onSetCutoff }: Props) {
  if (waypoints.length === 0) return null

  const last = waypoints[waypoints.length - 1]
  const totalMs = last.estimatedTime.getTime() - startTime.getTime()
  const totalH = Math.floor(totalMs / 3600000)
  const totalM = Math.floor((totalMs % 3600000) / 60000)
  const totalGain = Math.round(last.elevGainM)
  const totalLoss = Math.round(last.elevLossM)

  const hasWeather  = waypoints.some((w) => w.weather !== null)
  const hasLocation = waypoints.some((w) => w.location !== null)
  const hasCutoffCol = namedWaypoints.length > 0
  const hasNameCol   = hasLocation || namedWaypoints.length > 0

  // Merge computed waypoints + GPX named waypoints, sorted by km
  const rows = useMemo<TableRow[]>(() => {
    const computed: TableRow[] = waypoints.map((wp, idx) => ({ kind: 'computed', wp, idx }))
    const named: TableRow[] = namedWaypoints.map((wpt) => ({ kind: 'gpx-wpt', wpt }))
    return [...computed, ...named].sort((a, b) => {
      const aKm = a.kind === 'computed' ? a.wp.distanceKm : a.wpt.distanceKm
      const bKm = b.kind === 'computed' ? b.wp.distanceKm : b.wpt.distanceKm
      if (Math.abs(aKm - bKm) < 0.001) return a.kind === 'computed' ? -1 : 1
      return aKm - bKm
    })
  }, [waypoints, namedWaypoints])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-200">
          Waypoints estimados
          <span className="text-slate-500 font-normal text-sm ml-2">({waypoints.length})</span>
          {namedWaypoints.length > 0 && (
            <span className="text-amber-500 font-normal text-sm ml-2">· 🚩 {namedWaypoints.length}</span>
          )}
        </h2>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="text-slate-400">
            Tiempo total:{' '}
            <span className="text-sky-400 font-mono font-semibold">
              {totalH}h {totalM.toString().padStart(2, '0')}m
            </span>
          </span>
          <span className="text-slate-400">
            <span className="text-orange-400 font-mono font-semibold">+{totalGain} m</span>
            {' / '}
            <span className="text-blue-400 font-mono font-semibold">-{totalLoss} m</span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wide">
              <th className="px-3 py-3 text-right">Km</th>
              <th className="px-3 py-3 text-right">D+/D-</th>
              <th className="px-3 py-3 text-right">Alt</th>
              <th className="px-3 py-3 text-right">Pend.</th>
              <th className="px-3 py-3 text-center">Hora</th>
              {hasCutoffCol && (
                <th className="px-3 py-3 text-left">Corte</th>
              )}
              {hasWeather && (
                <>
                  <th className="px-3 py-3 text-center">Tiempo</th>
                  <th className="px-3 py-3 text-right">Tª</th>
                  <th className="px-3 py-3 text-right">Lluvia</th>
                  <th className="px-3 py-3 text-right">Viento</th>
                </>
              )}
              {hasNameCol && (
                <th className="px-3 py-3 text-left">
                  {hasLocation ? 'Población / Comarca' : 'Nombre'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              // ── Named GPX waypoint row ──────────────────────────────────────
              if (row.kind === 'gpx-wpt') {
                const { wpt } = row
                const w = wpt.weather
                const { emoji, label } = w ? weatherLabel(w.weatherCode) : { emoji: '', label: '' }
                const impact = w ? windImpact(w.windDirection, 0, w.windSpeedKmh) : null
                const { color: impactColor } = impact ? windImpactStyle(impact) : { color: '#475569' }
                // Stable key for the time input so it persists its DOM value across re-renders
                const inputKey = `cutoff-${wpt.lat.toFixed(6)}-${wpt.lon.toFixed(6)}`
                return (
                  <tr
                    key={`nwp-${rowIdx}`}
                    className="border-t border-amber-800/40 bg-amber-950/30"
                    style={{ borderLeft: '3px solid #d97706' }}
                  >
                    {/* Km */}
                    <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                      {wpt.distanceKm.toFixed(1)}
                    </td>
                    {/* D+/D- */}
                    <td className="px-3 py-2.5 text-center text-slate-600 text-xs">—</td>
                    {/* Alt */}
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                      {wpt.ele != null ? `${Math.round(wpt.ele)}m` : '—'}
                    </td>
                    {/* Pend. */}
                    <td className="px-3 py-2.5 text-center text-slate-600 text-xs">—</td>
                    {/* Hora */}
                    <td className="px-3 py-2.5 text-center font-mono text-sky-300 font-semibold">
                      {wpt.estimatedTime ? formatTime(wpt.estimatedTime) : '—'}
                      {wpt.estimatedTime && (
                        <span className="text-slate-500 font-normal text-xs ml-1.5">
                          {formatDuration(wpt.estimatedTime.getTime() - startTime.getTime())}
                        </span>
                      )}
                    </td>
                    {/* Corte — editor or read-only */}
                    {hasCutoffCol && (
                      <td className="px-3 py-2.5 text-left">
                        {onSetCutoff ? (
                          wpt.cutoffTime ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                key={inputKey}
                                type="time"
                                defaultValue={cutoffToTimeStr(wpt.cutoffTime)}
                                className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500 w-20"
                                onChange={(e) => {
                                  if (!e.target.value) return
                                  // Anchor to estimated arrival so multi-day routes land on the right day
                                  const anchor = wpt.estimatedTime ?? startTime
                                  onSetCutoff(wpt.lat, wpt.lon, cutoffFromTimeStr(e.target.value, anchor))
                                }}
                              />
                              {/* Day-offset badge — shows "+1d" etc. for post-midnight cut-offs */}
                              <DayBadge cutoff={wpt.cutoffTime} startTime={startTime} />
                              <button
                                onClick={() => onSetCutoff(wpt.lat, wpt.lon, null)}
                                className="text-slate-500 hover:text-red-400 text-sm font-bold leading-none px-0.5"
                                title="Eliminar corte"
                              >
                                ×
                              </button>
                              {wpt.cutoffMarginMin !== undefined && (
                                <CutoffBadge min={wpt.cutoffMarginMin} />
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => onSetCutoff(wpt.lat, wpt.lon, defaultCutoff(wpt.estimatedTime, startTime))}
                              className="text-amber-600 hover:text-amber-400 text-xs font-semibold"
                            >
                              + corte
                            </button>
                          )
                        ) : (
                          /* read-only (non-plan mode) */
                          wpt.cutoffTime ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-amber-300 font-mono text-xs">
                                {formatTime(wpt.cutoffTime)}
                              </span>
                              <DayBadge cutoff={wpt.cutoffTime} startTime={startTime} />
                              {wpt.cutoffMarginMin !== undefined && (
                                <CutoffBadge min={wpt.cutoffMarginMin} />
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )
                        )}
                      </td>
                    )}
                    {/* Weather */}
                    {hasWeather && (
                      <>
                        <td className="px-3 py-2.5 text-center" title={label}>
                          {w ? `${emoji} ${label}` : <span className="text-slate-600">—</span>}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono ${w ? tempColor(w.temperatureC) : 'text-slate-600'}`}>
                          {w ? `${w.temperatureC.toFixed(1)}°` : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono ${w ? precipColor(w.precipProbability) : 'text-slate-600'}`}>
                          {w ? `${w.precipProbability}%` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                          {w ? (
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              <span
                                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                                style={{ background: impactColor }}
                              />
                              {Math.round(w.windSpeedKmh)} km/h
                              <span className="text-slate-500">{windDirectionLabel(w.windDirection)}</span>
                            </span>
                          ) : '—'}
                        </td>
                      </>
                    )}
                    {/* Name (occupies the location column) */}
                    {hasNameCol && (
                      <td className="px-3 py-2.5 text-left">
                        <div className="leading-tight">
                          <span className="text-amber-400 font-semibold">🚩 {wpt.name}</span>
                          {wpt.desc && (
                            <div className="text-slate-500 text-xs mt-0.5">{wpt.desc}</div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              }

              // ── Regular computed waypoint row ───────────────────────────────
              const { wp, idx } = row
              const w = wp.weather
              const loc = wp.location
              const { emoji, label } = w ? weatherLabel(w.weatherCode) : { emoji: '', label: '' }
              const impact = w ? windImpact(w.windDirection, wp.bearing, w.windSpeedKmh) : null
              const { color: impactColor } = impact ? windImpactStyle(impact) : { color: '#475569' }

              return (
                <tr
                  key={wp.index}
                  className={`border-t border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/40'}`}
                >
                  <td className="px-3 py-2.5 text-right font-mono text-slate-200">
                    {wp.distanceKm.toFixed(1)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    <span className="text-orange-400">+{Math.round(wp.elevGainM)}</span>
                    <span className="text-slate-600">/</span>
                    <span className="text-blue-400">-{Math.round(wp.elevLossM)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                    {Math.round(wp.ele)}m
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${gradeColor(wp.segmentGrade)}`}>
                    {wp.segmentGrade > 0 ? '+' : ''}{wp.segmentGrade.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-sky-300 font-semibold">
                    {formatTime(wp.estimatedTime)}
                    <span className="text-slate-500 font-normal text-xs ml-1.5">
                      {formatDuration(wp.estimatedTime.getTime() - startTime.getTime())}
                    </span>
                  </td>
                  {/* Empty corte cell keeps column alignment */}
                  {hasCutoffCol && (
                    <td className="px-3 py-2.5 text-center text-slate-700 text-xs">—</td>
                  )}
                  {hasWeather && (
                    <>
                      <td className="px-3 py-2.5 text-center" title={label}>
                        {w ? `${emoji} ${label}` : <span className="text-slate-600">—</span>}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${w ? tempColor(w.temperatureC) : 'text-slate-600'}`}>
                        {w ? `${w.temperatureC.toFixed(1)}°` : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${w ? precipColor(w.precipProbability) : 'text-slate-600'}`}>
                        {w
                          ? <>
                              {w.precipProbability}%
                              {w.precipMm > 0 && (
                                <span className="text-slate-500 text-xs ml-1">({w.precipMm.toFixed(1)}mm)</span>
                              )}
                            </>
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                        {w ? (
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            <span
                              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: impactColor }}
                            />
                            {Math.round(w.windSpeedKmh)} km/h
                            <span className="text-slate-500">{windDirectionLabel(w.windDirection)}</span>
                          </span>
                        ) : '—'}
                      </td>
                    </>
                  )}
                  {hasNameCol && (
                    <td className="px-3 py-2.5 text-left">
                      {loc === null ? (
                        <span className="text-slate-600 text-xs">cargando…</span>
                      ) : (
                        <div className="leading-tight">
                          {loc.nearestPlace ? (
                            <span className="text-slate-200">{loc.nearestPlace.name}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                          <div className="text-slate-500 text-xs">
                            {loc.nearestPlace && (
                              <span>
                                {PLACE_TYPE_LABEL[loc.nearestPlace.type] ?? loc.nearestPlace.type}
                                {' · '}{loc.nearestPlace.distanceKm.toFixed(1)} km
                              </span>
                            )}
                            {loc.nearestPlace && loc.comarca && <span> · </span>}
                            {loc.comarca && <span>{loc.comarca}</span>}
                          </div>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
