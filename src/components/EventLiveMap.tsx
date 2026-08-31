import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../lib/AuthContext'
import { eventColorHex } from '../../shared/eventColors'
import type { EventLiveRunner } from '../../shared/wireTypes'
import { getEventLive, getEventPlan, eventsErrorMessage, EventsError } from '../lib/eventsTransport'
import type { SharePayloadV1 } from '../lib/sharePayload'

/**
 * El mapa del evento: todos los participantes a la vez, cada uno con su color.
 *
 * Es una pantalla APARTE del visor individual y no un modo suyo. El visor de
 * una baliza cuenta UNA carrera con todo el detalle —perfil, cortes, notas,
 * ánimos, previsiones—; aquí la pregunta es otra y mucho más simple: quién va
 * dónde. Meterlo dentro del visor habría sido empujar dos productos distintos
 * dentro de las mismas dos mil líneas.
 *
 * Al tocar a alguien se abre su ficha, y de ahí se salta a su baliza completa:
 * lo detallado sigue viviendo donde ya estaba, sin duplicar nada.
 */

const POLL_MS = 10_000
/** Pasado esto sin noticias, el punto se apaga: quieto no es lo mismo que sin señal. */
const STALE_MS = 6 * 60_000

export default function EventLiveMap({ id }: { id: string }) {
  const { user, status } = useAuth()
  const [runners, setRunners] = useState<EventLiveRunner[] | null>(null)
  const [plan, setPlan] = useState<SharePayloadV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  // La ruta se descarga UNA vez: son cientos de KB y no cambia en toda la
  // carrera, al revés que las posiciones.
  const planLoaded = useRef<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const live = await getEventLive(id)
      setRunners(live.runners)
      setError(null)
      if (live.planShareId && planLoaded.current !== live.planShareId) {
        planLoaded.current = live.planShareId
        try { setPlan(await getEventPlan(live.planShareId)) } catch { /* sin ruta se pinta igual */ }
      }
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
  }, [id])

  useEffect(() => {
    if (status !== 'ready' || !user) return
    void poll()
    const t = window.setInterval(() => void poll(), POLL_MS)
    // Un segundo reloj, solo para que "hace 3 min" envejezca a la vista aunque
    // no llegue nada nuevo: sin esto un mapa sin cobertura parece fresco.
    const t2 = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { window.clearInterval(t); window.clearInterval(t2) }
  }, [poll, status, user])

  const route = useMemo(() => {
    if (!plan) return null
    const pts = plan.track.points.map((p) => [p.lat, p.lon] as [number, number])
    return { pts, cumKm: plan.track.cumKm, totalKm: plan.track.totalDistanceKm }
  }, [plan])

  const withFix = useMemo(() => (runners ?? []).filter((r) => r.fix), [runners])
  const sel = useMemo(() => withFix.find((r) => r.userId === selected) ?? null, [withFix, selected])

  if (status !== 'ready') return <Shell><p className="text-sm text-slate-400">Cargando…</p></Shell>
  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">Inicia sesión para ver el mapa del evento.</p>
        <a href="/" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
      </Shell>
    )
  }
  if (error && !runners) {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error}</p>
        <a href={`/?e=${encodeURIComponent(id)}`} className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">← Volver al evento</a>
      </Shell>
    )
  }

  const center: [number, number] = withFix[0]?.fix
    ? [withFix[0].fix!.lat, withFix[0].fix!.lon]
    : route?.pts[0] ?? [42.7, -0.52]

  return (
    <div className="relative h-[100dvh] w-full bg-slate-950">
      <MapContainer center={center} zoom={13} className="h-full w-full" zoomControl={false} attributionControl={false}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* El recorrido, una sola vez: es de la carrera, no de cada corredor.
            Va en DOS trazos, uno encima del otro: un halo blanco ancho debajo y
            la línea de color encima. Sin el halo, en el mapa base se pierde —
            OSM pinta los senderos en violeta discontinuo, exactamente lo que
            parecía el recorrido, y en el valle de Canfranc hay decenas. El halo
            lo despega de cualquier fondo (bosque, roca, nieve) sin depender de
            acertar con un color que no choque con nada. Y sólida, no
            discontinua: la discontinua es la de los senderos del mapa. */}
        {route && (
          <>
            <Polyline positions={route.pts} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
            <Polyline positions={route.pts} pathOptions={{ color: '#6d28d9', weight: 4, opacity: 1 }} />
          </>
        )}

        {withFix.map((r) => {
          const color = r.color ? eventColorHex(r.color) : '#94a3b8'
          const stale = r.status === 'ended' || (r.updatedAt !== null && now - r.updatedAt > STALE_MS)
          const isSel = r.userId === selected
          return (
            <div key={r.userId}>
              {/* La cola: por dónde viene. Apagada si ya no está en directo.
                  Con una sombra oscura debajo: la paleta tiene colores claros
                  —lima, ámbar— que sobre un mapa de fondo claro casi
                  desaparecen, y la sombra los levanta sin cambiarles el tono,
                  que es lo que identifica a cada corredor. */}
              {r.tail.length > 1 && (
                <>
                  <Polyline
                    positions={r.tail.map((p) => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#020617', weight: isSel ? 8 : 6, opacity: stale ? 0.12 : 0.25 }}
                  />
                  <Polyline
                    positions={r.tail.map((p) => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color, weight: isSel ? 5 : 3, opacity: stale ? 0.4 : 0.95 }}
                  />
                </>
              )}
              <Marker
                position={[r.fix!.lat, r.fix!.lon]}
                icon={runnerIcon(color, isSel, stale)}
                eventHandlers={{ click: () => setSelected(isSel ? null : r.userId) }}
              />
              {isSel && (
                <CircleMarker
                  center={[r.fix!.lat, r.fix!.lon]}
                  radius={18}
                  pathOptions={{ color, weight: 2, fill: false, opacity: 0.8 }}
                />
              )}
            </div>
          )
        })}

        <FitAll runners={withFix} routeFirst={route?.pts[0]} />
      </MapContainer>

      {/* Cabecera: volver y cuántos hay en directo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        <a
          href={`/?e=${encodeURIComponent(id)}`}
          className="pointer-events-auto rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-sky-700"
        >
          ← Evento
        </a>
        <span className="pointer-events-none rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
          {withFix.filter((r) => r.status === 'active').length} en directo
        </span>
      </div>

      {/* Tira de participantes: tocar uno lo enfoca. Es la leyenda del mapa y
          el selector a la vez — con diez puntos de colores, una leyenda que no
          sirve para seleccionar obliga a acertarle al punto con el dedo. */}
      <div className="absolute inset-x-0 bottom-0 z-[1000] p-3">
        {sel && <RunnerCard r={sel} now={now} route={route} onClose={() => setSelected(null)} />}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {(runners ?? []).map((r) => {
            const color = r.color ? eventColorHex(r.color) : '#94a3b8'
            const isSel = r.userId === selected
            return (
              <button
                key={r.userId}
                onClick={() => setSelected(isSel ? null : r.userId)}
                disabled={!r.fix}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition-colors disabled:opacity-40 ${
                  isSel ? 'border-slate-300 bg-slate-800/90 text-slate-100' : 'border-slate-700 bg-slate-900/90 text-slate-300'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {r.username}
              </button>
            )
          })}
        </div>
      </div>

      {runners !== null && withFix.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[900] grid place-items-center p-6">
          <p className="pointer-events-auto max-w-xs rounded-xl border border-slate-700 bg-slate-900/95 p-4 text-center text-sm text-slate-300">
            Todavía no hay nadie emitiendo en este evento. Cuando alguien empiece a compartir su posición y una su baliza al evento, aparecerá aquí.
          </p>
        </div>
      )}
    </div>
  )
}

