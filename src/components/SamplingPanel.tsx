import { useEffect, useState } from 'react'
import type { SamplingConfig } from '../lib/timing'
import { SAMPLE_INTERVAL_KM } from '../lib/timing'

interface Props {
  config: SamplingConfig
  totalKm: number
  onChange: (c: SamplingConfig) => void
}

export function SamplingPanel({ config, totalKm, onChange }: Props) {
  const [countText, setCountText] = useState(String(config.count))

  useEffect(() => {
    setCountText(String(config.count))
  }, [config.count])

  function handleCountChange(value: string) {
    if (!/^\d*$/.test(value)) return
    setCountText(value)

    const count = Number.parseInt(value, 10)
    if (Number.isNaN(count) || count < 3) return

    onChange({
      ...config,
      count: Math.min(200, count),
    })
  }

  function normalizeCount() {
    const count = Number.parseInt(countText, 10)
    const nextCount = Number.isNaN(count) ? config.count : Math.max(3, Math.min(200, count))
    setCountText(String(nextCount))
    if (nextCount !== config.count) onChange({ ...config, count: nextCount })
  }

  const estimatedCount: number | null = (() => {
    if (config.mode === 'auto') return Math.ceil(totalKm / SAMPLE_INTERVAL_KM(totalKm)) + 1
    if (config.mode === 'km') return Math.ceil(totalKm / Math.max(0.05, config.intervalKm)) + 1
    if (config.mode === 'count') return config.count
    return null
  })()

  const options = [
    { mode: 'auto', title: 'Automático', detail: 'densidad según distancia' },
    { mode: 'km', title: 'Por kilómetros', detail: 'un punto cada X km' },
    { mode: 'time', title: 'Por tiempo', detail: 'según minutos previstos' },
    { mode: 'count', title: 'Por número', detail: 'cantidad fija de puntos' },
  ] as const

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generación del plan de paso</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {options.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => onChange({ ...config, mode: opt.mode })}
              className={`min-h-16 rounded-lg border px-3 py-2 text-left text-sm transition-colors
                ${config.mode === opt.mode
                  ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                  : 'border-slate-700 bg-slate-950/35 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'}`}
            >
              <span className="block font-semibold">{opt.title}</span>
              <span className={`mt-0.5 block text-[11px] leading-snug ${config.mode === opt.mode ? 'text-sky-200/80' : 'text-slate-500'}`}>
                {opt.detail}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-3">
        {config.mode === 'auto' && (
          <p className="text-slate-400 text-sm">
            Intervalo automático según la longitud de la ruta.{' '}
            {estimatedCount !== null && (
              <span className="text-sky-400">~{estimatedCount} waypoints</span>
            )}
          </p>
        )}

        {config.mode === 'km' && (
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs uppercase tracking-wide">Cada (km)</span>
            <input
              type="number"
              min={0.5} max={20} step={0.5}
              value={config.intervalKm}
              onChange={(e) =>
                onChange({ ...config, intervalKm: Math.max(0.5, parseFloat(e.target.value) || 1) })
              }
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-24 text-center font-mono focus:outline-none focus:border-sky-400"
            />
            {estimatedCount !== null && (
              <span className="text-sky-400 text-xs">~{estimatedCount} waypoints</span>
            )}
          </label>
        )}

        {config.mode === 'time' && (
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs uppercase tracking-wide">Cada (minutos)</span>
            <input
              type="number"
              min={5} max={120} step={5}
              value={config.intervalMinutes}
              onChange={(e) =>
                onChange({ ...config, intervalMinutes: Math.max(5, parseInt(e.target.value) || 15) })
              }
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-24 text-center font-mono focus:outline-none focus:border-sky-400"
            />
            <span className="text-slate-500 text-xs">Varía según el ritmo elegido</span>
          </label>
        )}

        {config.mode === 'count' && (
          <label className="flex flex-col gap-1">
            <span className="text-slate-400 text-xs uppercase tracking-wide">Número de waypoints</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={countText}
              onChange={(e) => handleCountChange(e.target.value)}
              onBlur={normalizeCount}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 w-24 text-center font-mono focus:outline-none focus:border-sky-400"
            />
          </label>
        )}
      </div>
    </div>
  )
}
