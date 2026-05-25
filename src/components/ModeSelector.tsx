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
  const modeBtn = (m: ViewMode, activeCls = 'bg-sky-600 text-white') => (
    <button
      onClick={() => onModeChange(m)}
      className={`${BTN} ${mode === m ? activeCls : inactive}`}
    >
      {MODE_META[m].emoji} {MODE_META[m].label}
    </button>
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold mr-1">Vista</span>
      <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs flex-wrap">
        {modeBtn('slope')}

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
          modeBtn('terrain', 'bg-amber-700 text-white')
        ) : (
          <button
            onClick={() => { onFetchTerrain(); onModeChange('terrain') }}
            title="Cargar tipo de firme desde OpenStreetMap (consulta pesada — opt-in)"
            className={`${BTN} bg-slate-800 text-slate-400 hover:text-amber-300 hover:bg-slate-700 flex items-center gap-1.5`}
          >
            <span className="text-amber-500 text-[10px] leading-none">▶</span> 🏔️ Terreno
          </button>
        )}

        {/* Forecast modes — appear only when their data is available */}
        {weatherAvailable && modeBtn('temp')}
        {weatherAvailable && modeBtn('rain')}
        {weatherAvailable && modeBtn('wind')}
        {pollenAvailable && modeBtn('pollen', 'bg-green-700 text-white')}
        {daylightAvailable && modeBtn('daylight', 'bg-amber-600 text-white')}
      </div>
    </div>
  )
}
