import { createElement, useMemo, useState } from 'react'
import { GpxUploader } from './components/GpxUploader'
import { PaceConfigPanel } from './components/PaceConfig'
import { SamplingPanel } from './components/SamplingPanel'
import { RouteMap } from './components/RouteMap'
import type { MapMode } from './components/RouteMap'
import { WeatherCharts } from './components/WeatherCharts'
import { WaypointsTable } from './components/WaypointsTable'
import type { GpxTrack } from './lib/gpx'
import type { PaceConfig, SamplingConfig, Waypoint } from './lib/timing'
import { computeWaypoints, DEFAULT_SAMPLING } from './lib/timing'
import type { WeatherData } from './lib/weather'
import { fetchWeatherForWaypoints } from './lib/weather'
import type { LocationInfo } from './lib/places'
import { fetchLocationForWaypoints } from './lib/places'

const DEFAULT_PACE: PaceConfig = {
  mode: 'fixed',
  paceMinPerKm: 5.5,
  naismithMin100mUp: 6,
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type LoadStatus = 'idle' | 'loading' | 'done' | 'error'

export default function App() {
  const [track, setTrack] = useState<GpxTrack | null>(null)
  const [startTime, setStartTime] = useState<Date>(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return d
  })
  const [paceConfig, setPaceConfig] = useState<PaceConfig>(DEFAULT_PACE)
  const [sampling, setSampling] = useState<SamplingConfig>(DEFAULT_SAMPLING)

  // Separate state layers to avoid race conditions in parallel fetches
  const [baseWaypoints, setBaseWaypoints] = useState<Waypoint[]>([])
  const [weatherArr, setWeatherArr] = useState<(WeatherData | null)[]>([])
  const [locationArr, setLocationArr] = useState<(LocationInfo | null)[]>([])

  const [mapMode, setMapMode] = useState<MapMode>('rain')
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [locationProgress, setLocationProgress] = useState({ done: 0, total: 0 })
  const [pdfLoading, setPdfLoading] = useState(false)

  const hasGpxTimes = !!track?.points.some((p) => p.time)

  const enrichedWaypoints = useMemo(
    () =>
      baseWaypoints.map((w, i) => ({
        ...w,
        weather: weatherArr[i] ?? null,
        location: locationArr[i] ?? null,
      })),
    [baseWaypoints, weatherArr, locationArr],
  )

  function reset() {
    setBaseWaypoints([])
    setWeatherArr([])
    setLocationArr([])
    setStatus('idle')
    setErrorMsg(null)
    setLocationWarning(null)
    setLocationProgress({ done: 0, total: 0 })
  }

  function handleTrack(t: GpxTrack) {
    setTrack(t)
    reset()
    if (t.points.some((p) => p.time)) {
      setPaceConfig((c) => ({ ...c, mode: 'gpx' }))
    }
  }

  async function handleCompute() {
    if (!track) return
    setStatus('loading')
    setErrorMsg(null)
    setLocationProgress({ done: 0, total: 0 })

    try {
      const wps = computeWaypoints(track, startTime, paceConfig, sampling)
      setBaseWaypoints(wps)
      setWeatherArr(wps.map(() => null))
      setLocationArr(wps.map(() => null))

      // Fire weather and location in parallel; each updates its own state slice
      const weatherPromise = fetchWeatherForWaypoints(wps).then((results) => {
        setWeatherArr(results.map((r) => r.weather))
      })

      // Location is non-fatal: if Overpass/Nominatim fail, weather still shows
      const locationPromise = fetchLocationForWaypoints(
        wps,
        track.totalDistanceKm,
        (done, total) => setLocationProgress({ done, total }),
      )
        .then((results) => setLocationArr(results))
        .catch((err: unknown) => {
          setLocationWarning(
            err instanceof Error ? err.message : 'No se pudieron obtener localidades',
          )
        })

      await Promise.all([weatherPromise, locationPromise])
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('error')
    }
  }

  const isLoading = status === 'loading'
  const isDone = status === 'done' && baseWaypoints.length > 0

  async function handleExportPdf() {
    if (!track || !isDone) return
    setPdfLoading(true)
    try {
      // Dynamic import to avoid bloating the initial bundle
      const [{ pdf }, { RoutePdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./components/RoutePdf'),
      ])
      const doc = createElement(RoutePdfDocument, {
        track,
        waypoints: enrichedWaypoints,
        startTime,
        mapMode,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(track.name || 'ruta').replace(/[^a-z0-9]/gi, '_')}-${startTime.toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('Error al generar el PDF: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">🌧️</span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SiLoSeNoSalgo</h1>
            <p className="text-slate-500 text-xs">Previsión meteorológica a lo largo de tu ruta GPX</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* Paso 1 */}
        <section className="space-y-3">
          <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">1 · Carga tu ruta</h2>
          {track ? (
            <div className="bg-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-slate-100">{track.name}</p>
                <p className="text-slate-400 text-sm">
                  {track.totalDistanceKm.toFixed(1)} km · {track.points.length} puntos
                  {hasGpxTimes && <span className="ml-2 text-sky-400">· con tiempos GPS</span>}
                </p>
              </div>
              <button
                onClick={() => { setTrack(null); reset() }}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors shrink-0"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <GpxUploader onTrackLoaded={handleTrack} />
          )}
        </section>

        {/* Paso 2 */}
        {track && (
          <section className="space-y-3">
            <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">2 · Fecha y hora de salida</h2>
            <input
              type="datetime-local"
              value={toLocalInputValue(startTime)}
              onChange={(e) => { setStartTime(new Date(e.target.value)); reset() }}
              className="bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 font-mono focus:outline-none focus:border-sky-400 text-slate-100"
            />
          </section>
        )}

        {/* Paso 3 */}
        {track && (
          <section className="space-y-3">
            <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">3 · Ritmo</h2>
            <PaceConfigPanel
              config={paceConfig}
              hasGpxTimes={hasGpxTimes}
              onChange={(c) => { setPaceConfig(c); reset() }}
            />
          </section>
        )}

        {/* Paso 4 */}
        {track && (
          <section className="space-y-3">
            <h2 className="text-slate-400 text-xs uppercase tracking-widest font-semibold">4 · Detalle de waypoints</h2>
            <SamplingPanel
              config={sampling}
              totalKm={track.totalDistanceKm}
              onChange={(c) => { setSampling(c); reset() }}
            />
          </section>
        )}

        {/* Botón */}
        {track && (
          <button
            onClick={handleCompute}
            disabled={isLoading}
            className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors text-base flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Consultando…
              </>
            ) : (
              'Calcular y obtener previsión →'
            )}
          </button>
        )}

        {/* Progreso Nominatim */}
        {isLoading && locationProgress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Obteniendo comarcas…</span>
              <span>{locationProgress.done}/{locationProgress.total}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${(locationProgress.done / locationProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error fatal */}
        {errorMsg && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl px-5 py-4 text-red-300 text-sm">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}

        {/* Aviso no-fatal: localidades no disponibles */}
        {locationWarning && (
          <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-3 text-amber-400 text-sm flex items-center gap-2">
            <span>⚠️</span>
            <span>Población/comarca no disponible ({locationWarning}). La previsión meteorológica sigue activa.</span>
          </div>
        )}

        {/* Resumen meteorológico */}
        {enrichedWaypoints.some((w) => w.weather) && (
          <WeatherSummary waypoints={enrichedWaypoints} />
        )}

        {/* Mapa */}
        {track && baseWaypoints.length > 0 && (
          <RouteMap
            track={track}
            waypoints={enrichedWaypoints}
            mapMode={mapMode}
            onMapModeChange={setMapMode}
          />
        )}

        {/* Gráficas */}
        {enrichedWaypoints.some((w) => w.weather) && (
          <WeatherCharts waypoints={enrichedWaypoints} />
        )}

        {/* Tabla */}
        {baseWaypoints.length > 0 && (
          <WaypointsTable waypoints={enrichedWaypoints} startTime={startTime} />
        )}

        {/* Exportar PDF */}
        {isDone && (
          <div className="flex justify-end pt-2 pb-8">
            <button
              onClick={handleExportPdf}
              disabled={pdfLoading}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-200 font-medium py-2.5 px-5 rounded-xl transition-colors text-sm border border-slate-600"
            >
              {pdfLoading ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />
                  Generando PDF…
                </>
              ) : (
                <>
                  <span>📄</span>
                  Exportar PDF
                </>
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function WeatherSummary({ waypoints }: { waypoints: ReturnType<typeof useMemo> }) {
  const wps = (waypoints as Array<{ weather: { temperatureC: number; precipProbability: number } | null }>)
    .filter((w) => w.weather !== null)
  if (wps.length === 0) return null

  const temps = wps.map((w) => w.weather!.temperatureC)
  const probs = wps.map((w) => w.weather!.precipProbability)
  const maxProb = Math.max(...probs)
  const minTemp = Math.min(...temps)
  const maxTemp = Math.max(...temps)
  const rainyCount = probs.filter((p) => p >= 50).length
  const risk = maxProb >= 70 ? 'alto' : maxProb >= 40 ? 'moderado' : 'bajo'
  const riskColor = maxProb >= 70 ? 'text-blue-400' : maxProb >= 40 ? 'text-yellow-400' : 'text-green-400'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Riesgo lluvia', value: risk, color: riskColor },
        { label: 'Prob. máx.', value: `${maxProb}%`, color: maxProb >= 70 ? 'text-blue-400' : 'text-slate-200' },
        { label: 'Temperatura', value: `${minTemp.toFixed(0)}–${maxTemp.toFixed(0)}°C`, color: 'text-slate-200' },
        { label: 'Tramos con lluvia', value: `${rainyCount} / ${wps.length}`, color: rainyCount > 0 ? 'text-sky-400' : 'text-green-400' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-slate-800 rounded-xl px-4 py-4 text-center">
          <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}
