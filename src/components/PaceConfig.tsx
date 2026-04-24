import { useState } from 'react'
import type { PaceConfig } from '../lib/timing'

interface Props {
  config: PaceConfig
  hasGpxTimes: boolean
  onChange: (c: PaceConfig) => void
}

export function PaceConfigPanel({ config, hasGpxTimes, onChange }: Props) {
  const [paceUnit, setPaceUnit] = useState<'pace' | 'speed'>('pace')

  function setMode(mode: PaceConfig['mode']) {
    onChange({ ...config, mode })
  }

  // min:sec → paceMinPerKm
  function setPaceFromStr(value: string) {
    const [minStr, secStr] = value.split(':')
    const min = parseInt(minStr ?? '0', 10) || 0
    const sec = parseInt(secStr ?? '0', 10) || 0
    onChange({ ...config, paceMinPerKm: min + sec / 60 })
  }

  // km/h → paceMinPerKm
  function setPaceFromKmh(value: string) {
    const kmh = parseFloat(value)
    if (kmh > 0) onChange({ ...config, paceMinPerKm: 60 / kmh })
  }

  const paceMin = Math.floor(config.paceMinPerKm)
  const paceSec = Math.round((config.paceMinPerKm - paceMin) * 60)
  const paceStr = `${paceMin}:${paceSec.toString().padStart(2, '0')}`
  const speedKmh = (60 / config.paceMinPerKm).toFixed(1)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(['fixed', 'naismith', 'gpx'] as const).map((m) => (
          <button
            key={m}
            disabled={m === 'gpx' && !hasGpxTimes}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed
              ${config.mode === m
                ? 'bg-sky-500 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            {m === 'fixed' && 'Ritmo fijo'}
            {m === 'naismith' && 'Ritmo + desnivel'}
            {m === 'gpx' && 'Tiempos del GPX'}
          </button>
        ))}
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
              <input
                type="text"
                value={paceStr}
                onChange={(e) => setPaceFromStr(e.target.value)}
                placeholder="5:30"
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-28 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            ) : (
              <input
                type="number"
                min={1}
                max={50}
                step={0.5}
                value={speedKmh}
                onChange={(e) => setPaceFromKmh(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-28 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            )}
          </div>

          {config.mode === 'naismith' && (
            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-wide">Min extra / 100m desnivel+</span>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={config.naismithMin100mUp}
                onChange={(e) =>
                  onChange({ ...config, naismithMin100mUp: parseFloat(e.target.value) || 0 })
                }
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-24 text-center font-mono focus:outline-none focus:border-sky-400"
              />
            </label>
          )}
        </div>
      )}

      {config.mode === 'gpx' && (
        <p className="text-slate-400 text-sm">
          Se usarán los tiempos registrados en el GPX para calcular las horas de paso.
        </p>
      )}
    </div>
  )
}
