import { useEffect, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { PaceConfig } from '../lib/timing'
import { ACTIVITY_MAX_SPEED_KMH, formatPace, formatTime } from '../lib/timing'
import { dayOffset, fromTimeStrForward, toTimeStr } from '../lib/multiDayTime'
import { useFreshnessLabel } from '../lib/useFreshnessLabel'
import type { BuddyDerived, BuddyObservation } from '../lib/buddyTracking'
import { validateNewObservation } from '../lib/buddyTracking'

export interface NextCutoffInfo {
  name: string
  /** Optional <desc> tag from the GPX waypoint. */
  desc?: string
  km: number
  cutoff: Date
  /** ETA derived from the buddy-recomputed waypoints. */
  eta: Date
  /** cutoff − eta in minutes (positive = on time). */
  marginMin: number
  /**
   * Pace (min/km) the buddy can afford from the projected "now" position to
   * the next cut-off while still arriving `strategyMarginMin` minutes early.
   * null when the cut-off cannot be met (would need an impossible pace).
   */
  affordablePaceMinPerKm: number | null
  /** Pace currently being projected forward (= buddy's projection pace). */
  currentPaceMinPerKm: number
  /** Strategy safety margin currently in effect (informational). */
  strategyMarginMin: number
}

interface Props {
  track: GpxTrack
  startTime: Date
  paceConfig: PaceConfig
  observations: BuddyObservation[]
  derived: BuddyDerived | null
  onAdd: (obs: BuddyObservation) => void
  onRemove: (km: number) => void
  onClear: () => void
  /** Live projected km of the buddy at "now" (ticks every 30 s). */
  buddyKmNow: number | null
  /** Estimated finish time projected from the observed pace. */
  buddyEta: Date | null
  /** Next cut-off ahead of the buddy's projected position. */
  nextCutoff: NextCutoffInfo | null
}

function DayBadge({ t, startTime }: { t: Date; startTime: Date }) {
  const off = dayOffset(t, startTime)
  if (off <= 0) return null
  return (
    <span className="text-[10px] bg-purple-900/40 border border-purple-700/50 text-purple-300 px-1.5 py-0.5 rounded font-medium ml-1">
      +{off}d
    </span>
  )
}

/** Format a Δ pace (min/km) with sign. Negative = faster (good), positive = slower. */
function formatTrend(deltaMinPerKm: number): { label: string; cls: string; arrow: string } {
  const abs = Math.abs(deltaMinPerKm)
  const min = Math.floor(abs)
  const sec = Math.round((abs - min) * 60)
  const txt = `${min}:${sec.toString().padStart(2, '0')}`
  if (deltaMinPerKm > 0.1)  return { label: `+${txt}/km`, cls: 'text-amber-400', arrow: '↗' }
  if (deltaMinPerKm < -0.1) return { label: `−${txt}/km`, cls: 'text-emerald-400', arrow: '↘' }
  return { label: 'estable', cls: 'text-slate-400', arrow: '→' }
}

/** Format a cut-off margin (minutes) as "+1h 12m" / "−8 min". */
function formatMargin(min: number): string {
  const abs = Math.abs(min)
  const h   = Math.floor(abs / 60)
  const m   = Math.round(abs % 60)
  const t   = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  return min >= 0 ? `+${t}` : `−${t}`
}

/** Format a Δ pace (min/km) as "+0:45/km" / "−0:20/km". */
function formatPaceDelta(deltaMinPerKm: number): string {
  const abs = Math.abs(deltaMinPerKm)
  const min = Math.floor(abs)
  const sec = Math.round((abs - min) * 60)
  const txt = `${min}:${sec.toString().padStart(2, '0')}/km`
  return deltaMinPerKm >= 0 ? `+${txt}` : `−${txt}`
}

export function BuddyTracker({
  track,
  startTime,
  paceConfig,
  observations,
  derived,
  onAdd,
  onRemove,
  onClear,
  buddyKmNow,
  buddyEta,
  nextCutoff,
}: Props) {
  const [open, setOpen] = useState(false)
  const [kmStr, setKmStr] = useState<string>('')
  const [timeStr, setTimeStr] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // Auto-open the panel when at least one obs is active
  useEffect(() => { if (observations.length > 0) setOpen(true) }, [observations.length])

  const physicalMinPace = 60 / ACTIVITY_MAX_SPEED_KMH[paceConfig.activity]

  // Anchor for parsing the new HH:MM input. Each new observation is strictly
  // after the previous one (or after startTime if it's the first), so we
  // anchor at the latest existing time and force the parsed result forward.
  const anchorTime: Date = observations.length > 0
    ? observations.reduce((latest, o) => (o.time.getTime() > latest.getTime() ? o.time : latest), observations[0].time)
    : startTime

  function handleNow() {
    setTimeStr(toTimeStr(new Date()))
  }

  function handleAdd() {
    setError(null)
    const km = parseFloat(kmStr.replace(',', '.'))
    if (!Number.isFinite(km)) {
      setError('Indica un km válido')
      return
    }
    if (!/^\d{1,2}:\d{2}$/.test(timeStr.trim())) {
      setError('Indica una hora válida (HH:MM)')
      return
    }
    const time = fromTimeStrForward(timeStr, anchorTime)
    const candidate: BuddyObservation = { km, time }
    const err = validateNewObservation(
      candidate, observations, startTime, track.totalDistanceKm, physicalMinPace,
    )
    if (err) { setError(err); return }
    onAdd(candidate)
    setKmStr('')
    setTimeStr('')
  }

  function handleClear() {
    setError(null)
    setKmStr('')
    setTimeStr('')
    onClear()
  }

  const freshness = useFreshnessLabel(derived?.metrics.lastObs.time ?? null)
  const trend = derived?.metrics.trendMinPerKm != null
    ? formatTrend(derived.metrics.trendMinPerKm)
    : null

  return (
    <div className="bg-slate-900 rounded-xl border border-purple-900/50 overflow-hidden">

      {/* ── Header toggle ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-purple-300 uppercase tracking-widest font-semibold">
            🧑 Seguimiento de compañero
          </span>
          {observations.length > 0 ? (
            <span className="text-[10px] bg-purple-900/40 border border-purple-700/50 text-purple-300 px-2 py-0.5 rounded-full font-medium">
              {observations.length} obs · última km {derived?.metrics.lastObs.km.toFixed(1)} a las {toTimeStr(derived!.metrics.lastObs.time)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              Recalcula la previsión a partir de observaciones puntuales
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 p-4 space-y-4">

          {/* ── Inputs (add a new observation) ── */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">km reportado</label>
              <input
                type="number"
                min={0.1}
                max={track.totalDistanceKm}
                step={0.1}
                value={kmStr}
                onChange={(e) => setKmStr(e.target.value)}
                placeholder={`0.0–${track.totalDistanceKm.toFixed(1)}`}
                className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">hora de paso</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-purple-500"
                />
                {timeStr && /^\d{1,2}:\d{2}$/.test(timeStr) && (
                  <DayBadge t={fromTimeStrForward(timeStr, anchorTime)} startTime={startTime} />
                )}
                <button
                  onClick={handleNow}
                  type="button"
                  className="text-[11px] text-purple-300 hover:text-purple-200 border border-purple-800/60 hover:border-purple-600 rounded-md px-2 py-1.5 transition-colors"
                  title="Fijar la hora actual"
                >
                  Ahora
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2 ml-auto">
              <button
                onClick={handleAdd}
                className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Añadir obs.
              </button>
              <button
                onClick={handleClear}
                disabled={observations.length === 0}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-sm font-medium py-2 px-3 rounded-lg border border-slate-600 transition-colors"
              >
                Limpiar todo
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 rounded-lg">
              ⚠️ {error}
            </div>
          )}

          {/* ── Observations list ── */}
          {derived && derived.sortedObs.length > 0 && (
            <div className="bg-slate-950/50 border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800/60 text-slate-400 text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-1.5 text-right">#</th>
                    <th className="px-3 py-1.5 text-right">km</th>
                    <th className="px-3 py-1.5 text-left">hora</th>
                    <th className="px-3 py-1.5 text-right">tramo</th>
                    <th className="px-3 py-1.5 text-right">ritmo tramo</th>
                    <th className="px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {derived.sortedObs.map((o, i) => {
                    // Per-segment pace: first seg = avg from start; others = between obs
                    const prev = i === 0
                      ? { km: 0, time: startTime }
                      : derived.sortedObs[i - 1]
                    const dt  = (o.time.getTime() - prev.time.getTime()) / 60_000
                    const dkm = o.km - prev.km
                    const segPace = dkm > 0 ? dt / dkm : null
                    return (
                      <tr key={`${o.km}-${o.time.getTime()}`} className="border-t border-slate-800/60">
                        <td className="px-3 py-1.5 text-right text-slate-500 font-mono">{i + 1}</td>
                        <td className="px-3 py-1.5 text-right text-purple-200 font-mono">{o.km.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-purple-200 font-mono">
                          {toTimeStr(o.time)}
                          <DayBadge t={o.time} startTime={startTime} />
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-400 font-mono">
                          {dkm.toFixed(1)} km
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                          {segPace !== null ? formatPace(segPace) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            onClick={() => onRemove(o.km)}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                            title="Quitar esta observación"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Aggregated metrics ── */}
          {derived && (
            <div className="bg-purple-950/30 border border-purple-800/50 rounded-lg px-4 py-3 space-y-1.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">
                  Ritmo medio acumulado:
                  <span className="text-purple-200 font-mono ml-1">
                    {formatPace(derived.metrics.avgPaceFromStart)}
                  </span>
                </span>
                {derived.metrics.recentPaceMinPerKm !== null && (
                  <span className="text-slate-400">
                    Ritmo último tramo:
                    <span className="text-purple-200 font-mono ml-1">
                      {formatPace(derived.metrics.recentPaceMinPerKm)}
                    </span>
                  </span>
                )}
                {trend && (
                  <span className="text-slate-400">
                    Tendencia:
                    <span className={`font-mono ml-1 ${trend.cls}`}>
                      {trend.arrow} {trend.label}
                    </span>
                  </span>
                )}
                {freshness && (
                  <span className="text-slate-500 ml-auto">
                    actualizado {freshness.label}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-purple-900/40">
                {buddyKmNow !== null && (
                  <span className="text-slate-400">
                    Ahora ≈
                    <span className="text-purple-200 font-mono ml-1">
                      km {buddyKmNow.toFixed(1)}
                    </span>
                  </span>
                )}
                {nextCutoff && (
                  <span className="text-slate-400">
                    Próximo corte:{' '}
                    <span className="text-purple-200 font-medium">
                      {nextCutoff.name}
                    </span>
                    <span className="text-slate-500 ml-1 font-mono">
                      (km {nextCutoff.km.toFixed(1)})
                    </span>
                    {nextCutoff.desc && (
                      <span className="text-slate-400 ml-1.5 italic" title={nextCutoff.desc}>
                        — {nextCutoff.desc}
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* ETA + cutoff comparison line */}
              {nextCutoff && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-purple-900/40">
                  <span className="text-slate-400">
                    🕘 Llegada estimada al corte:
                    <span className="text-purple-200 font-mono ml-1 font-semibold">
                      {formatTime(nextCutoff.eta)}
                    </span>
                    <DayBadge t={nextCutoff.eta} startTime={startTime} />
                  </span>
                  <span className="text-slate-400">
                    ⏰ Hora de corte:
                    <span className="text-slate-300 font-mono ml-1">
                      {formatTime(nextCutoff.cutoff)}
                    </span>
                    <DayBadge t={nextCutoff.cutoff} startTime={startTime} />
                  </span>
                  <span className="text-slate-400">
                    Margen:
                    <span className={`font-mono font-semibold ml-1 ${nextCutoff.marginMin >= 10 ? 'text-emerald-400' : nextCutoff.marginMin >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                      {formatMargin(nextCutoff.marginMin)}
                    </span>
                  </span>
                </div>
              )}

              {/* Affordable pace to make the next cut-off (with strategy margin) */}
              {nextCutoff && (() => {
                const a = nextCutoff.affordablePaceMinPerKm
                const c = nextCutoff.currentPaceMinPerKm
                if (a === null) {
                  return (
                    <div className="flex flex-wrap items-center gap-x-2 text-xs pt-1 border-t border-purple-900/40">
                      <span className="text-slate-400">⏩ Ritmo permitido al próx. corte:</span>
                      <span className="text-red-400 font-mono font-semibold">
                        ⛔ imposible con margen {nextCutoff.strategyMarginMin} min
                      </span>
                    </div>
                  )
                }
                const delta = a - c   // > 0: can ease up; < 0: must speed up
                const deltaCls =
                  Math.abs(delta) < 0.1 ? 'text-slate-400' :
                  delta > 0            ? 'text-emerald-400' :
                                          'text-red-400'
                const deltaHint =
                  Math.abs(delta) < 0.1 ? '· vas en línea con lo permitido' :
                  delta > 0            ? `· puedes aflojar ${formatPaceDelta(Math.abs(delta))}` :
                                          `· debes apretar ${formatPaceDelta(Math.abs(delta))}`
                return (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs pt-1 border-t border-purple-900/40">
                    <span className="text-slate-400">⏩ Ritmo permitido al próx. corte:</span>
                    <span className="text-purple-200 font-mono font-semibold">
                      {formatPace(a)}
                    </span>
                    {nextCutoff.strategyMarginMin > 0 && (
                      <span className="text-[10px] text-slate-500">
                        (con margen {nextCutoff.strategyMarginMin} min)
                      </span>
                    )}
                    <span className={`font-mono text-[11px] ${deltaCls}`}>
                      {deltaHint}
                    </span>
                  </div>
                )
              })()}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-purple-900/40">
                {buddyEta && (
                  <span className="text-slate-400 ml-auto">
                    Llegada a meta:
                    <span className="text-purple-200 font-mono ml-1">
                      {formatTime(buddyEta)}
                    </span>
                    <DayBadge t={buddyEta} startTime={startTime} />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
