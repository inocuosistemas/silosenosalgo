import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../lib/AuthContext'
import { eventColorHex } from '../../shared/eventColors'
import type { EventPublicRunner } from '../../shared/wireTypes'
import {
  getEventLive, getEventPublic, getEventPlan, eventsErrorMessage, EventsError,
} from '../lib/eventsTransport'
import type { SharePayloadV1 } from '../lib/sharePayload'
import {
  eventCutoffs, marginToNextCutoff, formatMargin, marginTone, type EventCutoff,
} from '../lib/eventCutoffs'
import { isHttpUrl } from '../../shared/validate'
import { MarkBadge } from './MarkPicker'

/**
 * El mapa del evento: todos los participantes a la vez, cada uno con su color.
 *
 * Es una pantalla APARTE del visor individual y no un modo suyo. El visor de
 * una baliza cuenta UNA carrera con todo el detalle —perfil, cortes, notas,
 * ánimos, previsiones—; aquí la pregunta es otra y mucho más simple: quién va
 * dónde, y si llega a los cortes.
 *
 * Sirve a dos públicos con la misma pantalla:
 *  - PARTICIPANTES (`?e=<id>&mapa=1`), con sesión, que además pueden saltar a
 *    la baliza completa de cualquiera;
 *  - QUIEN ESPERA EN META (`?ev=<token>`), sin cuenta, con el enlace que
 *    reparte el organizador. Ve lo mismo en el mapa, sin ids ni enlaces a las
 *    balizas individuales — publicar el evento no publica la baliza de cada uno.
 */

const POLL_MS = 10_000
/** Pasado esto sin noticias, el punto se apaga: quieto no es lo mismo que sin señal. */
const STALE_MS = 6 * 60_000

/** Lo que la pantalla necesita de un corredor, venga del endpoint que venga. */
type Runner = EventPublicRunner & { userId?: string; sessionId?: string }

type Source = { kind: 'member'; id: string } | { kind: 'public'; token: string }

