import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { GpxUploader } from './components/GpxUploader'
import { PaceConfigPanel } from './components/PaceConfig'
import { SamplingPanel } from './components/SamplingPanel'
import { RouteMap } from './components/RouteMap'
import type { MapMode } from './components/RouteMap'
import { WeatherCharts } from './components/WeatherCharts'
import { WaypointsTable } from './components/WaypointsTable'
import type { GpxTrack } from './lib/gpx'
import type { PaceConfig, SamplingConfig, Waypoint } from './lib/timing'
import { computeWaypoints, DEFAULT_SAMPLING, formatTime } from './lib/timing'
import type { WeatherData } from './lib/weather'
import { fetchWeatherForWaypoints } from './lib/weather'
import type { LocationInfo } from './lib/places'
import { fetchLocationForWaypoints } from './lib/places'
import { useLivePosition } from './lib/useLivePosition'
import { useFreshnessLabel } from './lib/useFreshnessLabel'

const DEFAULT_PACE: PaceConfig = {
  mode: 'fixed',
  paceMinPerKm: 5.5,
  naismithMin100mUp: 6,
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type LoadStatus = 'idle' | 'loading' | 'live-loading' | 'done' | 'error'
type AppMode = 'plan' | 'live'

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

  const [baseWaypoints, setBaseWaypoints] = useState<Waypoint[]>([])
  const [weatherArr, setWeatherArr] = useState<(WeatherData | null)[]>([])
  const [locationArr, setLocationArr] = useState<(LocationInfo | null)[]>([])

  const [mapMode, setMapMode] = useState<MapMode>('rain')
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [locationProgress, setLocationProgress] = useState({ done: 0, total: 0 })
  const [pdfLoading, setPdfLoading] = useState(false)

  // ── Weather freshness ──────────────────────────────────────────────────────
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<Date | null>(null)
  const [refreshingWeather, setRefreshingWeather] = useState(false)
  /** true = show "has estado fuera X min" banner */
  const [returnBanner, setReturnBanner] = useState(false)

  // ── App mode ───────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>('plan')

  // ── GPS live position ──────────────────────────────────────────────────────
  const livePos = useLivePosition(track, appMode === 'live')

  const hasGpxTimes = !!track?.points.some((p) => p.time)

  // ── Enriched waypoints (plan base) ────────────────────────────────────────
  const enrichedWaypoints = useMemo(
    () =>
      baseWaypoints.map((w, i) => ({
        ...w,
        weather: weatherArr[i] ?? null,
        location: locationArr[i] ?? null,
      })),
    [baseWaypoints, weatherArr, locationArr],
  )

  // ── Live waypoints: remaining only, ETAs from now ─────────────────────────
  // Also tracks which original indices survived the filter (for weather re-fetch)
  const { liveWaypoints, liveOriginalIndices } = useMemo(() => {
    if (appMode !== 'live' || !livePos.coords) {
      return {
        liveWaypoints: enrichedWaypoints,
        liveOriginalIndices: enrichedWaypoints.map((_, i) => i),
      }
    }
    const now = Date.now()
    const lockedKm = livePos.trackKm
    const wps: typeof enrichedWaypoints = []
    const idxs: number[] = []
    enrichedWaypoints.forEach((wp, i) => {
      if (wp.distanceKm >= lockedKm - 0.05) {
        wps.push({
          ...wp,
          estimatedTime: new Date(
            now + Math.max(0, wp.distanceKm - lockedKm) * paceConfig.paceMinPerKm * 60000,
          ),
        })
        idxs.push(i)
      }
    })
    return { liveWaypoints: wps, liveOriginalIndices: idxs }
  }, [appMode, livePos.coords, livePos.trackKm, enrichedWaypoints, paceConfig.paceMinPerKm])

  // Keep a ref to the latest live waypoints/indices so the effect below can
  // read them without re-firing on every GPS update
  const liveDataRef = useRef({ liveWaypoints, liveOriginalIndices })
  liveDataRef.current = { liveWaypoints, liveOriginalIndices }

  // Flag: true once weather has been re-fetched for this live session
  const liveWeatherFetchedRef = useRef(false)

  // ── Re-fetch weather on first GPS fix in live mode ─────────────────────────
  useEffect(() => {
    if (appMode !== 'live') {
      liveWeatherFetchedRef.current = false
      return
    }
    if (!livePos.coords || liveWeatherFetchedRef.current) return

    liveWeatherFetchedRef.current = true
    const { liveWaypoints: wps, liveOriginalIndices: idxs } = liveDataRef.current
    if (wps.length === 0) return

    fetchWeatherForWaypoints(wps)
      .then((results) => {
        setWeatherArr((prev) => {
          const next = [...prev]
          results.forEach((r, i) => { next[idxs[i]] = r.weather })
          return next
        })
        setWeatherFetchedAt(new Date())
      })
      .catch(console.error)
  }, [appMode, livePos.coords])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function reset() {
    setBaseWaypoints([])
    setWeatherArr([])
    setLocationArr([])
    setStatus('idle')
    setErrorMsg(null)
    setLocationWarning(null)
    setLocationProgress({ done: 0, total: 0 })
    setWeatherFetchedAt(null)
    setReturnBanner(false)
  }

  function handleTrack(t: GpxTrack) {
    setTrack(t)
    setAppMode('plan')
    liveWeatherFetchedRef.current = false
    reset()
    if (t.points.some((p) => p.time)) {
      setPaceConfig((c) => ({ ...c, mode: 'gpx' }))
    }
  }

  // Plan mode: full compute with configured start time + sampling
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

      const weatherPromise = fetchWeatherForWaypoints(wps).then((results) => {
        setWeatherArr(results.map((r) => r.weather))
        setWeatherFetchedAt(new Date())
      })

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

  // Live shortcut: use now() + auto sampling, skip date/time and waypoint steps,
  // switch directly to live mode after fetching weather
  async function handleComputeLive() {
    if (!track) return
    setStatus('live-loading')
    setErrorMsg(null)
    liveWeatherFetchedRef.current = true // weather will be current; no need to re-fetch on GPS fix

    try {
      const now = new Date()
      const wps = computeWaypoints(track, now, paceConfig, DEFAULT_SAMPLING)
      setBaseWaypoints(wps)
      setLocationArr(wps.map(() => null))
      setWeatherArr(wps.map(() => null))

      const results = await fetchWeatherForWaypoints(wps)
      setWeatherArr(results.map((r) => r.weather))
      setWeatherFetchedAt(new Date())
      setStatus('done')
      setAppMode('live')  // enter live mode right away
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('idle')
    }
  }

  // ── Refresh weather manually ───────────────────────────────────────────────
  async function handleRefreshWeather() {
    if (refreshingWeather) return
    setRefreshingWeather(true)
    setReturnBanner(false)
    try {
      if (appMode === 'live') {
        // Only refresh pending waypoints
        const { liveWaypoints: wps, liveOriginalIndices: idxs } = liveDataRef.current
        if (wps.length === 0) return
        const results = await fetchWeatherForWaypoints(wps)
        setWeatherArr((prev) => {
          const next = [...prev]
          results.forEach((r, i) => { next[idxs[i]] = r.weather })
          return next
        })
      } else {
        // Plan mode: refresh all
        const results = await fetchWeatherForWaypoints(baseWaypoints)
        setWeatherArr(results.map((r) => r.weather))
      }
      setWeatherFetchedAt(new Date())
    } catch (err) {
      console.error('Weather refresh failed:', err)
    } finally {
      setRefreshingWeather(false)
    }
  }

  const isLoading = status === 'loading'
  const isLiveLoading = status === 'live-loading'
  const isDone = status === 'done' && baseWaypoints.length > 0

  // ── Visibility change: show banner after ≥ 30 min in background ───────────
  useEffect(() => {
    if (!isDone) return
    let hiddenAt: number | null = null
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        const awayMs = Date.now() - hiddenAt
        hiddenAt = null
        if (awayMs >= 30 * 60_000) setReturnBanner(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [isDone])

  async function handleExportPdf() {
    if (!track || !isDone) return
    setPdfLoading(true)
    try {
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

  const liveEta = liveWaypoints.length > 0
    ? liveWaypoints[liveWaypoints.length - 1].estimatedTime
    : null
  const liveRemainingKm = track
    ? Math.max(0, track.totalDistanceKm - livePos.trackKm)
    : 0

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">🌧️</span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SiLoSeNoSalgo</h1>
            <p className="text-slate-500 text-xs">Previsión meteorológica a lo largo de tu ruta GPX</p>
          </div>
          {isDone && (
            <div className="ml-auto flex rounded-lg overflow-hidden border border-slate-700 text-xs">
              <button
                onClick={() => setAppMode('plan')}
                className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'plan' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                🗺️ <span className="hidden sm:inline">Planificar</span>
              </button>
              <button
                onClick={() => { setAppMode('live') }}
                className={`px-3 py-2 transition-colors flex items-center gap-1.5 ${appMode === 'live' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                📍 <span className="hidden sm:inline">En vivo</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Paso 1: GPX ── */}
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
                onClick={() => { setTrack(null); setAppMode('plan'); reset() }}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors shrink-0"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <GpxUploader onTrackLoaded={handleTrack} />
          )}
        </section>

        {/* ── Plan mode sections ── */}
        {appMode === 'plan' && (
          <>
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

            {track && (
              <div className="space-y-3">
                {/* Primary: plan mode */}
                <button
                  onClick={handleCompute}
                  disabled={isLoading || isLiveLoading}
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

                {/* Secondary: live shortcut */}
                <button
                  onClick={handleComputeLive}
                  disabled={isLoading || isLiveLoading}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-600 border border-slate-600 hover:border-sky-700 text-slate-300 font-medium py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {isLiveLoading ? (
                    <>
                      <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />
                      Preparando modo en vivo…
                    </>
                  ) : (
                    <>📍 Ya estoy en ruta — calcular ahora y abrir modo en vivo</>
                  )}
                </button>
              </div>
            )}

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

            {errorMsg && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl px-5 py-4 text-red-300 text-sm">
                <strong>Error:</strong> {errorMsg}
              </div>
            )}

            {locationWarning && (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-5 py-3 text-amber-400 text-sm flex items-center gap-2">
                <span>⚠️</span>
                <span>Población/comarca no disponible ({locationWarning}). La previsión meteorológica sigue activa.</span>
              </div>
            )}
          </>
        )}

        {/* ── Return-from-background banner ── */}
        {returnBanner && isDone && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm">
            <span>⏰</span>
            <span className="flex-1">Has estado fuera un rato — la previsión puede estar desactualizada.</span>
            <button
              onClick={handleRefreshWeather}
              disabled={refreshingWeather}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-medium transition-colors"
            >
              {refreshingWeather
                ? <><span className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full inline-block" /> Actualizando…</>
                : <>↻ Actualizar</>}
            </button>
            <button
              onClick={() => setReturnBanner(false)}
              className="text-amber-500 hover:text-amber-300 transition-colors text-lg leading-none px-1"
              aria-label="Cerrar"
            >×</button>
          </div>
        )}

        {/* ── Live mode: GPS status bar ── */}
        {appMode === 'live' && (
          <div className={`flex flex-wrap items-center gap-3 px-5 py-3.5 rounded-xl text-sm ${
            livePos.error
              ? 'bg-red-900/30 border border-red-700/50 text-red-400'
              : livePos.isLocating
              ? 'bg-slate-800 border border-slate-700 text-slate-400'
              : 'bg-sky-900/20 border border-sky-800/40 text-sky-300'
          }`}>
            {livePos.error ? (
              <><span>⚠️</span><span>{livePos.error}</span></>
            ) : livePos.isLocating ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full inline-block flex-shrink-0" />
                <span>Localizando posición GPS…</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 bg-sky-400 rounded-full animate-pulse flex-shrink-0" />
                <span className="font-mono">
                  Km <span className="font-semibold text-sky-200">{livePos.trackKm.toFixed(1)}</span>
                  {' · '}
                  Quedan <span className="font-semibold text-sky-200">{liveRemainingKm.toFixed(1)} km</span>
                </span>
                {liveEta && (
                  <span className="text-slate-400 text-xs">
                    Llegada estimada:{' '}
                    <span className="text-sky-300 font-semibold">{formatTime(liveEta)}</span>
                  </span>
                )}
              </>
            )}
            {/* Freshness chip — always shown in live bar once data is available */}
            <WeatherFreshnessChip
              fetchedAt={weatherFetchedAt}
              onRefresh={handleRefreshWeather}
              refreshing={refreshingWeather}
              className="ml-auto"
            />
          </div>
        )}

        {/* ── Weather summary (plan mode only) ── */}
        {appMode === 'plan' && enrichedWaypoints.some((w) => w.weather) && (
          <>
            <WeatherSummary waypoints={enrichedWaypoints} />
            <WeatherFreshnessChip
              fetchedAt={weatherFetchedAt}
              onRefresh={handleRefreshWeather}
              refreshing={refreshingWeather}
            />
          </>
        )}

        {/* ── Map ── */}
        {track && baseWaypoints.length > 0 && (
          <RouteMap
            track={track}
            waypoints={appMode === 'live' ? liveWaypoints : enrichedWaypoints}
            mapMode={mapMode}
            onMapModeChange={setMapMode}
            liveMode={appMode === 'live'}
            liveCoords={livePos.coords}
            liveProgress={livePos.progress}
          />
        )}

        {/* ── Charts (plan mode only) ── */}
        {appMode === 'plan' && enrichedWaypoints.some((w) => w.weather) && (
          <WeatherCharts waypoints={enrichedWaypoints} />
        )}

        {/* ── Waypoints table ── */}
        {baseWaypoints.length > 0 && (
          <>
            {appMode === 'live' && livePos.coords && liveWaypoints.length < enrichedWaypoints.length && (
              <p className="text-slate-500 text-xs text-center">
                Mostrando {liveWaypoints.length} waypoints restantes
                · {enrichedWaypoints.length - liveWaypoints.length} ya pasados ocultos
              </p>
            )}
            <WaypointsTable
              waypoints={appMode === 'live' ? liveWaypoints : enrichedWaypoints}
              startTime={appMode === 'live' ? new Date() : startTime}
            />
          </>
        )}

        {/* ── PDF export (plan mode only) ── */}
        {isDone && appMode === 'plan' && (
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
                <><span>📄</span> Exportar PDF</>
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// ── WeatherFreshnessChip ────────────────────────────────────────────────────
function WeatherFreshnessChip({
  fetchedAt,
  onRefresh,
  refreshing,
  className = '',
}: {
  fetchedAt: Date | null
  onRefresh: () => void
  refreshing: boolean
  className?: string
}) {
  const freshness = useFreshnessLabel(fetchedAt)
  if (!freshness) return null

  const colorClass =
    freshness.severity === 'fresh' ? 'text-green-400' :
    freshness.severity === 'stale' ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <span className={colorClass}>⏱ Meteo: {freshness.label}</span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition-colors text-slate-300 border border-slate-600"
        title="Actualizar previsión meteorológica"
      >
        {refreshing
          ? <span className="animate-spin w-3 h-3 border border-slate-400 border-t-transparent rounded-full inline-block" />
          : <span>↻</span>}
        <span>Actualizar</span>
      </button>
    </div>
  )
}

// ── WeatherSummary ──────────────────────────────────────────────────────────
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
