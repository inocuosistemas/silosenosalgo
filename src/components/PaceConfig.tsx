import { useState, useEffect } from 'react'
import type { ActivityType, PaceConfig } from '../lib/timing'
import { ACTIVITY_LABEL, formatPace, splitHoursMinutes } from '../lib/timing'
import type { GpxTimesValidity } from '../lib/gpxValidity'
import { checkGpxTimes, gpxTimesIssueMessage } from '../lib/gpxValidity'
import { parseGpx, type GpxTrack } from '../lib/gpx'
import { calibrateSmartPaceFromGpx, type SmartCalibrationResult } from '../lib/smartCalibration'

/** Format a pace in decimal minutes as "m:ss" (rolling 60s up to the minute). */
function fmtPaceMMSS(v: number): string {
  let m = Math.floor(v)
  let sec = Math.round((v - m) * 60)
  if (sec >= 60) { m += 1; sec = 0 }
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtDurationMin(minutes: number): string {
  const { h, m } = splitHoursMinutes(Math.max(0, minutes))
  if (h === 0) return `${m} min`
  return `${h}h ${m.toString().padStart(2, '0')}m`
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

function ChoiceGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-md overflow-hidden border border-slate-600 text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 transition-colors ${
            value === opt.value
              ? 'bg-sky-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
  const [calibrationTrack, setCalibrationTrack] = useState<{ name: string; track: GpxTrack } | null>(null)
  const [smartCalibration, setSmartCalibration] = useState<SmartCalibrationResult | null>(null)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const [calibrationLoading, setCalibrationLoading] = useState(false)
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
  const confidenceLabel = smartCalibration?.confidence === 'high'
    ? 'alta'
    : smartCalibration?.confidence === 'medium'
    ? 'media'
    : 'baja'

  function calculateSmartCalibration(track: GpxTrack): { result: SmartCalibrationResult | null; error: string | null } {
    const validity = checkGpxTimes(track, config.activity)
    if (validity.issue !== 'ok') {
      return { result: null, error: gpxTimesIssueMessage(validity, config.activity) }
    }
    const result = calibrateSmartPaceFromGpx(track, config.activity)
    if (!result) {
      return { result: null, error: 'No hay suficientes tramos útiles en movimiento para calibrar el ritmo inteligente.' }
    }
    return { result, error: null }
  }

  useEffect(() => {
    if (!calibrationTrack) return
    const { result, error } = calculateSmartCalibration(calibrationTrack.track)
    setSmartCalibration(result)
    setCalibrationError(error)
  }, [config.activity, calibrationTrack])

  async function handleCalibrationFile(file: File | null) {
    if (!file) return
    setCalibrationLoading(true)
    setCalibrationError(null)
    try {
      const track = parseGpx(await file.text())
      setCalibrationTrack({ name: file.name, track })
      const { result, error } = calculateSmartCalibration(track)
      setSmartCalibration(result)
      setCalibrationError(error)
    } catch (err) {
      setSmartCalibration(null)
      setCalibrationTrack(null)
      setCalibrationError(err instanceof Error ? err.message : 'No se pudo leer el GPX de calibración.')
    } finally {
      setCalibrationLoading(false)
    }
  }

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
    <div className="space-y-5">
      {/* Activity selector — controls realistic-speed filter for live GPS */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actividad</span>
        <div className="inline-grid grid-cols-3 rounded-lg border border-slate-700 bg-slate-950/50 p-1">
          {(['walk', 'run', 'bike'] as const).map((a) => {
            const { emoji, label } = ACTIVITY_LABEL[a]
            return (
              <button
                key={a}
                onClick={() => setActivity(a)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5
                  ${config.activity === a
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
              >
                <span>{emoji}</span> {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Pace-mode selector ── */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modelo de previsión</span>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-1.5">
            <p className="text-xs text-slate-500">Planificado</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['fixed', 'naismith', 'smart'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`min-h-16 rounded-lg border px-3 py-2 text-left text-sm transition-colors
                    ${config.mode === m
                      ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                      : 'border-slate-700 bg-slate-950/35 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'}`}
                >
                  <span className="block font-semibold">
                    {m === 'fixed' ? 'Fijo' : m === 'naismith' ? 'D+' : 'Inteligente'}
                  </span>
                  <span className={`mt-0.5 block text-[11px] leading-snug ${config.mode === m ? 'text-sky-200/80' : 'text-slate-500'}`}>
                    {m === 'fixed' ? 'media constante' : m === 'naismith' ? 'ritmo + subida' : 'D+/D- y fatiga'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-slate-500">Desde GPX actual</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {/* GPX times split into two: exact per-segment, and uniform moving pace */}
              <button
                disabled={!gpxOk}
                onClick={() => gpxOk && setMode('gpx')}
                title={gpxDisabledTitle}
                className={`min-h-16 rounded-lg border px-3 py-2 text-left text-sm transition-colors
                  ${!gpxOk
                    ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-600'
                    : config.mode === 'gpx'
                    ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 bg-slate-950/35 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'}`}
              >
                <span className="block font-semibold">Tiempos reales</span>
                <span className={`mt-0.5 block text-[11px] leading-snug ${config.mode === 'gpx' ? 'text-sky-200/80' : 'text-slate-500'}`}>
                  tramo a tramo{overallPace !== null ? ` · ~${formatPace(overallPace, config.activity)}` : ''}
                </span>
              </button>

              <button
                disabled={!gpxOk || movingPace === null}
                onClick={() => { if (gpxOk && movingPace !== null) onChange({ ...config, mode: 'gpx-moving', paceMinPerKm: movingPace }) }}
                title={gpxDisabledTitle}
                className={`min-h-16 rounded-lg border px-3 py-2 text-left text-sm transition-colors
                  ${!gpxOk || movingPace === null
                    ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-600'
                    : config.mode === 'gpx-moving'
                    ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 bg-slate-950/35 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'}`}
              >
                <span className="block font-semibold">Media en movimiento</span>
                <span className={`mt-0.5 block text-[11px] leading-snug ${config.mode === 'gpx-moving' ? 'text-sky-200/80' : 'text-slate-500'}`}>
                  sin paradas{movingPace !== null ? ` · ${formatPace(movingPace, config.activity)}` : ''}
                </span>
              </button>
            </div>
          </div>
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

      {(config.mode === 'fixed' || config.mode === 'naismith' || config.mode === 'smart') && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parámetros</span>
          <div className="mt-2 flex flex-wrap gap-4 items-end">
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

            {(config.mode === 'naismith' || config.mode === 'smart') && (
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 text-xs uppercase tracking-wide">Min extra / 100m D+</span>
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

            {config.mode === 'smart' && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-xs uppercase tracking-wide">Bajadas</span>
                  <ChoiceGroup
                    value={config.smartDescent ?? 'balanced'}
                    options={[
                      { value: 'cautious', label: 'Prudente' },
                      { value: 'balanced', label: 'Normal' },
                      { value: 'aggressive', label: 'Fuerte' },
                    ]}
                    onChange={(smartDescent) => onChange({ ...config, smartDescent })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-slate-400 text-xs uppercase tracking-wide">Fatiga</span>
                  <ChoiceGroup
                    value={config.smartFatigue ?? 'medium'}
                    options={[
                      { value: 'low', label: 'Baja' },
                      { value: 'medium', label: 'Media' },
                      { value: 'high', label: 'Alta' },
                    ]}
                    onChange={(smartFatigue) => onChange({ ...config, smartFatigue })}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {config.mode === 'smart' && (
        <div className="space-y-2">
          <p className="text-slate-400 text-sm">
            El ritmo base se interpreta como capacidad en llano; la previsión ajusta cada tramo por subida,
            bajada, pendiente y fatiga acumulada.
          </p>
          <div className="rounded-lg border border-slate-700 bg-slate-900/45 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-slate-200 font-medium">Calibrar con GPX histórico</p>
                <p className="text-slate-400 text-xs mt-0.5">
                  Usa una carrera anterior con tiempos para estimar tu llano, subida, bajada y fatiga.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-600">
                Seleccionar GPX
                <input
                  type="file"
                  accept=".gpx,application/gpx+xml,application/xml,text/xml"
                  className="sr-only"
                  onChange={(e) => {
                    void handleCalibrationFile(e.currentTarget.files?.[0] ?? null)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            </div>
            {(calibrationTrack || calibrationLoading || calibrationError) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {calibrationTrack && (
                  <span className="truncate text-slate-300">
                    GPX de referencia: <span className="text-slate-100">{calibrationTrack.name}</span>
                  </span>
                )}
                {calibrationLoading && <span className="text-sky-300">Analizando GPX...</span>}
                {calibrationError && <span className="text-amber-300">{calibrationError}</span>}
              </div>
            )}
            {smartCalibration && (
              <div className="mt-3 rounded-lg border border-sky-800/60 bg-sky-950/25 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sky-200 font-medium">Perfil estimado desde ese GPX</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {smartCalibration.coverage.usableDistanceKm.toFixed(1)} km usados de {smartCalibration.coverage.totalDistanceKm.toFixed(1)}
                      {' '}({Math.round((smartCalibration.coverage.usableDistanceKm / Math.max(0.001, smartCalibration.coverage.totalDistanceKm)) * 100)}%) ·{' '}
                      {smartCalibration.samples} tramos · confianza {confidenceLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(smartCalibration.config)}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                  >
                    Aplicar perfil
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                  <span>Movimiento útil <span className="font-mono text-slate-100">{fmtDurationMin(smartCalibration.coverage.usableTimeMin)}</span></span>
                  <span>Paradas/lento <span className="font-mono text-slate-100">{fmtDurationMin(smartCalibration.coverage.pauseTimeMin)}</span></span>
                  <span>Llano <span className="font-mono text-slate-100">{formatPace(smartCalibration.flatPaceMinPerKm, config.activity)}</span></span>
                  <span>D+ <span className="font-mono text-slate-100">+{smartCalibration.climbMinPer100m.toFixed(1)} min/100m</span></span>
                  <span>Bajada <span className="text-slate-100">{smartCalibration.descentProfile === 'cautious' ? 'prudente' : smartCalibration.descentProfile === 'aggressive' ? 'fuerte' : 'normal'}</span></span>
                  <span>Fatiga <span className="text-slate-100">{smartCalibration.fatigueProfile === 'low' ? 'baja' : smartCalibration.fatigueProfile === 'high' ? 'alta' : 'media'}</span></span>
                </div>
                {smartCalibration.coverage.ignoredDistanceKm >= 0.5 && (
                  <div className="mt-2 rounded-md border border-amber-800/50 bg-amber-950/20 px-2.5 py-2 text-xs text-amber-200">
                    <p className="font-medium">
                      {smartCalibration.coverage.ignoredDistanceKm.toFixed(1)} km no se han usado para calibrar.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-amber-200/80">
                      {smartCalibration.coverage.missingTimeDistanceKm >= 0.1 && (
                        <span>sin tiempos {smartCalibration.coverage.missingTimeDistanceKm.toFixed(1)} km</span>
                      )}
                      {smartCalibration.coverage.pauseDistanceKm >= 0.1 && (
                        <span>
                          paradas/lento {smartCalibration.coverage.pauseDistanceKm.toFixed(1)} km · {fmtDurationMin(smartCalibration.coverage.pauseTimeMin)}
                        </span>
                      )}
                      {smartCalibration.coverage.tooFastDistanceKm >= 0.1 && (
                        <span>
                          velocidad improbable {smartCalibration.coverage.tooFastDistanceKm.toFixed(1)} km
                          {' '}· {fmtDurationMin(smartCalibration.coverage.tooFastTimeMin)}
                          {' '}(&gt;{smartCalibration.coverage.maxAllowedKmh.toFixed(0)} km/h)
                        </span>
                      )}
                      {smartCalibration.coverage.shortFragmentDistanceKm >= 0.1 && (
                        <span>
                          fragmentos cortos {smartCalibration.coverage.shortFragmentDistanceKm.toFixed(1)} km · {fmtDurationMin(smartCalibration.coverage.shortFragmentTimeMin)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {smartCalibration.paceBands.length > 0 && (
                  <div className="mt-3 border-t border-sky-900/60 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/80">
                      Ritmos observados por tipo de tramo
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {smartCalibration.paceBands.map((band) => (
                        <div
                          key={band.kind}
                          className="rounded-md border border-slate-700/70 bg-slate-950/35 px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-100">{band.label}</p>
                              <p className="text-[11px] text-slate-500">{band.description}</p>
                            </div>
                            <span className="font-mono text-sky-200">{formatPace(band.medianPaceMinPerKm, config.activity)}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                            <span>{band.distanceKm.toFixed(1)} km</span>
                            <span>{band.samples} tramos</span>
                            <span>{band.avgGradePct >= 0 ? '+' : ''}{band.avgGradePct.toFixed(1)}%</span>
                            <span>D+ {Math.round(band.gainMPerKm)} m/km</span>
                            <span>D- {Math.round(band.lossMPerKm)} m/km</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
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
