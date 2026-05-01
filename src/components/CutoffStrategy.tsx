import { useState } from 'react'
import type { CutoffStrategyResult, SegmentStrategy, SegmentSeverity } from '../lib/cutoffStrategy'
import type { PaceConfig, SegmentPace } from '../lib/timing'
import { formatPace, splitHoursMinutes } from '../lib/timing'

interface Props {
  strategy: CutoffStrategyResult
  paceConfig: PaceConfig
  onApplySinglePace: (pace: number) => void
  onApplyVariablePaces: (paces: SegmentPace[]) => void
  variablePacesActive: boolean
  marginMin: number
  onMarginChange: (minutes: number) => void
}

// ── Style config per severity ─────────────────────────────────────────────────

const SEV: Record<SegmentSeverity, {
  rowCls:  string
  textCls: string
  dotCls:  string
  label:   string
}> = {
  impossible: { rowCls: 'bg-gray-900/50',   textCls: 'text-gray-500',   dotCls: 'bg-gray-600',   label: 'Imposible' },
  critical:   { rowCls: 'bg-red-950/40',    textCls: 'text-red-400',    dotCls: 'bg-red-400',    label: 'Crítico'   },
  tight:      { rowCls: 'bg-amber-950/30',  textCls: 'text-amber-400',  dotCls: 'bg-amber-400',  label: 'Apretado'  },
  ok:         { rowCls: '',                 textCls: 'text-slate-300',  dotCls: 'bg-slate-500',  label: 'Ok'        },
  easy:       { rowCls: 'bg-green-950/20',  textCls: 'text-green-400',  dotCls: 'bg-green-500',  label: 'Holgado'   },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function paceShort(pace: number): string {
  const min = Math.floor(pace)
  const sec = Math.round((pace - min) * 60)
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function fmtMin(min: number): string {
  const { h, m } = splitHoursMinutes(Math.abs(min))
  const t = h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m} min`
  return min < 0 ? `−${t}` : t
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PaceDelta({ required, current }: { required: number; current: number }) {
  // slack > 0 → can go slower (easier); slack < 0 → must go faster (harder)
  const slack   = required - current
  const absSlack = Math.abs(slack)
  const cls = slack >= 0 ? 'text-green-400' : slack > -0.5 ? 'text-slate-400' : 'text-red-400'
  const sign = slack >= 0 ? '+' : '−'
  return (
    <span className={`text-xs font-mono ${cls}`}>
      {sign}{paceShort(absSlack)}
    </span>
  )
}

function SegmentRow({
  seg,
  isTightest,
  currentPace,
}: {
  seg: SegmentStrategy
  isTightest: boolean
  currentPace: number
}) {
  const cfg = SEV[seg.severity]
  return (
    <tr className={`border-t border-slate-700/40 ${cfg.rowCls} ${isTightest ? 'outline outline-1 outline-orange-700/60 outline-offset-[-1px]' : ''}`}>
      {/* Tramo */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {isTightest && (
            <span className="text-orange-400 text-xs shrink-0" title="Tramo más exigente">⚡</span>
          )}
          <span className="text-slate-300 font-medium text-xs truncate max-w-[9rem]" title={seg.fromLabel}>
            {seg.fromLabel}
          </span>
          <span className="text-slate-600 text-xs shrink-0">→</span>
          <span className="text-amber-300 font-medium text-xs truncate max-w-[9rem]" title={seg.toLabel}>
            {seg.toLabel}
          </span>
        </div>
        <div className="text-slate-500 text-[10px] mt-0.5 pl-4">
          km {seg.fromKm.toFixed(1)}–{seg.toKm.toFixed(1)}
        </div>
      </td>
      {/* Dist */}
      <td className="px-3 py-2.5 text-right font-mono text-slate-300 text-xs">
        {seg.distanceKm.toFixed(1)}
      </td>
      {/* D+ */}
      <td className="px-3 py-2.5 text-right font-mono text-orange-400 text-xs">
        +{Math.round(seg.elevGainM)}m
      </td>
      {/* Tiempo disponible */}
      <td className={`px-3 py-2.5 text-right font-mono text-xs ${seg.availableMin < 0 ? 'text-red-400' : 'text-slate-300'}`}>
        {fmtMin(seg.availableMin)}
      </td>
      {/* Ritmo necesario */}
      <td className="px-3 py-2.5 text-center">
        {seg.requiredPaceMinPerKm === null ? (
          <span className="text-gray-500 text-xs font-semibold">⛔ Imposible</span>
        ) : (
          <span className={`inline-flex items-center gap-1 text-xs font-mono font-semibold ${cfg.textCls}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotCls}`} />
            {paceShort(seg.requiredPaceMinPerKm)}/km
          </span>
        )}
      </td>
      {/* vs plan */}
      <td className="px-3 py-2.5 text-center">
        {seg.requiredPaceMinPerKm !== null ? (
          <PaceDelta required={seg.requiredPaceMinPerKm} current={currentPace} />
        ) : (
          <span className="text-gray-600 text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CutoffStrategy({
  strategy,
  paceConfig,
  onApplySinglePace,
  onApplyVariablePaces,
  variablePacesActive,
  marginMin,
  onMarginChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const { segments, tightestSegment, hasImpossible, singlePace, variablePaces } = strategy

  if (segments.length === 0) return null

  const criticalCount = segments.filter((s) => s.severity === 'critical' || s.severity === 'impossible').length
  const tightCount    = segments.filter((s) => s.severity === 'tight').length

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">

      {/* ── Toggle header ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
            📊 Estrategia por tramos
          </span>
          {/* Summary pills */}
          {criticalCount > 0 && (
            <span className="text-xs text-red-400 font-semibold">
              🔴 {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
            </span>
          )}
          {tightCount > 0 && (
            <span className="text-xs text-amber-400 font-semibold">
              🟡 {tightCount} apretado{tightCount > 1 ? 's' : ''}
            </span>
          )}
          {criticalCount === 0 && tightCount === 0 && (
            <span className="text-xs text-green-400 font-semibold">🟢 todos los tramos holgados</span>
          )}
          {variablePacesActive && (
            <span className="text-[10px] bg-emerald-900/40 border border-emerald-700/50 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
              ritmo variable activo
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800">

          {/* ── Margin control ── */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/60 bg-slate-800/30">
            <label htmlFor="strategy-margin" className="text-xs text-slate-400 whitespace-nowrap shrink-0">
              ⏱ Margen de seguridad
            </label>
            <input
              id="strategy-margin"
              type="number"
              min={0}
              max={120}
              step={5}
              value={marginMin}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                onMarginChange(Number.isFinite(v) ? Math.max(0, v) : 0)
              }}
              className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-200 text-right focus:outline-none focus:border-sky-600"
            />
            <span className="text-xs text-slate-500">min por corte</span>
            {marginMin > 0 && (
              <span className="text-[10px] bg-sky-900/30 border border-sky-700/40 text-sky-400 px-2 py-0.5 rounded-full font-medium">
                llegar {marginMin} min antes del corte
              </span>
            )}
          </div>

          {/* ── Segment table ── */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">Tramo</th>
                  <th className="px-3 py-2 text-right">km</th>
                  <th className="px-3 py-2 text-right">D+</th>
                  <th className="px-3 py-2 text-right">Tiempo disp.</th>
                  <th className="px-3 py-2 text-center">Ritmo nec.</th>
                  <th className="px-3 py-2 text-center">vs. plan</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg, i) => (
                  <SegmentRow
                    key={i}
                    seg={seg}
                    isTightest={seg === tightestSegment}
                    currentPace={paceConfig.paceMinPerKm}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Tightest callout ── */}
          {tightestSegment && (
            <p className="px-4 pt-3 pb-1 text-xs text-slate-400">
              <span className="text-orange-400">⚡ Cuello de botella:</span>{' '}
              <strong className="text-slate-200">
                {tightestSegment.fromLabel} → {tightestSegment.toLabel}
              </strong>
              {tightestSegment.requiredPaceMinPerKm !== null && (
                <span className="font-mono ml-1">
                  (necesitas ≤ {paceShort(tightestSegment.requiredPaceMinPerKm)} min/km)
                </span>
              )}
            </p>
          )}

          {/* ── Action buttons ── */}
          <div className="flex flex-wrap gap-3 px-4 pt-3 pb-4">
            {/* A · Ritmo único */}
            <button
              onClick={() => singlePace !== null && onApplySinglePace(singlePace)}
              disabled={singlePace === null}
              title={
                singlePace === null
                  ? 'Hay tramos imposibles — ningún ritmo único alcanza todos los cortes'
                  : `Aplicar ${formatPace(singlePace)} a todo el recorrido`
              }
              className="flex-1 min-w-[160px] flex flex-col items-center gap-0.5 px-4 py-3 rounded-xl bg-sky-900/30 border border-sky-700/50 hover:bg-sky-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="text-sky-300 text-sm font-semibold">
                A · Ritmo único
                {singlePace !== null && (
                  <span className="ml-1.5 font-mono">{paceShort(singlePace)} min/km</span>
                )}
              </span>
              <span className="text-slate-400 text-xs text-center">
                {singlePace !== null
                  ? 'Ritmo más exigente aplicado a todo el recorrido'
                  : 'No disponible — tramos imposibles'}
              </span>
            </button>

            {/* B · Ritmo variable */}
            <button
              onClick={() => !hasImpossible && onApplyVariablePaces(variablePaces)}
              disabled={hasImpossible}
              title={
                hasImpossible
                  ? 'Hay tramos imposibles — no se puede generar un plan variable'
                  : 'Cada tramo usa su ritmo mínimo necesario; la previsión se recalcula'
              }
              className="flex-1 min-w-[160px] flex flex-col items-center gap-0.5 px-4 py-3 rounded-xl bg-emerald-900/20 border border-emerald-700/40 hover:bg-emerald-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="text-emerald-300 text-sm font-semibold">B · Ritmo variable</span>
              <span className="text-slate-400 text-xs text-center">
                {hasImpossible
                  ? 'No disponible — tramos imposibles'
                  : 'Ritmo distinto por tramo, waypoints recalculados'}
              </span>
            </button>
          </div>

          {/* ── Variable-pace active indicator ── */}
          {variablePacesActive && (
            <div className="mx-4 mb-4 flex items-center gap-2 text-xs bg-emerald-900/20 border border-emerald-700/40 text-emerald-300 px-3 py-2 rounded-lg">
              <span className="shrink-0">🔀</span>
              <span className="flex-1">
                Modo ritmo variable activo — la previsión de horas usa ritmos distintos por tramo.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