/** La ficha del corredor elegido: lo justo para saber cómo va. */
function RunnerCard({ r, now, route, onClose }: {
  r: EventLiveRunner
  now: number
  route: { pts: [number, number][]; cumKm: number[]; totalKm: number } | null
  onClose: () => void
}) {
  const color = r.color ? eventColorHex(r.color) : '#94a3b8'
  const km = route && r.fix ? projectKm(r.fix.lat, r.fix.lon, route) : null
  const ago = r.updatedAt !== null ? agoLabel(now - r.updatedAt) : null
  const stale = r.status === 'ended' || (r.updatedAt !== null && now - r.updatedAt > STALE_MS)
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 p-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-sm font-bold text-slate-100">{r.username}</span>
        {r.status === 'ended' && <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">terminado</span>}
        <button onClick={onClose} className="ml-auto shrink-0 text-lg leading-none text-slate-500 hover:text-slate-300">×</button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Dato valor={km !== null ? `${km.toFixed(1)}` : '—'} unidad={route ? `de ${route.totalKm.toFixed(0)} km` : 'km'} />
        <Dato valor={r.fix?.speed != null ? paceOrSpeed(r.fix.speed, r.activity) : '—'} unidad={isFoot(r.activity) ? 'min/km' : 'km/h'} />
        <Dato valor={ago ?? '—'} unidad="última señal" tono={stale ? 'text-amber-400' : 'text-slate-100'} />
      </div>
      <a
        href={`/?t=${encodeURIComponent(r.sessionId)}`}
        className="mt-2 block rounded-lg border border-slate-700 py-1.5 text-center text-xs text-sky-400 hover:bg-sky-950/40"
      >
        Ver su baliza completa →
      </a>
    </div>
  )
}

