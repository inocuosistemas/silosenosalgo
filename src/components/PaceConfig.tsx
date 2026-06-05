import { useState, useEffect } from 'react'
import type { ActivityType, PaceConfig } from '../lib/timing'
import { ACTIVITY_LABEL, formatPace } from '../lib/timing'
import type { GpxTimesValidity } from '../lib/gpxValidity'
import { gpxTimesIssueMessage } from '../lib/gpxValidity'

/** Format a pace in decimal minutes as "m:ss" (rolling 60s up to the minute). */
function fmtPaceMMSS(v: number): string {
  let m = Math.floor(v)
  let sec = Math.round((v - m) * 60)
  if (sec >= 60) { m += 1; sec = 0 }
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * Text input that lets the user select-all and type freely: the typed string
 * is held in local draft state and only parsed + reformatted when the field is
 * "committed" (Enter or blur). `format` renders the committed value; `parse`
 * turns the typed string into a value (or null to reject and revert). Escape
 * cancels the edit. This avoids the jank of re-formatting on every keystroke.
 */
function DraftInput({
  value,
  format,
  parse,
  onCommit,
  className,
  placeholder,
  inputMode = 'decimal',
  'aria-label': ariaLabel,
}: {
  value: number
  format: (v: number) => string
  parse: (s: string) => number | null
  onCommit: (v: number) => void
  className?: string
  placeholder?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? format(value)

  function commit() {
    if (draft === null) return
    const parsed = parse(draft)
    if (parsed !== null) onCommit(parsed)
    setDraft(null) // revert to the formatted committed value (new or unchanged)
  }

  return (
    <input
      type="text"
      inputMode={inputMode}
      aria-label={ariaLabel}
      value={shown}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      className={className}
    />
  )
}

interface Props {
  config: PaceConfig
  hasGpxTimes: boolean
  gpxValidity?: GpxTimesValidity | null
  /** Track distance — used to derive the "exact" mode's overall average pace. */
  totalDistanceKm?: number
  onChange: (c: PaceConfig) => void
}

export function PaceConfigPanel({ config, hasGpxTimes, gpxValidity, totalDistanceKm = 0, onChange }: Props) {
  // The whole app speaks of bikes in km/h (formatPace, paceUnitLabel…), so the
  // editable pace unit defaults to km/h for bike and min/km for foot activities.
  const [paceUnit, setPaceUnit] = useState<'pace' | 'speed'>(
    config.activity === 'bike' ? 'speed' : 'pace',
  )
  // Re-apply that default whenever the activity changes. Runs only on activity
  // change, so a manual toggle within the same activity is preserved.
  useEffect(() => {
    setPaceUnit(config.activity === 'bike' ? 'speed' : 'pace')
  }, [config.activity])

  // GPX-derived paces for the two split buttons.
  const gpxOk = !!(hasGpxTimes && gpxValidity && gpxValidity.issue === 'ok')
  const movingPace  = gpxValidity?.movingAvgKmh ? 60 / gpxValidity.movingAvgKmh : null
  const overallPace = gpxValidity && gpxValidity.spanSec > 0 && totalDistanceKm > 0
    ? 60 / (totalDistanceKm / (gpxValidity.spanSec / 3600))
    : null
  const gpxDisabledTitle = !hasGpxTimes
    ? 'El GPX no incluye marcas de tiempo'
    : gpxValidity && gpxValidity.issue !== 'ok'
    ? gpxTimesIssueMessage(gpxValidity, config.activity)
    : undefined

  function setMode(mode: PaceConfig['mode']) {
    onChange({ ...config, mode })
  }

  // "m:ss" (or plain minutes) → paceMinPerKm. null rejects the edit.
  function parsePaceStr(value: string): number | null {
    const t = value.trim()
    if (!t) return null
    const [minStr, secStr] = t.split(':')
    const min = parseInt(minStr, 10)
    if (isNaN(min)) return null
    const sec = secStr !== undefined ? (parseInt(secStr, 10) || 0) : 0
    const v = min + sec / 60
    return v > 0 ? v : null
  }

  // km/h → paceMinPerKm. Accepts comma as decimal separator. null rejects.
  function parseKmh(value: string): number | null {
    const kmh = parseFloat(value.replace(',', '.'))
    return kmh > 0 ? 60 / kmh : null
  }

  function setActivity(activity: ActivityType) {
    onChange({ ...config, activity })
  }

  return (
    <div className="space-y-4">
      {/* Activity selector — controls realistic-speed filter for live GPS */}
      <div className="flex flex-col gap-1.5">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Tipo de actividad</span>
        <div className="flex gap-2 flex-wrap">
          {(['walk', 'run', 'bike'] as const).map((a) => {
            const { emoji, label } = ACTIVITY_LABEL[a]
            return (
              <button
                key={a}
                onClick={() => setActivity(a)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
                  ${config.activity === a
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                <span>{emoji}</span> {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Pace-mode selector ── */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          {(['fixed', 'naismith'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${config.mode === m ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              {m === 'fixed' ? 'Ritmo fijo' : 'Ritmo + desnivel'}
            </button>
          ))}

          {/* GPX times split into two: exact per-segment, and uniform moving pace */}
          <button
            disabled={!gpxOk}
            onClick={() => gpxOk && setMode('gpx')}
            title={gpxDisabledTitle}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex flex-col items-start leading-tight
              ${!gpxOk
                ? 'opacity-40 cursor-not-allowed bg-slate-700 text-slate-400'
                : config.mode === 'gpx'
                ? 'bg-sky-500 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            <span>GPX exacto</span>
            <span className={`text-[10px] ${config.mode === 'gpx' ? 'text-sky-100' : 'text-slate-400'}`}>
              tramo a tramo{overallPace !== null ? ` · ~${formatPace(overallPace, config.activity)}` : ''}
            </span>
          </button>

          <button
            disabled={!gpxOk || movingPace === null}
            onClick={() => { if (gpxOk && movingPace !== null) onChange({ ...config, mode: 'gpx-moving', paceMinPerKm: movingPace }) }}
            title={gpxDisabledTitle}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex flex-col items-start leading-tight
              ${!gpxOk || movingPace === null
                ? 'opacity-40 cursor-not-allowed bg-slate-700 text-slate-400'
                : config.mode === 'gpx-moving'
                ? 'bg-sky-500 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            <span>GPX en movimiento</span>
            <span className={`text-[10px] ${config.mode === 'gpx-moving' ? 'text-sky-100' : 'text-slate-400'}`}>
              sin paradas{movingPace !== null ? ` · ${formatPace(movingPace, config.activity)}` : ''}
            </span>
          </button>
        </div>

        {/* Contextual banner when GPX times are present but invalid */}
        {hasGpxTimes && gpxValidity && gpxValidity.issue !== 'ok' && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-xs leading-relaxed">
            <span className="mt-0.5 shrink-0">⚠️</span>
            <span>
              <strong>Tiempos GPX no válidos:</strong>{' '}
              {gpxTimesIssueMessage(gpxValidity, config.activity)}
              {gpxValidity.movingAvgKmh !== null && gpxValidity.inferredActivity && gpxValidity.inferredActivity !== config.activity && (
                <span className="block mt-1 text-amber-400/80">
                  Velocidad media en movimiento compatible con actividad «{gpxValidity.inferredActivity}» — comprueba el tipo de actividad seleccionado.
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {(config.mode === 'fixed' || config.mode === 'naismith') && (
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs uppercase tracking-wide">
                {paceUnit === 'pace' ? 'Ritmo base (min:seg/km)' : 'Velocidad base (km/h)'}
              </span>
              {/* toggle min/km ↔ km/h */}
              <div className="flex rounded-md overflow-hidden border border-slate-600 text-xs ml-3">
                <button
                  onClick={() => setPaceUnit('pace')}
                  className={`px-2 py-0.5 transition-colors ${paceUnit === 'pace' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  min/km
                </button>
                <button
                  onClick={() => setPaceUnit('speed')}
                  className={`px-2 py-0.5 transition-colors ${paceUnit === 'speed' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  km/h
                </button>
              </div>
            </div>

            {paceUnit === 'pace' ? (
              <DraftInput
                value={config.paceMinPerKm}
                format={fmtPaceMMSS}
                parse={parsePaceStr}
                onCommit={(v) => onChange({ ...config, paceMinPerKm: v })}
                placeholder="5:30"
                inputMode="text"
                aria-label="Ritmo base en minutos por kilómetro"
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-28 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            ) : (
              <DraftInput
                value={config.paceMinPerKm}
                format={(v) => (60 / v).toFixed(1)}
                parse={parseKmh}
                onCommit={(v) => onChange({ ...config, paceMinPerKm: v })}
                placeholder="10.5"
                aria-label="Velocidad base en kilómetros por hora"
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-28 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            )}
          </div>

          {config.mode === 'naismith' && (
            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-wide">Min extra / 100m desnivel+</span>
              <DraftInput
                value={config.naismithMin100mUp}
                format={(v) => String(v)}
                parse={(s) => { const n = parseFloat(s.replace(',', '.')); return isNaN(n) || n < 0 ? null : n }}
                onCommit={(v) => onChange({ ...config, naismithMin100mUp: v })}
                aria-label="Minutos extra por cada 100 m de desnivel positivo"
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-24 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            </label>
          )}
        </div>
      )}

      {config.mode === 'gpx' && gpxValidity?.issue === 'ok' && (
        <p className="text-slate-400 text-sm">
          Se usarán los tiempos registrados en el GPX <strong>tramo a tramo</strong> (incluidas las paradas) para las horas de paso.
          {gpxValidity.movingAvgKmh !== null && (
            <span className="ml-1 text-slate-500 text-xs">
              (velocidad media en movimiento: {gpxValidity.movingAvgKmh.toFixed(1)} km/h)
            </span>
          )}
        </p>
      )}

      {config.mode === 'gpx-moving' && (
        <p className="text-slate-400 text-sm">
          Ritmo uniforme = velocidad media <strong>en movimiento</strong> del GPX (sin paradas):{' '}
          <span className="font-mono text-slate-300">{formatPace(config.paceMinPerKm, config.activity)}</span>.
        </p>
      )}
    </div>
  )
}
