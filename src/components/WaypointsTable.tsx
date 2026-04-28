import { useMemo } from 'react'
import type { EnrichedWaypoint, EnrichedNamedWaypoint } from '../lib/places'
import { weatherLabel, windImpact, windImpactStyle, windDirectionLabel } from '../lib/weather'
import { formatTime, formatDuration } from '../lib/timing'

interface Props {
  waypoints: EnrichedWaypoint[]
  namedWaypoints?: EnrichedNamedWaypoint[]
  startTime: Date
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

export function WaypointsTable({ waypoints, namedWaypoints = [], startTime }: Props) {
  if (waypoints.length === 0) return null

  const last = waypoints[waypoints.length - 1]
  const totalMs = last.estimatedTime.getTime() - startTime.getTime()
  const totalH = Math.floor(totalMs / 3600000)
  const totalM = Math.floor((totalMs % 3600000) / 60000)
  const totalGain = Math.round(last.elevGainM)
  const totalLoss = Math.round(last.elevLossM)

  const hasWeather = waypoints.some((w) => w.weather !== null)
  const hasLocation = waypoints.some((w) => w.location !== null)

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
              {hasWeather && (
                <>
                  <th className="px-3 py-3 text-center">Tiempo</th>
                  <th className="px-3 py-3 text-right">Tª</th>
                  <th className="px-3 py-3 text-right">Lluvia</th>
                  <th className="px-3 py-3 text-right">Viento</th>
                </>
              )}
              {hasLocation && (
                <th className="px-3 py-3 text-left">Población / Comarca</th>
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
                return (
                  <tr
                    key={`nwp-${rowIdx}`}
                    className="border-t border-amber-800/40 bg-amber-950/30"
                    style={{ borderLeft: '3px solid #d97706' }}
                  >
                    <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                      {wpt.distanceKm.toFixed(1)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-600 text-xs">—</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                      {wpt.ele != null ? `${Math.round(wpt.ele)}m` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-600 text-xs">—</td>
                    <td className="px-3 py-2.5 text-center font-mono text-sky-300 font-semibold">
                      {wpt.estimatedTime ? formatTime(wpt.estimatedTime) : '—'}
                      {wpt.estimatedTime && (
                        <span className="text-slate-500 font-normal text-xs ml-1.5">
                          {formatDuration(wpt.estimatedTime.getTime() - startTime.getTime())}
                        </span>
                      )}
                    </td>
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
                    {/* Name + description occupy the location column (or append if no location col) */}
                    <td className={`px-3 py-2.5 text-left ${!hasLocation ? '' : ''}`} colSpan={hasLocation ? 1 : undefined}>
                      <div className="leading-tight">
                        <span className="text-amber-400 font-semibold">🚩 {wpt.name}</span>
                        {wpt.desc && (
                          <div className="text-slate-500 text-xs mt-0.5">{wpt.desc}</div>
                        )}
                      </div>
                    </td>
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

                  {hasLocation && (
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
