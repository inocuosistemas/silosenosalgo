import type { ViewMode } from '../lib/viewMode'
import { MODE_META } from '../lib/viewMode'

/**
 * The single, shared mode selector that drives the colouring of BOTH the map
 * and the elevation profile, so the two views always show the same variable.
 *
 * Track-only modes (Pendiente, Terreno) work without a plan; the forecast modes
 * (Temp/Lluvia/Viento/Polen/Luz) only appear once their data is available. The
 * Terreno button doubles as the opt-in fetch trigger (Overpass is expensive).
 */
interface Props {
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
  weatherAvailable: boolean
  pollenAvailable: boolean
  daylightAvailable: boolean
  terrainStatus: 'idle' | 'loading' | 'done' | 'error'
  terrainErrorKind?: 'rate-limit' | 'network' | 'server'
  terrainRetryAfterSec?: number
  onFetchTerrain: () => void
  onTerrainRetry: () => void
}

const BTN = 'px-3 py-1.5 transition-colors whitespace-nowrap'
const inactive = 'bg-slate-800 text-slate-400 hover:text-slate-200'
const disabledCls = 'bg-slate-900/60 text-slate-600 opacity-50 cursor-not-allowed italic'

export function ModeSelector({
  mode,
  onModeChange,
  weatherAvailable,
  pollenAvailable,
  daylightAvailable,
  terrainStatus,
  terrainErrorKind = 'network',
  terrainRetryAfterSec = 0,
  onFetchTerrain,
  onTerrainRetry,
}: Props) {
  const modeBtn = (
    m: ViewMode,
    opts: { activeCls?: string; available?: boolean; disabledTitle?: string } = {},
  ) => {
    const { activeCls = 'bg-sky-600 text-white', available = true, disabledTitle } = opts
    if (!available) {
      return (
        <button
          type="button"
          disabled
          title={disabledTitle}
          className={`${BTN} ${disabledCls}`}
        >
          {MODE_META[m].emoji} {MODE_META[m].label}
        </button>
      )
    }
    return (
      <button
        onClick={() => onModeChange(m)}
        className={`${BTN} ${mode === m ? activeCls : inactive}`}
      >
        {MODE_META[m].emoji} {MODE_META[m].label}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs flex-wrap">
        {/* Order: track → forecast (rain, wind, temp) → daylight → pollen → terrain.
           Modes whose data isn't ready stay visible but muted, so the row layout
           is stable and the user can see what features will unlock. */}
        {modeBtn('slope')}
        {modeBtn('rain', { available: weatherAvailable, disabledTitle: 'Disponible al calcular el plan (botón Calcular)' })}
        {modeBtn('wind', { available: weatherAvailable, disabledTitle: 'Disponible al calcular el plan (botón Calcular)' })}
        {modeBtn('temp', { available: weatherAvailable, disabledTitle: 'Disponible al calcular el plan (botón Calcular)' })}
        {modeBtn('sunTemp', { activeCls: 'bg-orange-600 text-white', available: weatherAvailable, disabledTitle: 'Disponible al calcular el plan — estima la T sentida al sol (cielo claro/nubes según parte)' })}
        {modeBtn('daylight', { activeCls: 'bg-amber-600 text-white', available: daylightAvailable, disabledTitle: 'Disponible al calcular el plan (necesita hora de salida)' })}
        {modeBtn('pollen', { activeCls: 'bg-green-700 text-white', available: pollenAvailable, disabledTitle: 'Disponible si la ruta está en Europa y se ha calculado el plan' })}

        {/* Terreno — state-aware: fetch (idle) / loading / retry (error) / select (done) */}
        {terrainStatus === 'loading' ? (
          <button
            disabled
            title="Cargando datos de terreno desde OpenStreetMap…"
            className={`${BTN} bg-slate-800 text-slate-400 cursor-wait flex items-center gap-1.5`}
          >
            <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            🏔️ Terreno
          </button>
        ) : terrainStatus === 'error' ? (
          <button
            onClick={onTerrainRetry}
            title={
              terrainErrorKind === 'rate-limit'
                ? `Servidor OpenStreetMap saturado — espera ~${Math.max(terrainRetryAfterSec, 5)}s`
                : terrainErrorKind === 'network'
                ? 'Error de red — reintenta'
                : 'Error del servidor OpenStreetMap — reintenta'
            }
            className={`${BTN} bg-slate-800 text-red-400 hover:text-red-300 hover:bg-slate-700 flex items-center gap-1.5`}
          >
            <span className="text-base leading-none">↻</span> 🏔️ Terreno
          </button>
        ) : terrainStatus === 'done' ? (
          modeBtn('terrain', { activeCls: 'bg-amber-700 text-white' })
        ) : (
          <button
            onClick={() => { onFetchTerrain(); onModeChange('terrain') }}
            title="Cargar tipo de firme desde OpenStreetMap (consulta pesada — opt-in)"
            className={`${BTN} bg-slate-800 text-slate-400 hover:text-amber-300 hover:bg-slate-700 flex items-center gap-1.5`}
          >
            <span className="text-amber-500 text-[10px] leading-none">▶</span> 🏔️ Terreno
          </button>
        )}
      </div>
    </div>
  )
}
