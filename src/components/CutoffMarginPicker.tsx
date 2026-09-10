import { useState } from 'react'
import type { MarginChoice } from '../lib/cutoffStrategy'
import type { ActivityType, PaceConfig } from '../lib/timing'
import { formatPace, splitHoursMinutes } from '../lib/timing'

/**
 * Elegir el ritmo por el único dato que se sabe de antemano: el margen.
 *
 * Antes de una carrera larga casi nadie sabe decir a qué ritmo va a ir —el
 * modelo de previsión, el ritmo en llano, los minutos por cada 100 m de D+ son
 * preguntas de después—. Lo que sí se sabe contestar es cuánto se quiere
 * llegar antes de cada corte: media hora de colchón, o justo. De ahí sale el
 * ritmo, y sale bien, porque el ritmo necesario NO depende del ritmo que
 * lleves puesto, solo del recorrido, de las horas de corte y de la salida.
 *
 * Solo aparece si el recorrido tiene cortes. Sin cortes no hay pregunta que
 * hacer, y ofrecerla vacía sería peor que no ofrecerla.
 */

/** "Justo", "30 min", "1 h", "1 h 30". */
function marginLabel(min: number): string {
  if (min <= 0) return 'Justo'
  const { h, m } = splitHoursMinutes(min)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/** Dos ritmos son el mismo si se diferencian en menos de un segundo por km. */
const SAME_PACE = 1 / 60

interface Props {
  choices: MarginChoice[]
  /** Margen elegido ahora mismo (minutos antes de cada corte). */
  marginMin: number
  activity: ActivityType
  paceMode: PaceConfig['mode']
  /** Ritmo base configurado, para saber si el del margen ya está puesto. */
  currentPaceMinPerKm: number
  onMarginChange: (min: number) => void
  onApplyPace: (paceMinPerKm: number) => void
}

export function CutoffMarginPicker({
  choices,
  marginMin,
  activity,
  paceMode,
  currentPaceMinPerKm,
  onMarginChange,
  onApplyPace,
}: Props) {
  const [otherDraft, setOtherDraft] = useState('')
  if (choices.length === 0) return null

  const selected = choices.find((c) => c.marginMin === marginMin) ?? null
  const required = selected?.requiredPaceMinPerKm ?? null
  const alreadyApplied = required !== null && Math.abs(required - currentPaceMinPerKm) < SAME_PACE
  // Los tiempos del GPX mandan tramo a tramo, así que un ritmo base no pintaría
  // nada mientras ese modelo siga activo: aplicarlo obliga a pasar a fijo.
  const switchesToFixed = paceMode === 'gpx' || paceMode === 'gpx-moving'

  function commitOther() {
    const n = parseInt(otherDraft, 10)
    setOtherDraft('')
    if (!Number.isFinite(n)) return
    onMarginChange(Math.max(0, Math.min(600, n)))
  }

  return (
    <div className="rounded-xl border border-sky-800/60 bg-sky-950/25 px-3 py-3">
      <p className="text-sm font-semibold text-sky-100">¿Cuánto quieres llegar antes de cada corte?</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Es la forma más rápida de salir de dudas: eliges el colchón que quieres y te digo el ritmo
        que hace falta para tenerlo en <strong>todos</strong> los cortes. El modelo y el ritmo base
        de abajo son para afinar después.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {choices.map((c) => {
          const active = c.marginMin === marginMin
          const unreachable = c.requiredPaceMinPerKm === null
          return (
            <button
              key={c.marginMin}
              type="button"
              onClick={() => onMarginChange(c.marginMin)}
              className={`min-w-[5.5rem] rounded-lg border px-3 py-2 text-left transition-colors
                ${active
                  ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                  : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'}`}
            >
              <span className="block text-sm font-semibold">{marginLabel(c.marginMin)}</span>
              <span className={`mt-0.5 block font-mono text-[11px] ${
                unreachable ? 'text-red-400' : active ? 'text-sky-200' : 'text-slate-500'
              }`}>
                {unreachable ? 'no llegas' : formatPace(c.requiredPaceMinPerKm!, activity)}
              </span>
            </button>
          )
        })}

        <label className="flex flex-col justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Otro</span>
          <input
            type="text"
            inputMode="numeric"
            value={otherDraft}
            placeholder="min"
            onChange={(e) => setOtherDraft(e.target.value)}
            onBlur={commitOther}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') { setOtherDraft(''); e.currentTarget.blur() }
            }}
            aria-label="Otro margen, en minutos"
            className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center font-mono text-xs text-slate-200 focus:border-sky-600 focus:outline-none"
          />
        </label>
      </div>

      {selected && (
        <div className="mt-3 border-t border-sky-900/50 pt-3">
          {required === null ? (
            <p className="text-xs leading-relaxed text-red-300">
              Con {marginLabel(selected.marginMin).toLowerCase()} de margen no hay ritmo que llegue
              {selected.unreachableCount > 0 && (
                <> a {selected.unreachableCount} {selected.unreachableCount === 1 ? 'corte' : 'cortes'}</>
              )}
              . Pide menos margen, retrasa menos la salida o quita alguna parada prevista.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-xs leading-relaxed text-slate-300">
                Hace falta <span className="font-mono text-sky-200">{formatPace(required, activity)}</span>
                {selected.bottleneckLabel && (
                  <>
                    {' '}— lo marca <strong className="text-slate-200">{selected.bottleneckLabel}</strong>
                    {selected.bottleneckKm !== null && (
                      <span className="text-slate-500"> (km {selected.bottleneckKm.toFixed(1)})</span>
                    )}
                  </>
                )}
                . En el resto de cortes llegarás con más colchón que el pedido.
                {switchesToFixed && (
                  <span className="block text-slate-500">
                    Ponerlo cambia el modelo a ritmo fijo: los tiempos del GPX mandan tramo a tramo y
                    dejarían el ritmo sin efecto.
                  </span>
                )}
              </p>
              {alreadyApplied ? (
                <span className="shrink-0 rounded-lg border border-emerald-700/50 bg-emerald-900/25 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                  ✓ Ritmo puesto
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onApplyPace(required)}
                  className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500"
                >
                  Poner {formatPace(required, activity)}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
