import { useEffect, useRef, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { PaceConfig } from '../lib/timing'
import { ACTIVITY_MAX_SPEED_KMH, formatPace, formatTime, splitHoursMinutes } from '../lib/timing'
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
  const { h, m } = splitHoursMinutes(Math.abs(min))
  const t = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
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

/** Lucide-style "copy" icon (two overlapping squares), 14×14, currentColor. */
function CopyIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** Lucide-style "check" icon shown for 2 s after a successful copy. */
function CheckIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/** Pretty-print a Date as "YYYY-MM-DD HH:MM" in local time. */
function formatLocalDateTime(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  const hh   = String(d.getHours()).padStart(2, '0')
  const mi   = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

/** Render HH:MM with a "+Nd" suffix when the date crosses to a later day. */
function timeWithDayOffset(t: Date, startTime: Date): string {
  const off = dayOffset(t, startTime)
  return off > 0 ? `${toTimeStr(t)} +${off}d` : toTimeStr(t)
}

/**
 * Build a plain-text snapshot of the buddy tracking state ready to be copied
 * to the clipboard. Uses "|" separators and space padding so it stays
 * readable in chat apps, terminals and plain editors.
 */
function formatObservationsAsText(args: {
  derived: BuddyDerived
  nextCutoff: NextCutoffInfo | null
  buddyEta: Date | null
  trackName: string
  startTime: Date
}): string {
  const { derived, nextCutoff, buddyEta, trackName, startTime } = args
  const lines: string[] = []

  lines.push(`🧑 Seguimiento — ${trackName}`)
  lines.push(`Salida: ${formatLocalDateTime(startTime)}`)
  lines.push('')

  // Build row strings, then compute column widths
  type Row = { num: string; km: string; hora: string; tramo: string; ritmo: string }
  const rows: Row[] = derived.sortedObs.map((o, i) => {
    const prev = i === 0
      ? { km: 0, time: startTime }
      : derived.sortedObs[i - 1]
    const dt  = (o.time.getTime() - prev.time.getTime()) / 60_000
    const dkm = o.km - prev.km
    const segPace = dkm > 0 ? dt / dkm : null
    return {
      num:   String(i + 1),
      km:    o.km.toFixed(1),
      hora:  timeWithDayOffset(o.time, startTime),
      tramo: `${dkm.toFixed(1)} km`,
      ritmo: segPace !== null ? `${formatPace(segPace)} min/km` : '—',
    }
  })

  const headers: Row = {
    num: '#', km: 'km', hora: 'hora', tramo: 'tramo', ritmo: 'ritmo tramo',
  }
  const widths = {
    num:   Math.max(headers.num.length,   ...rows.map((r) => r.num.length)),
    km:    Math.max(headers.km.length,    ...rows.map((r) => r.km.length)),
    hora:  Math.max(headers.hora.length,  ...rows.map((r) => r.hora.length)),
    tramo: Math.max(headers.tramo.length, ...rows.map((r) => r.tramo.length)),
    ritmo: Math.max(headers.ritmo.length, ...rows.map((r) => r.ritmo.length)),
  }
  const formatRow = (r: Row): string =>
    [
      r.num.padEnd(widths.num),
      r.km.padEnd(widths.km),
      r.hora.padEnd(widths.hora),
      r.tramo.padEnd(widths.tramo),
      r.ritmo.padEnd(widths.ritmo),
    ].join(' | ')

  lines.push(formatRow(headers))
  for (const r of rows) lines.push(formatRow(r))
  lines.push('')

  // ── Footer: aggregated metrics ─────────────────────────────────────────
  const m = derived.metrics
  const footer: string[] = [`Ritmo medio acumulado: ${formatPace(m.avgPaceFromStart)} min/km`]
  if (m.recentPaceMinPerKm !== null) {
    footer.push(`Último tramo: ${formatPace(m.recentPaceMinPerKm)} min/km`)
  }
  if (m.trendMinPerKm !== null) {
    const t = formatTrend(m.trendMinPerKm)
    footer.push(`Tendencia: ${t.label === 'estable' ? 'estable' : t.label}`)
  }
  lines.push(footer.join(' · '))

  if (nextCutoff) {
    const eta    = timeWithDayOffset(nextCutoff.eta, startTime)
    const margin = formatMargin(nextCutoff.marginMin)
    lines.push(
      `Próximo corte: ${nextCutoff.name} (km ${nextCutoff.km.toFixed(1)}) — llegada ${eta} (margen ${margin})`,
    )
  }

  if (buddyEta) {
    lines.push(`Llegada a meta: ${timeWithDayOffset(buddyEta, startTime)}`)
  }

  return lines.join('\n')
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
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-open the panel when at least one obs is active
  useEffect(() => { if (observations.length > 0) setOpen(true) }, [observations.length])

  // Clear the "copied ✓" timer on unmount so it can't fire on a dead component
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

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

  async function handleCopy() {
    if (!derived || derived.sortedObs.length === 0) return
    try {
      const text = formatObservationsAsText({
        derived, nextCutoff, buddyEta,
        trackName: track.name,
        startTime,
      })
      await navigator.clipboard.writeText(text)
      setError(null)
      setCopied(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('No se pudo copiar al portapapeles')
    }
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
              {/* Mini-header with copy-to-clipboard button */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/80 bg-slate-900/60">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
                  Observaciones
                </span>
                <button
                  onClick={handleCopy}
                  type="button"
                  title={copied ? 'Copiado ✓' : 'Copiar al portapapeles'}
                  aria-label={copied ? 'Copiado' : 'Copiar al portapapeles'}
                  className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                    copied
                      ? 'text-emerald-400'
                      : 'text-purple-400 hover:text-purple-300 hover:bg-slate-800/60'
                  }`}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  <span>{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
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
