import { useEffect, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import type { PaceConfig } from '../lib/timing'
import { ACTIVITY_MAX_SPEED_KMH, formatPace, formatTime } from '../lib/timing'
import { dayOffset, fromTimeStr, toTimeStr } from '../lib/multiDayTime'
import { useFreshnessLabel } from '../lib/useFreshnessLabel'

export interface BuddyObservation {
  km: number
  time: Date
}

interface Props {
  track: GpxTrack
  startTime: Date
  paceConfig: PaceConfig
  observation: BuddyObservation | null
  onApply: (obs: BuddyObservation) => void
  onClear: () => void
  /** Live projected km of the buddy at "now" (ticks every 30 s). */
  buddyKmNow: number | null
  /** Estimated finish time projected from the observed pace. */
  buddyEta: Date | null
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

export function BuddyTracker({
  track,
  startTime,
  paceConfig,
  observation,
  onApply,
  onClear,
  buddyKmNow,
  buddyEta,
}: Props) {
  const [open, setOpen] = useState(false)
  const [kmStr, setKmStr] = useState<string>(() =>
    observation ? observation.km.toFixed(1) : '',
  )
  const [timeStr, setTimeStr] = useState<string>(() =>
    observation ? toTimeStr(observation.time) : '',
  )
  const [error, setError] = useState<string | null>(null)

  // Auto-open when there's an active observation, so the user sees it
  useEffect(() => { if (observation) setOpen(true) }, [observation])

  // Sync local inputs when observation changes externally
  useEffect(() => {
    if (observation) {
      setKmStr(observation.km.toFixed(1))
      setTimeStr(toTimeStr(observation.time))
    }
  }, [observation])

  const physicalMinPace = 60 / ACTIVITY_MAX_SPEED_KMH[paceConfig.activity]

  function handleNow() {
    const now = new Date()
    setTimeStr(toTimeStr(now))
  }

  function handleApply() {
    setError(null)
    const km = parseFloat(kmStr.replace(',', '.'))
    if (!Number.isFinite(km) || km <= 0) {
      setError('Indica un km válido (> 0)')
      return
    }
    if (km > track.totalDistanceKm) {
      setError(`El km debe ser ≤ ${track.totalDistanceKm.toFixed(1)} (longitud de la ruta)`)
      return
    }
    if (!/^\d{1,2}:\d{2}$/.test(timeStr.trim())) {
      setError('Indica una hora válida (HH:MM)')
      return
    }
    // Anchor to startTime for day-offset detection (works for multi-day routes
    // up to ~12h before/after start; later observations shift +1d, etc.)
    const time = fromTimeStr(timeStr, startTime)
    const elapsedMin = (time.getTime() - startTime.getTime()) / 60_000
    if (elapsedMin <= 0) {
      setError('La hora reportada debe ser posterior a la salida')
      return
    }
    const observedPace = elapsedMin / km
    if (observedPace < physicalMinPace) {
      setError(
        `Ritmo observado imposible (${formatPace(observedPace)}) — supera el máximo físico de la actividad`,
      )
      return
    }
    if (observedPace > 60) {
      setError(`Ritmo observado demasiado lento (${formatPace(observedPace)}) — revisa los datos`)
      return
    }
    onApply({ km, time })
  }

  function handleClear() {
    setError(null)
    setKmStr('')
    setTimeStr('')
    onClear()
  }

  // ── Derived (only when observation active) ────────────────────────────────
  const observedPaceMinPerKm = observation
    ? (observation.time.getTime() - startTime.getTime()) / 60_000 / observation.km
    : null
  const freshness = useFreshnessLabel(observation?.time ?? null)

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
          {observation && (
            <span className="text-[10px] bg-purple-900/40 border border-purple-700/50 text-purple-300 px-2 py-0.5 rounded-full font-medium">
              activo · km {observation.km.toFixed(1)} a las {toTimeStr(observation.time)}
            </span>
          )}
          {!observation && (
            <span className="text-xs text-slate-500">
              Recalcula la previsión a partir de una observación puntual
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 p-4 space-y-4">

          {/* ── Inputs ── */}
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
                  <DayBadge t={fromTimeStr(timeStr, startTime)} startTime={startTime} />
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
                onClick={handleApply}
                className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Aplicar
              </button>
              <button
                onClick={handleClear}
                disabled={!observation}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-sm font-medium py-2 px-3 rounded-lg border border-slate-600 transition-colors"
              >
                Limpiar
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 rounded-lg">
              ⚠️ {error}
            </div>
          )}

          {/* ── Active status ── */}
          {observation && observedPaceMinPerKm !== null && (
            <div className="bg-purple-950/30 border border-purple-800/50 rounded-lg px-4 py-3 space-y-1.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">
                  Última obs.:
                  <span className="text-purple-200 font-mono ml-1">
                    km {observation.km.toFixed(1)}
                  </span>
                  <span className="text-slate-500 mx-1">·</span>
                  <span className="text-purple-200 font-mono">
                    {toTimeStr(observation.time)}
                  </span>
                  <DayBadge t={observation.time} startTime={startTime} />
                </span>
                <span className="text-slate-400">
                  Ritmo medio:
                  <span className="text-purple-200 font-mono ml-1">
                    {formatPace(observedPaceMinPerKm)}
                  </span>
                </span>
                {buddyKmNow !== null && (
                  <span className="text-slate-400">
                    Ahora ≈
                    <span className="text-purple-200 font-mono ml-1">
                      km {buddyKmNow.toFixed(1)}
                    </span>
                  </span>
                )}
                {buddyEta && (
                  <span className="text-slate-400">
                    Llegada estimada:
                    <span className="text-purple-200 font-mono ml-1">
                      {formatTime(buddyEta)}
                    </span>
                    <DayBadge t={buddyEta} startTime={startTime} />
                  </span>
                )}
                {freshness && (
                  <span className="text-slate-500 ml-auto">
                    actualizado {freshness.label}
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