export default function EventLiveMap({ source }: { source: Source }) {
  const { user, status } = useAuth()
  const isPublic = source.kind === 'public'
  const [runners, setRunners] = useState<Runner[] | null>(null)
  const [eventName, setEventName] = useState<string | null>(null)
  const [links, setLinks] = useState<{ trackingUrl: string | null; websiteUrl: string | null }>(
    { trackingUrl: null, websiteUrl: null })
  const [plan, setPlan] = useState<SharePayloadV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'mapa' | 'lista'>('mapa')
  const [now, setNow] = useState(Date.now())
  /** Zoom actual: por debajo de cierto acercamiento los emojis no se leen. */
  const [zoom, setZoom] = useState(13)
  /**
   * A quién sigue el mapa. Con cien participantes repartidos por un valle, la
   * pregunta deja de ser "¿cómo van todos?" y pasa a ser "¿dónde va el mío?":
   * sin esto hay que buscarlo a mano en el mapa cada vez que se refresca.
   */
  const [following, setFollowing] = useState<string | null>(null)
  // La ruta se descarga UNA vez: son cientos de KB y no cambia en toda la
  // carrera, al revés que las posiciones.
  const planLoaded = useRef<string | null>(null)

  const poll = useCallback(async () => {
    try {
      if (source.kind === 'public') {
        const live = await getEventPublic(source.token)
        setRunners(live.runners)
        setEventName(live.name)
        setLinks({ trackingUrl: live.trackingUrl, websiteUrl: live.websiteUrl })
        await loadPlan(live.planShareId)
      } else {
        const live = await getEventLive(source.id)
        setRunners(live.runners as Runner[])
        await loadPlan(live.planShareId)
      }
      setError(null)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
    async function loadPlan(shareId: string | null) {
      if (!shareId || planLoaded.current === shareId) return
      planLoaded.current = shareId
      try { setPlan(await getEventPlan(shareId)) } catch { /* sin ruta se pinta igual */ }
    }
  }, [source])

  useEffect(() => {
    // El público no necesita sesión; el de participantes sí, y hasta que se
    // sabe quién mira no se pide nada.
    if (!isPublic && (status !== 'ready' || !user)) return
    void poll()
    const t = window.setInterval(() => void poll(), POLL_MS)
    // Un segundo reloj, solo para que "hace 3 min" envejezca a la vista aunque
    // no llegue nada nuevo: sin esto un mapa sin cobertura parece fresco.
    const t2 = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { window.clearInterval(t); window.clearInterval(t2) }
  }, [poll, status, user, isPublic])

  const route = useMemo(() => {
    if (!plan) return null
    const pts = plan.track.points.map((p) => [p.lat, p.lon] as [number, number])
    return { pts, cumKm: plan.track.cumKm, totalKm: plan.track.totalDistanceKm }
  }, [plan])
  // Los cierres son de la CARRERA: se calculan una vez para todos, no por
  // corredor.
  const cutoffs = useMemo<EventCutoff[]>(() => (plan ? eventCutoffs(plan) : []), [plan])

  /**
   * Los puntos del recorrido: avituallamientos, controles, cimas — lo que
   * traiga el GPX de la organización.
   *
   * Sin ellos el mapa común dice dónde va cada uno pero no CONTRA QUÉ: "va por
   * el 42" no significa nada hasta que se ve que el 42 es el avituallamiento
   * grande y que el corte está justo después. Los que tienen hora de cierre se
   * marcan aparte, que son los que de verdad aprietan.
   */
  const pois = useMemo(() => {
    if (!plan) return []
    const cierres = new Map(cutoffs.map((c) => [c.name, c.at]))
    return plan.track.namedWaypoints.map((w) => ({
      lat: w.lat, lon: w.lon, name: w.name, km: w.distanceKm,
      cutoffAt: cierres.get(w.name) ?? null,
    }))
  }, [plan, cutoffs])

  /** Cada corredor con lo derivado: km sobre el recorrido y margen al corte. */
  const rows = useMemo(() => {
    return (runners ?? []).map((r) => {
      const km = route && r.fix ? projectKm(r.fix.lat, r.fix.lon, route) : null
      const margin = km !== null && cutoffs.length > 0 && r.status === 'active' && r.startedAt !== null
        ? marginToNextCutoff(cutoffs, km, r.startedAt, r.updatedAt ?? now)
        : null
      const stale = r.status === 'ended' || (r.updatedAt !== null && now - r.updatedAt > STALE_MS)
      // Quien no ha abierto baliza no está "sin señal": está sin empezar, y son
      // dos cosas distintas para quien mira (una se arregla esperando, la otra
      // llamando por teléfono).
      const idle = r.status === 'idle'
      return { r, km, margin, stale, idle, key: r.userId ?? r.username }
    }).sort((a, b) => (b.km ?? -1) - (a.km ?? -1))
  }, [runners, route, cutoffs, now])

  /** Cuántos de la parrilla todavía no emiten — el mapa lo dice cuando no hay nadie. */
  const idleCount = useMemo(() => rows.filter((x) => x.idle).length, [rows])

  const withFix = useMemo(() => rows.filter((x) => x.r.fix), [rows])
  const sel = useMemo(() => withFix.find((x) => x.key === selected) ?? null, [withFix, selected])
  const followed = useMemo(() => withFix.find((x) => x.key === following) ?? null, [withFix, following])

  if (!isPublic && status !== 'ready') return <Shell><p className="text-sm text-slate-400">Cargando…</p></Shell>
  if (!isPublic && !user) {
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
        {!isPublic && (
          <a href={`/?e=${encodeURIComponent((source as { id: string }).id)}`} className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">← Volver a la parrilla</a>
        )}
      </Shell>
    )
  }

  // Con poca gente los emojis salen siempre; con muchos, solo al acercarse.
  const showEmoji = withFix.length <= EMOJI_ALWAYS_UNDER || zoom >= EMOJI_ZOOM
  /** Los nombres de los puntos, solo cuando hay sitio para leerlos. */
  const showPoiNames = zoom >= POI_NAMES_ZOOM || pois.length <= 6

  const center: [number, number] = withFix[0]?.r.fix
    ? [withFix[0].r.fix!.lat, withFix[0].r.fix!.lon]
    : route?.pts[0] ?? [42.7, -0.52]

  return (
    <div className="relative h-[100dvh] w-full bg-slate-950">
      {view === 'mapa' ? (
        <MapContainer center={center} zoom={13} className="h-full w-full" zoomControl={false} attributionControl={false}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ZoomWatch onZoom={setZoom} />

          {/* El recorrido, una sola vez: es de la carrera, no de cada corredor.
              Va en DOS trazos, uno encima del otro: un halo blanco ancho debajo
              y la línea de color encima. Sin el halo se pierde — OSM pinta los
              senderos en violeta discontinuo, exactamente lo que parecía el
              recorrido. Sólida, además, que la discontinua es la de ellos. */}
          {route && (
            <>
              <Polyline positions={route.pts} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
              <Polyline positions={route.pts} pathOptions={{ color: '#6d28d9', weight: 4, opacity: 1 }} />
            </>
          )}

          {/* Los POI van DEBAJO de los corredores: son el decorado contra el
              que se lee la carrera, no lo que se mira. Pequeños y con el nombre
              solo al acercarse; con veinte puntos, veinte etiquetas fijas tapan
              justo lo que se ha venido a ver. */}
          {pois.map((poi) => (
            <CircleMarker
              key={`${poi.lat},${poi.lon}`}
              center={[poi.lat, poi.lon]}
              radius={poi.cutoffAt ? 5 : 4}
              pathOptions={{
                color: '#f8fafc',
                weight: 1.5,
                fillColor: poi.cutoffAt ? '#f59e0b' : '#6d28d9',
                fillOpacity: 1,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} permanent={showPoiNames} className="poi-tip">
                {poi.name}
                {poi.km != null ? ` · km ${poi.km.toFixed(1)}` : ''}
                {poi.cutoffAt ? ` · cierra ${hhmm(poi.cutoffAt)}` : ''}
              </Tooltip>
            </CircleMarker>
          ))}

          {withFix.map(({ r, stale, key }) => {
            const color = r.color ? eventColorHex(r.color) : '#94a3b8'
            const isSel = key === selected
            return (
              <div key={key}>
                {/* La cola: por dónde viene, con sombra debajo. La paleta tiene
                    colores claros —lima, ámbar— que sobre un mapa de fondo claro
                    casi desaparecen; la sombra los levanta sin tocarles el tono,
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
                  icon={runnerIcon(color, r.emoji, isSel, stale, showEmoji)}
                  eventHandlers={{ click: () => setSelected(isSel ? null : key) }}
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

          {followed?.r.fix && (
            <FollowRunner
              lat={followed.r.fix.lat}
              lon={followed.r.fix.lon}
              onRelease={() => setFollowing(null)}
            />
          )}
          <FitAll points={withFix.map((x) => [x.r.fix!.lat, x.r.fix!.lon] as [number, number])} route={route?.pts} />
        </MapContainer>
      ) : (
        <ListView rows={rows} totalKm={route?.totalKm ?? null} now={now} isPublic={isPublic}
                  eventId={source.kind === 'member' ? source.id : null}
                  following={following}
                  onFollow={(k) => { setFollowing(k); setSelected(k); setView('mapa') }}
                  onPick={(k) => { setSelected(k); setView('mapa') }} />
      )}

      {/* Cabecera: volver, nombre (en el público, que no tiene parrilla) y vistas */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        {isPublic ? (
          <div className="pointer-events-auto flex max-w-[60%] flex-col items-start gap-1">
            <span className="max-w-full truncate rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-100 backdrop-blur">
              {eventName ?? 'Evento'}
            </span>
            {/* Los enlaces de la organización: quien espera en meta los quiere
                tanto o más que los participantes —el seguimiento por dorsal es
                lo que dan las webs oficiales—, y aquí no tiene parrilla donde
                buscarlos. Se validan al pintar: en la base puede haber enlaces
                anteriores a la comprobación. */}
            <div className="flex flex-wrap gap-1">
              {isHttpUrl(links.trackingUrl) && (
                <a href={links.trackingUrl!} target="_blank" rel="noopener noreferrer"
                   className="rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1 text-[11px] text-sky-400 backdrop-blur hover:border-sky-700">
                  ⏱️ Oficial ↗
                </a>
              )}
              {isHttpUrl(links.websiteUrl) && (
                <a href={links.websiteUrl!} target="_blank" rel="noopener noreferrer"
                   className="rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1 text-[11px] text-sky-400 backdrop-blur hover:border-sky-700">
                  🌐 Web ↗
                </a>
              )}
            </div>
          </div>
        ) : (
          <a
            href={`/?e=${encodeURIComponent(source.id)}`}
            className="pointer-events-auto rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-sky-700"
          >
            ← Parrilla
          </a>
        )}
        {/* A quién sigue el mapa, y cómo soltarlo. Va arriba y no dentro de la
            ficha porque el seguimiento sigue puesto aunque se cierre la ficha:
            un modo activo que no se ve es un modo que desconcierta. */}
        {view === 'mapa' && followed && (
          <button
            onClick={() => setFollowing(null)}
            className="pointer-events-auto absolute inset-x-0 top-14 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-sky-800 bg-slate-900/90 px-3 py-1 text-[11px] text-sky-300 backdrop-blur hover:border-sky-600"
          >
            ◎ Siguiendo a {followed.r.emoji ?? ''} {followed.r.username} · soltar
          </button>
        )}
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 backdrop-blur">
          {(['mapa', 'lista'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
                view === v ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Tira de participantes: leyenda y selector a la vez — con diez puntos de
          colores, una leyenda que no sirve para seleccionar obliga a acertarle
          al punto con el dedo. Solo en el mapa; la lista ya es su propia
          leyenda. */}
      {view === 'mapa' && (
        <div className="absolute inset-x-0 bottom-0 z-[1000] p-3">
          {sel && (
            <RunnerCard
              row={sel} now={now} totalKm={route?.totalKm ?? null}
              eventId={source.kind === 'member' ? source.id : null}
              following={following === sel.key}
              onFollow={() => setFollowing(following === sel.key ? null : sel.key)}
              onClose={() => setSelected(null)}
            />
          )}
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {rows.map(({ r, key, idle }) => {
              const color = r.color ? eventColorHex(r.color) : '#94a3b8'
              const isSel = key === selected
              return (
                <button
                  key={key}
                  onClick={() => setSelected(isSel ? null : key)}
                  disabled={!r.fix}
                  title={idle ? `${r.username} está en la parrilla y todavía no emite` : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition-colors disabled:opacity-60 ${
                    isSel ? 'border-slate-300 bg-slate-800/90 text-slate-100'
                      : idle ? 'border-dashed border-slate-700 bg-slate-900/70 text-slate-500'
                      : 'border-slate-700 bg-slate-900/90 text-slate-300'
                  }`}
                >
                  {r.emoji
                    ? <span className={`text-sm leading-none ${idle ? 'grayscale' : ''}`}>{r.emoji}</span>
                    : <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                  <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: idle ? 0.4 : 1 }} />
                  {r.username}
                  {/* El borde discontinuo ya lo insinúa, pero a un participante
                      que falta en el mapa hay que decírselo con palabras: sin
                      esto se lee como un fallo de la aplicación. */}
                  {idle && <span className="text-[10px] text-slate-500">sin emitir</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {runners !== null && withFix.length === 0 && view === 'mapa' && (
        <div className="pointer-events-none absolute inset-0 z-[900] grid place-items-center p-6">
          <p className="pointer-events-auto max-w-xs rounded-xl border border-slate-700 bg-slate-900/95 p-4 text-center text-sm text-slate-300">
            Todavía no hay nadie emitiendo en este evento. Cuando alguien empiece a compartir su posición, aparecerá aquí.
            {idleCount > 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                {idleCount === 1 ? 'La única persona de la parrilla está abajo' : `Las ${idleCount} personas de la parrilla están abajo`}, en gris.
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

type Row = {
  r: Runner
  km: number | null
  margin: ReturnType<typeof marginToNextCutoff>
  stale: boolean
  /** Está en la parrilla y aún no ha emitido: sale en la lista, no en el mapa. */
  idle: boolean
  key: string
}

/**
 * La lista: la misma información que el mapa, ordenada por kilómetro.
 *
 * En el móvil responde mejor que el mapa a "¿cómo van todos?" —diez puntos
 * repartidos por un valle no se comparan de un vistazo— y de paso es la
 * clasificación oficiosa del grupo.
 */
function ListView({ rows, totalKm, now, isPublic, eventId, following, onFollow, onPick }: {
  rows: Row[]
  totalKm: number | null
  now: number
  isPublic: boolean
  eventId: string | null
  following: string | null
  onFollow: (key: string) => void
  onPick: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  // Por nombre, por dorsal y por emoji: los tres son "como se llama" según
  // quién pregunte. Sin tildes ni mayúsculas, que nadie las teclea con guantes.
  const shown = useMemo(() => {
    const q = fold(query)
    if (!q) return rows
    return rows.filter(({ r }) =>
      fold(r.username).includes(q) || fold(r.bib ?? '').includes(q) || (r.emoji ?? '').includes(query.trim()))
  }, [rows, query])

  return (
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 pt-16 scrollbar-fantasma">
      {/* El buscador es lo que hace usable una carrera de cien: la lista deja
          de recorrerse entera para ir directo al tuyo. Solo cuando hay bastante
          gente como para que buscar sea más rápido que mirar. */}
      {rows.length > 8 && (
        // Pegado arriba: con cien filas, un buscador que se va con el
        // desplazamiento obliga a subir del todo cada vez que se cambia de idea.
        <div className="sticky top-14 z-[500] -mx-3 mb-2 bg-slate-950 px-3 pb-2">
          <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, dorsal o emoji…"
            aria-label="Buscar participante"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-xs text-slate-600">🔍</span>
          </div>
        </div>
      )}
      {rows.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-400">Todavía no hay nadie en la parrilla de este evento.</p>
      )}
      {rows.length > 0 && shown.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-400">Nadie coincide con «{query.trim()}».</p>
      )}
      <ul className="space-y-1.5">
        {shown.map(({ r, km, margin, stale, idle, key }, i) => {
          return (
            <li key={key} className={`rounded-xl border p-2.5 ${
              idle ? 'border-dashed border-slate-800 bg-slate-900/30' : 'border-slate-800 bg-slate-900/60'
            }`}>
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-500">{km !== null ? i + 1 : '·'}</span>
                <MarkBadge emoji={r.emoji} color={r.color} size={22} />
                {/* El dorsal es como se le conoce ese dia: va delante del
                    nombre, que es lo que hace comparable esta lista con la
                    clasificacion oficial. */}
                {r.bib && (
                  <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[10px] font-bold tabular-nums text-slate-200">
                    {r.bib}
                  </span>
                )}
                {idle ? (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-400">{r.username}</span>
                ) : (
                  <button onClick={() => onPick(key)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-100">
                    {r.username}
                  </button>
                )}
                {r.status === 'ended' && <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">terminado</span>}
                {idle && <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">sin emitir</span>}
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-100">
                  {km !== null ? `${km.toFixed(1)}` : '—'}
                  <span className="ml-0.5 text-[10px] font-normal text-slate-500">{totalKm ? `/${totalKm.toFixed(0)} km` : 'km'}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 pl-7 text-[11px]">
                {idle ? (
                  // Ni ritmo ni "hace X": de quien no ha emitido no hay nada que
                  // envejecer, y un "sin señal" ahí sugiere una avería que no hay.
                  <span className="text-slate-500">En la parrilla · aún no comparte su posición</span>
                ) : (
                  <>
                  <span className="text-slate-400">
                    {r.fix?.speed != null ? `${paceOrSpeed(r.fix.speed, r.activity)} ${isFoot(r.activity) ? 'min/km' : 'km/h'}` : 'sin ritmo'}
                  </span>
                  {margin && (
                    <span className={marginClass(margin.minutes)}>
                      {formatMargin(margin.minutes)} · {margin.cutoff.name}
                    </span>
                  )}
                  <span className={`ml-auto ${stale ? 'text-amber-400' : 'text-slate-500'}`}>
                    {r.updatedAt !== null ? `hace ${agoLabel(now - r.updatedAt)}` : 'sin señal'}
                  </span>
                  {r.fix && (
                    <button
                      onClick={() => onFollow(key)}
                      className={`shrink-0 ${following === key ? 'text-sky-300' : 'text-slate-400 hover:text-sky-400'}`}
                    >
                      {following === key ? '◎ siguiendo' : '◎ seguir'}
                    </button>
                  )}
                  {!isPublic && r.sessionId && eventId && (
                    <a
                      href={`/?t=${encodeURIComponent(r.sessionId)}&e=${encodeURIComponent(eventId)}`}
                      className="shrink-0 text-sky-400 hover:text-sky-300"
                    >
                      ver
                    </a>
                  )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** La ficha del corredor elegido: lo justo para saber cómo va. */
function RunnerCard({ row, now, totalKm, eventId, following, onFollow, onClose }: {
  row: Row
  now: number
  totalKm: number | null
  eventId: string | null
  following: boolean
  onFollow: () => void
  onClose: () => void
}) {
  const { r, km, margin, stale } = row
  const ago = r.updatedAt !== null ? agoLabel(now - r.updatedAt) : null
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 p-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <MarkBadge emoji={r.emoji} color={r.color} size={26} />
        {r.bib && (
          <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-200">
            {r.bib}
          </span>
        )}
        <span className="truncate text-sm font-bold text-slate-100">{r.username}</span>
        {r.status === 'ended' && <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">terminado</span>}
        {/* Seguir: el mapa se recoloca solo en cada refresco y deja de hacerlo
            en cuanto se arrastra con la mano. */}
        {r.fix && (
          <button
            onClick={onFollow}
            title={following ? 'Dejar de seguirle' : 'Que el mapa le siga'}
            className={`ml-auto shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors ${
              following ? 'border-sky-700 bg-sky-950/60 text-sky-300' : 'border-slate-700 text-slate-300 hover:text-sky-400'
            }`}
          >
            {following ? '◎ siguiendo' : '◎ seguir'}
          </button>
        )}
        <button onClick={onClose} className={`shrink-0 text-lg leading-none text-slate-500 hover:text-slate-300 ${r.fix ? '' : 'ml-auto'}`}>×</button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Dato valor={km !== null ? km.toFixed(1) : '—'} unidad={totalKm ? `de ${totalKm.toFixed(0)} km` : 'km'} />
        <Dato valor={r.fix?.speed != null ? paceOrSpeed(r.fix.speed, r.activity) : '—'} unidad={isFoot(r.activity) ? 'min/km' : 'km/h'} />
        <Dato valor={ago ?? '—'} unidad="última señal" tono={stale ? 'text-amber-400' : 'text-slate-100'} />
      </div>
      {/* El margen sobre el cierre: en una carrera con cortes, es LA pregunta.
          Proyectado con el ritmo que lleva, no con el planificado (ver
          lib/eventCutoffs). */}
      {margin && (
        <div className={`mt-2 rounded-lg border px-2 py-1.5 text-center text-xs ${marginBox(margin.minutes)}`}>
          <span className="font-bold">{formatMargin(margin.minutes)}</span>
          <span className="opacity-80"> sobre el corte de {margin.cutoff.name} (km {margin.cutoff.km.toFixed(1)})</span>
        </div>
      )}
      {eventId && r.sessionId && (
        <a
          href={`/?t=${encodeURIComponent(r.sessionId)}&e=${encodeURIComponent(eventId)}`}
          className="mt-2 block rounded-lg border border-slate-700 py-1.5 text-center text-xs text-sky-400 hover:bg-sky-950/40"
        >
          Ver su baliza completa →
        </a>
      )}
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

function marginClass(min: number): string {
  const t = marginTone(min)
  return t === 'late' ? 'text-red-400' : t === 'tight' ? 'text-amber-400' : 'text-emerald-400'
}

function marginBox(min: number): string {
  const t = marginTone(min)
  return t === 'late'
    ? 'border-red-900/70 bg-red-950/40 text-red-300'
    : t === 'tight'
      ? 'border-amber-900/70 bg-amber-950/40 text-amber-300'
      : 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300'
}

/** Encuadra a todos la PRIMERA vez que hay posiciones; después no toca el mapa
 *  —moverlo bajo el dedo de quien está mirando es lo más molesto que puede
 *  hacer un mapa en vivo. */
/**
 * El encuadre de entrada: LA CARRERA ENTERA.
 *
 * Manda el recorrido y no dónde esté la gente. Al abrir el mapa la pregunta es
 * "¿cómo va esto?", y para responderla hace falta ver de dónde a dónde va la
 * carrera y por qué parte del recorrido andan; encuadrar solo las posiciones
 * daba un zoom cerradísimo cuando todos van juntos —al principio, siempre— y
 * dejaba el recorrido fuera de la pantalla. Además el recorrido llega un
 * instante después que las posiciones, así que sin esto el mapa se abría
 * encuadrado a los corredores y ya no volvía a moverse.
 *
 * Una sola vez, y a lo que haya: si aún no hay recorrido, a las posiciones
 * como antes. Después de ese primer encuadre el mapa es del usuario —o de
 * FollowRunner— y esto no vuelve a tocarlo.
 */
function FitAll({ points, route }: { points: [number, number][]; route?: [number, number][] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    if (route && route.length > 1) {
      done.current = true
      map.fitBounds(L.latLngBounds(route), { padding: [28, 28] })
      return
    }
    if (points.length === 0) return
    done.current = true
    if (points.length === 1) { map.setView(points[0], 14); return }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48] })
  }, [points, route, map])
  return null
}

/**
 * Icono del corredor: su emoji dentro de un aro de su color, o el punto de
 * siempre cuando el emoji no cabe.
 *
 * El emoji va sobre fondo oscuro y el color en el aro: un emoji tiene sus
 * propios colores y sobre un disco de color se ensucian los dos. El aro
 * identifica de lejos —quién va con quién— y el emoji de cerca, que es quién es
 * exactamente cada uno cuando hay cien puntos.
 *
 * Se cachean por variante para no reiniciar la animación en cada refresco.
 */
const iconCache = new Map<string, L.DivIcon>()
function runnerIcon(color: string, emoji: string | null, selected: boolean, stale: boolean, withEmoji: boolean): L.DivIcon {
  const showEmoji = withEmoji && !!emoji
  const key = `${color}|${emoji ?? ''}|${selected}|${stale}|${showEmoji}`
  const hit = iconCache.get(key)
  if (hit) return hit
  const size = showEmoji ? (selected ? 34 : 26) : (selected ? 22 : 16)
  const html = showEmoji
    ? `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#0f172a;
        border:3px solid ${color};opacity:${stale ? 0.45 : 1};display:grid;place-items:center;
        font-size:${Math.round(size * 0.55)}px;line-height:1;
        box-shadow:0 0 0 1px rgba(2,6,23,0.6)${selected ? ',0 0 0 3px #f8fafc' : ''}">${emoji}</div>`
    : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
        border:2px solid ${selected ? '#f8fafc' : 'rgba(2,6,23,0.85)'};opacity:${stale ? 0.45 : 1};
        box-shadow:0 0 0 1px rgba(2,6,23,0.6)"></div>`
  const icon = L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  iconCache.set(key, icon)
  return icon
}

/**
 * A partir de qué zoom se dibujan los emojis.
 *
 * Cien emojis a nivel de provincia son una sopa ilegible que además ocupa el
 * triple de pantalla que los puntos: por debajo de esto manda el punto de color,
 * que a esa distancia es la única información que se puede leer de todas formas.
 * Con pocos corredores no hay amontonamiento posible y salen siempre.
 */
const EMOJI_ZOOM = 12
const EMOJI_ALWAYS_UNDER = 12
/** A partir de aquí los puntos del recorrido enseñan su nombre. */
const POI_NAMES_ZOOM = 13

/**
 * Mantiene el mapa centrado en quien se sigue, y suelta el seguimiento en
 * cuanto el usuario arrastra.
 *
 * Lo segundo importa tanto como lo primero: un mapa que se recoloca solo cada
 * diez segundos mientras intentas mirar otra cosa es un mapa peleándose
 * contigo. `dragstart` solo lo dispara la mano, nunca el `panTo` de aquí.
 */
function FollowRunner({ lat, lon, onRelease }: { lat: number; lon: number; onRelease: () => void }) {
  const map = useMap()
  useEffect(() => { map.panTo([lat, lon], { animate: true }) }, [lat, lon, map])
  useEffect(() => {
    const soltar = () => onRelease()
    map.on('dragstart', soltar)
    return () => { map.off('dragstart', soltar) }
  }, [map, onRelease])
  return null
}

/** Avisa del zoom al componente de arriba: Leaflet lo tiene, React no. */
function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const emit = () => onZoom(map.getZoom())
    emit()
    map.on('zoomend', emit)
    return () => { map.off('zoomend', emit) }
  }, [map, onZoom])
  return null
}

/** La hora de un instante, para las etiquetas de cierre. */
function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** Minúsculas y sin tildes, para comparar lo que se busca con lo que hay. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
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