function Dato({ valor, unidad, tono = 'text-slate-100' }: { valor: string; unidad: string; tono?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-1 py-1.5">
      <div className={`text-sm font-bold tabular-nums ${tono}`}>{valor}</div>
      <div className="text-[10px] text-slate-500">{unidad}</div>
    </div>
  )
}

/** Encuadra a todos la PRIMERA vez que hay posiciones; después no toca el mapa
 *  —moverlo bajo el dedo de quien está mirando es lo más molesto que puede
 *  hacer un mapa en vivo. */
function FitAll({ runners, routeFirst }: { runners: EventLiveRunner[]; routeFirst?: [number, number] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    const pts = runners.filter((r) => r.fix).map((r) => [r.fix!.lat, r.fix!.lon] as [number, number])
    if (pts.length === 0) return
    done.current = true
    if (pts.length === 1) { map.setView(pts[0], 14); return }
    map.fitBounds(L.latLngBounds(pts.concat(routeFirst ? [routeFirst] : [])), { padding: [48, 48] })
  }, [runners, routeFirst, map])
  return null
}

/** Icono del corredor: un punto de su color, más grande si está elegido. Se
 *  cachean por variante para no reiniciar la animación en cada refresco. */
const iconCache = new Map<string, L.DivIcon>()
function runnerIcon(color: string, selected: boolean, stale: boolean): L.DivIcon {
  const key = `${color}|${selected}|${stale}`
  const hit = iconCache.get(key)
  if (hit) return hit
  const size = selected ? 22 : 16
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
      border:2px solid ${selected ? '#f8fafc' : 'rgba(2,6,23,0.85)'};opacity:${stale ? 0.45 : 1};
      box-shadow:0 0 0 1px rgba(2,6,23,0.6)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
  iconCache.set(key, icon)
  return icon
}

/** Kilómetro de carrera: el vértice más cercano de la ruta. Sin ventana
 *  temporal como en el visor individual — aquí basta con "por dónde va", y una
 *  ida y vuelta ambigua se resuelve entrando en su baliza. */
function projectKm(lat: number, lon: number, route: { pts: [number, number][]; cumKm: number[] }): number | null {
  let bi = -1, bd = Infinity
  for (let i = 0; i < route.pts.length; i++) {
    const d = (route.pts[i][0] - lat) ** 2 + ((route.pts[i][1] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bd) { bd = d; bi = i }
  }
  return bi >= 0 ? route.cumKm[bi] ?? null : null
}

function isFoot(a?: string | null): boolean { return a === 'walk' || a === 'run' || a == null }

function paceOrSpeed(speedMs: number, activity?: string | null): string {
  const kmh = speedMs * 3.6
  if (!isFoot(activity)) return kmh.toFixed(1)
  if (kmh < 0.5) return '—'
  const minPerKm = 60 / kmh
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${Math.floor(s / 3600)} h`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </div>
  )
}
