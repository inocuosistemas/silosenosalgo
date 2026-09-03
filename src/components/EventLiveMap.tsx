import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../lib/AuthContext'
import { eventColorHex } from '../../shared/eventColors'
import type { EventPublicRunner, EventStats } from '../../shared/wireTypes'
import {
  getEventLive, getEventPublic, getEventPlan, eventsErrorMessage, EventsError, EVENT_PHOTO_ASPECT,
} from '../lib/eventsTransport'
import type { SharePayloadV1 } from '../lib/sharePayload'
import {
  eventCutoffs, marginToNextCutoff, formatMargin, marginTone, type EventCutoff,
} from '../lib/eventCutoffs'
import { isHttpUrl } from '../../shared/validate'
import { MarkBadge } from './MarkPicker'
import { EventBets, type BetRunner } from './EventBets'
import { EventReplay } from './EventReplay'
import { AuthMenu } from './AuthMenu'
import type { RunnerOutcome } from '../lib/bets'

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
/**
 * Y pasado ESTO ya no es un hueco, es un agujero de cobertura.
 *
 * En montaña lo normal es quedarse sin red un rato largo —un valle, un bosque,
 * una cara norte— y el punto se queda clavado donde entró. A los seis minutos
 * basta con apagarlo; a los veinte hay que DECIRLO, porque quien mira lleva un
 * rato viendo a alguien parado en el mismo sitio y la conclusión natural
 * —"le ha pasado algo"— es casi siempre la equivocada.
 */
const LOST_MS = 20 * 60_000

/**
 * A partir de aquí ya no es el temblor del GPS: es que va por otro sitio.
 *
 * Treinta metros los da cualquier móvil en un bolsillo bajo los árboles; cien
 * ya no, y menos de forma sostenida. Pasado ese punto no se ancla a nadie al
 * trazado —seria dibujar una carrera que no está corriendo— y se avisa.
 */
const DESVIADO_M = 100

/** El icono de cada actividad, que dice de un vistazo de qué va la carrera. */
const ICONO_ACTIVIDAD: Record<string, string> = { walk: '🚶', run: '🏃', bike: '🚴' }

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
  /** La salida OFICIAL del evento (epoch ms): de ella sale la cuenta atrás. */
  const [startsAt, setStartsAt] = useState<number | null>(null)
  /** El cartel de la carrera, tal cual lo manda el servidor (con su versión). */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  /**
   * El id del evento y si tiene porra. En la pantalla de participantes ya se
   * saben; desde el enlace público llegan en el feed, porque quien mira desde
   * fuera es justo quien juega.
   */
  const [eventId, setEventId] = useState<string | null>(source.kind === 'member' ? source.id : null)
  const [betsEnabled, setBetsEnabled] = useState(false)
  /** De qué va la carrera: caminata, carrera o bici. */
  const [actividad, setActividad] = useState<string | null>(null)
  /** Cuándo terminó la carrera y qué quedó de ella. */
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [stats, setStats] = useState<EventStats | null>(null)
  const [plan, setPlan] = useState<SharePayloadV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'mapa' | 'lista' | 'porra' | 'meta' | 'replay'>('mapa')
  const [now, setNow] = useState(Date.now())
  /**
   * Si el cuadro de la salida está desplegado. Empieza abierto —antes de la
   * carrera es lo que se viene a ver— pero en un móvil ocupa media pantalla y
   * tapa el trazado, así que se pliega a una chapa con el reloj y se recupera
   * de un toque.
   */
  const [panelOpen, setPanelOpen] = useState(true)
  /**
   * Lo que mide la cabecera flotante, medido y no supuesto.
   *
   * Fuera del mapa es una barra sólida y el contenido va debajo, así que hay
   * que apartarlo justo lo que ocupa. Un padding fijo se queda corto en cuanto
   * la barra envuelve —un nombre largo, un móvil estrecho— y entonces la barra
   * se come el título de lo que hay debajo, que es lo que pasaba.
   */
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerH, setHeaderH] = useState(84)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const medir = () => setHeaderH(el.getBoundingClientRect().height)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Si el perfil de abajo está desplegado. Como el cuadro: abierto por defecto. */
  const [profileOpen, setProfileOpen] = useState(true)
  /**
   * Los corredores, ANCLADOS al trazado por defecto.
   *
   * El GPS de un móvil en el bolsillo se pasea veinte o treinta metros: en el
   * mapa eso son corredores por los tejados, dentro del río o por la calle de
   * al lado, y quien mira acaba dudando de la posición en vez de leerla. Pegado
   * al recorrido se lee lo que de verdad importa —por dónde va y cuánto le
   * queda— y el error del GPS deja de contarse como información.
   *
   * Se puede quitar, porque hay un caso en que la posición cruda es la buena:
   * cuando alguien se sale de verdad. Por eso, además, a quien se aleja mucho
   * NO se le ancla aunque el modo esté puesto, y se le marca.
   */
  const [anclados, setAnclados] = useState(true)
  /**
   * El menú de opciones del mapa.
   *
   * El imán se queda puesto casi siempre —quitarlo es lo excepcional— así que
   * un botón permanente en pantalla cobraba sitio todos los días para una
   * decisión que se toma una vez al año. Aquí dentro no estorba y sigue estando
   * donde se busca: junto al resto de lo que se ve o se deja de ver.
   */
  const [opcionesAbiertas, setOpcionesAbiertas] = useState(false)
  /**
   * Si el cartel de "carrera terminada" está desplegado. Empieza abierto: al
   * abrir el mapa de una carrera que ya acabó, lo primero que se quiere saber es
   * justo eso y cómo quedó. Se pliega igual que el de la salida.
   */
  const [finPanelOpen, setFinPanelOpen] = useState(true)
  /**
   * Las dos gráficas, enlazadas por el ratón.
   *
   * `hoverKm` es el punto del recorrido que se está señalando en el perfil: el
   * mapa lo marca a la vez, que es la unica forma de saber a qué sitio del
   * valle corresponde esa pared. `hoverKey` es el corredor señalado en una de
   * las dos, resaltado en la otra.
   */
  const [hoverKm, setHoverKm] = useState<number | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
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
        setStartsAt(live.startsAt)
        setPhotoUrl(live.photoUrl)
        setEventId(live.id)
        setBetsEnabled(live.betsEnabled)
        setEndedAt(live.endedAt)
        setStats(live.stats)
        setActividad(live.activity)
        await loadPlan(live.planShareId)
      } else {
        const live = await getEventLive(source.id)
        setRunners(live.runners as Runner[])
        setStartsAt(live.startsAt)
        setBetsEnabled(live.betsEnabled)
        setEventName(live.name)
        setPhotoUrl(live.photoUrl)
        setLinks({ trackingUrl: live.trackingUrl, websiteUrl: live.websiteUrl })
        setEndedAt(live.endedAt)
        setStats(live.stats)
        setActividad(live.activity)
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

  /**
   * El último kilómetro conocido de cada corredor, para que la proyección no
   * pueda saltar hacia atrás medio recorrido. Vive fuera del render porque es
   * memoria del seguimiento, no algo que se pinte.
   */
  const kmPrevio = useRef<Map<string, number>>(new Map())

  /** Cada corredor con lo derivado: km sobre el recorrido y margen al corte. */
  const rows = useMemo(() => {
    return (runners ?? []).map((r) => {
      // El km que manda la baliza manda sobre el proyectado: lo calcula quien
      // va corriendo y sabe por dónde viene. Pero hasta ahora ninguna app lo
      // mandaba, así que aquí se calcula igual de bien: se ARRASTRA el último
      // kilómetro conocido de cada uno y se proyecta en una ventana a su
      // alrededor, sembrando con su cola la primera vez. Así el cálculo no
      // puede saltar al otro extremo del trazado en un circuito, que es lo que
      // dejaba sin detectar la meta.
      const key = r.userId ?? r.username
      const medida = { m: 0 }
      let km: number | null = r.fix?.trackKm ?? null
      if (r.fix && route) {
        let cerca = kmPrevio.current.get(key) ?? null
        if (cerca == null && km == null) {
          for (const p of r.tail) cerca = projectKm(p.lat, p.lon, route, cerca)
        }
        const proyectado = projectKm(r.fix.lat, r.fix.lon, route, km ?? cerca, 3, medida)
        km = km ?? proyectado
      }
      if (km != null) kmPrevio.current.set(key, km)
      // Lejos del trazado no se le ancla: se le deja donde dice su GPS y se
      // avisa. Anclar a alguien que va por otro valle es dibujar una carrera
      // que no está corriendo.
      const desviadoM = r.fix && route ? medida.m : 0
      const margin = km !== null && cutoffs.length > 0 && r.status === 'active' && r.startedAt !== null
        ? marginToNextCutoff(cutoffs, km, r.startedAt, r.updatedAt ?? now)
        : null
      const stale = r.status === 'ended' || (r.updatedAt !== null && now - r.updatedAt > STALE_MS)
      // Callado desde hace MUCHO y todavía en marcha: el punto que se ve es su
      // última posición conocida, no donde está.
      const lost = r.status === 'active' && r.updatedAt !== null && now - r.updatedAt > LOST_MS
      // PREPARADO: la baliza está armada y en silencio. La app deja la sesión
      // ABIERTA con la hora de salida por delante y no manda una sola posición
      // hasta que llega —así no se gasta batería ni se enseña dónde aparcó
      // nadie— pero eso, sin decirlo, se ve igual que un GPS que no funciona.
      //
      // Que la sesión siga abierta es parte de la definición y no un detalle:
      // quien armó la baliza para probar y luego dejó de compartir tiene una
      // sesión CERRADA, sin posiciones y con la salida todavía por delante, y
      // se quedaba anunciado como "preparado" para siempre sin estarlo.
      const armed = r.status === 'active' && r.fix === null
        && r.startedAt !== null && r.startedAt > now
      // Y sin una sola posición no ha emitido: da igual que no haya abierto
      // baliza, que la tenga abierta sin mandar nada o que la cerrara sin
      // llegar a mandar. Para quien mira las tres son lo mismo, y no es "sin
      // señal" —que suena a avería— sino que aún no ha empezado.
      const idle = !armed && r.fix === null
      return { r, km, margin, stale, lost, idle, armed, desviadoM, key }
    }).sort((a, b) => (b.km ?? -1) - (a.km ?? -1))
  }, [runners, route, cutoffs, now])


  /**
   * La salida con la que se cuenta: la OFICIAL del evento y, si no la hay, la
   * del recorrido publicado. Son casi siempre la misma —al poner la base se
   * copia—, pero manda la del evento: es la que el organizador puede corregir
   * sin volver a publicar el recorrido.
   */
  const startMs = useMemo(() => {
    if (startsAt) return startsAt
    const t = plan ? Date.parse(plan.startTimeISO) : NaN
    return Number.isNaN(t) ? null : t
  }, [startsAt, plan])

  /**
   * El perfil del recorrido, calculado UNA vez: la silueta en coordenadas de
   * SVG más una función para saber a qué altura va quien pasa por un km.
   *
   * Se muestrea a ~400 puntos: la silueta de una carrera de 40 km no gana nada
   * con los 5.000 puntos del GPX y sí cuesta pintarlos en cada refresco.
   */
  const profile = useMemo(() => (plan ? buildProfile(plan.track) : null), [plan])

  /**
   * La carrera en tres números: cuánto mide, cuánto sube y cuánto tiempo hay.
   *
   * El tiempo disponible es el último cierre menos la salida — el corte de
   * meta, que es el que de verdad define la prueba. Sin cierres no se inventa
   * nada: se enseñan los dos primeros y ya.
   */
  const raceStats = useMemo(() => {
    if (!plan) return null
    const lastCutoff = cutoffs.length > 0 ? cutoffs[cutoffs.length - 1] : null
    const limitMs = lastCutoff && startMs && lastCutoff.at > startMs ? lastCutoff.at - startMs : null
    return {
      km: plan.track.totalDistanceKm,
      gain: plan.track.elevGainM,
      limitMin: limitMs !== null ? Math.round(limitMs / 60_000) : null,
    }
  }, [plan, cutoffs, startMs])

  const withFix = useMemo(() => rows.filter((x) => x.r.fix), [rows])
  /** Dónde cae en el mapa el kilómetro que se está señalando en el perfil. */
  const hoverCoords = useMemo(
    () => (route && hoverKm !== null ? coordsAtKm(route, hoverKm) : null),
    [route, hoverKm],
  )

  /**
   * Cómo va acabando la carrera de cada uno, que es lo que puntúa la porra.
   *
   * Meta = su último punto pasó del 97% del recorrido: el GPS no clava el
   * último metro y un umbral exacto dejaría "sin acabar" a quien cruzó el arco.
   * La hora que vale es la de ese último aviso; y quien cierra la baliza sin
   * llegar queda decidido igual, como no-acabado.
   */
  const outcomes = useMemo<RunnerOutcome[]>(() => {
    const total = route?.totalKm ?? null
    return rows.map(({ r, km }) => {
      const finished = total !== null && km !== null && km >= total * 0.97
      return {
        username: r.username,
        tracked: r.fix !== null,
        finished,
        finishedAt: finished ? r.updatedAt : null,
        // Cerrar una baliza que NUNCA mandó nada no decide nada: quien la armó
        // para probar y la apagó puede estar corriendo igual con el móvil en el
        // bolsillo. Sin una sola posición su carrera queda sin resolver, que es
        // la verdad, en vez de contarse como abandono.
        settled: finished || (r.status === 'ended' && r.fix !== null),
      }
    })
  }, [rows, route])

  /** La parrilla tal como la necesita la porra: sin posiciones, solo identidad. */
  const betRunners = useMemo<BetRunner[]>(
    () => rows.map(({ r }) => ({ username: r.username, bib: r.bib, emoji: r.emoji, color: r.color })),
    [rows],
  )

  /** La pantalla de espera: nadie ha mandado posición todavía. */
  const waiting = runners !== null && withFix.length === 0
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
          <MapTap onTap={() => setHoverKm(null)} />

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

          {withFix.map(({ r, stale, key, km, desviadoM }) => {
            // Dónde se le pinta: pegado a su kilómetro del recorrido si el modo
            // está puesto y no se ha ido lejos; si no, donde dice su GPS.
            const suelto = !anclados || desviadoM > DESVIADO_M || km === null || !route
            const punto: [number, number] = (!suelto && coordsAtKm(route!, km!)) || [r.fix!.lat, r.fix!.lon]
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
                  position={punto}
                  icon={runnerIcon(color, r.emoji, isSel, stale, showEmoji)}
                  eventHandlers={{
                    click: () => setSelected(isSel ? null : key),
                    // Señalar aquí lo enciende en el perfil, y al revés: son la
                    // misma carrera contada de dos maneras.
                    mouseover: () => setHoverKey(key),
                    mouseout: () => setHoverKey((k) => (k === key ? null : k)),
                  }}
                />
                {(isSel || key === hoverKey) && (
                  <CircleMarker
                    center={punto}
                    radius={18}
                    pathOptions={{ color, weight: 2, fill: false, opacity: isSel ? 0.8 : 0.5, dashArray: isSel ? undefined : '3 3' }}
                  />
                )}
              </div>
            )
          })}

          {/* El km que señala el ratón en el perfil, marcado aquí: sin esto,
              "esa pared del km 22" no se sabe dónde cae. */}
          {hoverCoords && (
            <CircleMarker
              center={hoverCoords}
              radius={7}
              pathOptions={{ color: '#f8fafc', weight: 2, fillColor: '#a78bfa', fillOpacity: 0.95 }}
            >
              <Tooltip direction="top" offset={[0, -6]} permanent className="poi-tip">
                {`km ${hoverKm!.toFixed(1)}`}
                {profile ? ` · ${Math.round(profile.eleAtKm(hoverKm!))} m` : ''}
              </Tooltip>
            </CircleMarker>
          )}

          {followed?.r.fix && (
            <FollowRunner
              lat={followed.r.fix.lat}
              lon={followed.r.fix.lon}
              onRelease={() => setFollowing(null)}
            />
          )}
          <FitAll points={withFix.map((x) => [x.r.fix!.lat, x.r.fix!.lon] as [number, number])} route={route?.pts} />
        </MapContainer>
      ) : view === 'replay' ? (
        <EventReplay source={source} route={route?.pts ?? null} topPad={headerH} onBack={() => setView('mapa')} />
      ) : view === 'meta' && stats ? (
        <ResultsView stats={stats} endedAt={endedAt} topPad={headerH} onBack={() => setView('mapa')} />
      ) : view === 'porra' && eventId ? (
        <EventBets
          topPad={headerH}
          eventId={eventId}
          runners={betRunners}
          outcomes={outcomes}
          startsAt={startsAt}
          limitMin={raceStats?.limitMin ?? null}
          onBack={() => setView('mapa')}
        />
      ) : (
        <ListView topPad={headerH} rows={rows} totalKm={route?.totalKm ?? null} now={now} isPublic={isPublic}
                  eventId={source.kind === 'member' ? source.id : null}
                  following={following}
                  onFollow={(k) => { setFollowing(k); setSelected(k); setView('mapa') }}
                  onPick={(k) => { setSelected(k); setView('mapa') }} />
      )}

      {/* Cabecera: volver, nombre (en el público, que no tiene parrilla) y vistas */}
      {/* Ancho acotado en todo lo que es TEXTO, aquí y abajo: el mapa gana con
          la pantalla entera, pero una fila de un participante estirada a 1400
          px deja el nombre a un lado y el dato al otro, con medio metro de
          nada en medio. El mapa y la silueta siguen a lo ancho. */}
      <div
        ref={headerRef}
        // Por encima del resto de lo que flota sobre el mapa: el menú de usuario
        // cuelga de aquí, y con el mismo z-index que el cartel de "carrera
        // terminada" ganaba el cartel por ser posterior en el DOM — el menú se
        // abría por debajo.
        className={`pointer-events-none absolute inset-x-0 top-0 z-[1200] ${
          // Sobre el mapa flota; sobre la lista y la porra es una barra de
          // verdad, con fondo: si no, el contenido se cuela por debajo y la
          // tarjeta del nombre acaba encima de un botón.
          view === 'mapa' ? '' : 'border-b border-slate-800 bg-slate-950/95 backdrop-blur'
        }`}
      >
      <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-2 p-3">
        {/* Con el cuadro de la salida abierto, la pastilla de la carrera SOBRA:
            dice lo mismo que él —el cartel ya lleva el nombre— y encima le
            estorba, que en un móvil el botón de la web acaba pegado a su
            esquina. Desaparece mientras está abierto y vuelve al plegarlo, con
            los tres números y los enlaces oficiales dentro del cuadro para no
            perder nada por el camino. */}
        {/* La salida de esta pantalla va SIEMPRE visible para quien corre: la
            tarjeta de la carrera se esconde con el cuadro de la salida abierto
            —dice lo mismo que él— pero el "volver" no es presentación, es
            navegación, y esconderlo deja encerrado a quien solo quería mirar el
            mapa un momento. */}
        {/* Cada cosa es un elemento de la MISMA fila que envuelve, sin columnas
            anidadas. Con el volver metido en una columna `flex-1`, en un móvil
            estrecho esa columna se encogía a cero —puede, porque lleva
            `min-w-0`— y el chip, que no se encoge, se desbordaba fuera de ella:
            acababa dibujado DEBAJO del botón de usuario. Un contenedor que
            puede quedarse sin ancho no es sitio para algo que no puede
            encogerse. */}
        {!isPublic && (
          <a
            href={`/?e=${encodeURIComponent((source as { kind: 'member'; id: string }).id)}`}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-sky-700"
          >
            ←
          </a>
        )}
        {view !== 'mapa' || (waiting && panelOpen) || (endedAt !== null && finPanelOpen) ? (
          // Fuera del mapa el nombre de la carrera sobra —la lista, la porra y
          // los resultados llevan su propio título— y con cuatro pestañas ya no
          // cabía: el nombre se comía al selector y al usuario. Y con el cuadro
          // de la salida abierto tampoco, que ese ya lo dice.
          <div />
        ) : (
          /* Fuera del mapa, la presentación sobra: ahí lo que hace falta es
             saber qué carrera es y poder volver. Los tres números y los enlaces
             de la organización se quedan en el mapa, que es donde hay sitio —en
             un móvil estrecho, con ellos la barra crecía a tres filas y tapaba
             el título de lo que venía debajo. */
          <div className="pointer-events-auto flex min-w-0 max-w-[min(19rem,62vw)] flex-col items-start gap-1">
            {/* La carrera en la esquina: el nombre y los tres números que la
                describen. Quien abre este enlace puede no saber ni qué prueba
                es —le ha llegado por un grupo—, así que un nombre suelto no
                basta. El cartel va en el cuadro del centro: aquí arriba tiene
                que caber también sobre la lista, y una foto ahí le come las
                primeras filas. */}
            <div className="w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90 backdrop-blur">
              <p className={`truncate px-2.5 text-sm font-bold text-slate-100 ${
                view === 'mapa' ? 'pt-1.5' : 'py-1.5'
              }`}>{eventName ?? 'Evento'}</p>
              {/* Que la carrera TERMINÓ, aquí dentro: es un dato de la carrera
                  como los kilómetros, y flotando aparte se le cruzaba a todo lo
                  demás. Lleva a los resultados, que es lo que se busca al
                  leerlo. */}
              {endedAt !== null && view === 'mapa' && (
                <button
                  onClick={() => setFinPanelOpen(true)}
                  className="flex w-full items-center gap-1.5 border-t border-slate-800 px-2.5 py-1 text-left text-[11px] text-amber-200 hover:bg-amber-950/20"
                >
                  🏁 Carrera terminada
                  <span className="text-amber-300/70">· cómo quedó →</span>
                </button>
              )}
              {raceStats && view === 'mapa' && (
                <p className="flex flex-wrap items-center gap-x-2 px-2.5 pb-1.5 pt-0.5 text-[11px] tabular-nums text-slate-300">
                  {actividad && <span>{ICONO_ACTIVIDAD[actividad] ?? ''}</span>}
                  <span>{raceStats.km.toFixed(1)} km</span>
                  <span className="text-slate-600">·</span>
                  <span>↑{Math.round(raceStats.gain).toLocaleString('es-ES')} m</span>
                  {raceStats.limitMin !== null && (
                    <>
                      <span className="text-slate-600">·</span>
                      {/* No es "duración": es lo que da la organización antes de
                          cerrar meta, y por eso lleva la palabra delante. */}
                      <span className="text-slate-400">límite {durLabel(raceStats.limitMin)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            {/* Los enlaces de la organización: quien espera en meta los quiere
                tanto o más que los participantes —el seguimiento por dorsal es
                lo que dan las webs oficiales—, y aquí no tiene parrilla donde
                buscarlos. Se validan al pintar: en la base puede haber enlaces
                anteriores a la comprobación. */}
            <div className={`flex flex-wrap gap-1 ${view === 'mapa' ? '' : 'hidden'}`}>
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
        {/* A la derecha, las vistas y QUIÉN MIRA. Lo segundo importa desde que
            hay porra: se pronostica con una cuenta, y sin saber cuál está
            abierta —o si hay alguna— no se entiende por qué no se puede. */}
        <div className="pointer-events-auto flex shrink-0 flex-wrap items-start justify-end gap-1.5">
        <AuthMenu />
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 backdrop-blur">
          {([
            'mapa', 'lista',
            ...(betsEnabled ? ['porra' as const] : []),
            // Una carrera terminada estrena pestañas: los resultados y el
            // replay son lo que se viene a ver cuando ya no hay nada
            // moviéndose por el mapa.
            ...(endedAt !== null && stats ? ['meta' as const] : []),
            ...(endedAt !== null ? ['replay' as const] : []),
          ] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
                view === v ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'porra' ? '🔮 porra' : v === 'meta' ? '🏆 meta' : v === 'replay' ? '⏱️ replay' : v}
            </button>
          ))}
        </div>
        </div>
      </div>
      </div>

      {/* Opciones del mapa. Rueda pequeña, esquina derecha, sin fondo que tape
          terreno: es un ajuste, no una acción de todos los días. */}
      {view === 'mapa' && (
        <div
          className="absolute right-3 z-[1050]"
          style={{ bottom: (profile && profileOpen ? 132 : 44) + (withFix.length > 0 ? 44 : 0) }}
        >
          {opcionesAbiertas && (
            <>
              <div className="fixed inset-0 z-[1040]" onClick={() => setOpcionesAbiertas(false)} />
              <div className="absolute bottom-12 right-0 z-[1050] w-56 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 py-1 shadow-xl backdrop-blur">
                <button
                  onClick={() => { setAnclados((v) => !v); setOpcionesAbiertas(false) }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                >
                  <span>{anclados ? '🧲' : '📍'}</span>
                  <span>
                    {anclados ? 'Pegados al recorrido' : 'Posición del GPS'}
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {anclados
                        ? 'El punto se pega al trazado; el temblor del GPS no cuenta.'
                        : 'Se pinta la posición cruda, tal cual llega.'}
                    </span>
                  </span>
                </button>
                {profile && (
                  <button
                    onClick={() => { setProfileOpen((v) => !v); setOpcionesAbiertas(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <span>📈</span>
                    <span>{profileOpen ? 'Ocultar el perfil' : 'Ver el perfil'}</span>
                  </button>
                )}
              </div>
            </>
          )}
          <button
            onClick={() => setOpcionesAbiertas((v) => !v)}
            aria-label="Opciones del mapa"
            title="Opciones del mapa"
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-700 bg-slate-900/90 text-base backdrop-blur active:scale-95"
          >
            ⚙️
          </button>
        </div>
      )}

      {/* Tira de participantes: leyenda y selector a la vez — con diez puntos de
          colores, una leyenda que no sirve para seleccionar obliga a acertarle
          al punto con el dedo. Solo en el mapa; la lista ya es su propia
          leyenda. */}
      {view === 'mapa' && (
        <div className="absolute inset-x-0 bottom-0 z-[1000] flex flex-col">
          <div className="mx-auto w-full max-w-5xl p-3 pb-1">
          {sel && (
            <RunnerCard
              row={sel} now={now} totalKm={route?.totalKm ?? null}
              eventId={source.kind === 'member' ? source.id : null}
              following={following === sel.key}
              onFollow={() => setFollowing(following === sel.key ? null : sel.key)}
              onClose={() => setSelected(null)}
            />
          )}
          {/* Mientras el mapa está vacío la parrilla ya sale en el cuadro del
              centro; repetirla aquí abajo es decir dos veces lo mismo. */}
          <div className={`mt-2 flex gap-1.5 overflow-x-auto pb-1 ${withFix.length === 0 ? 'hidden' : ''}`}>
            {rows.map(({ r, key, idle, armed, lost, desviadoM }) => {
              const color = r.color ? eventColorHex(r.color) : '#94a3b8'
              const isSel = key === selected
              return (
                <button
                  key={key}
                  onClick={() => setSelected(isSel ? null : key)}
                  disabled={!r.fix}
                  title={
                    armed ? `${r.username} tiene la baliza preparada; empieza a las ${hhmm(r.startedAt!)}`
                      : idle ? `${r.username} está en la parrilla y todavía no emite`
                      : undefined
                  }
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition-colors disabled:opacity-60 ${
                    isSel ? 'border-slate-300 bg-slate-800/90 text-slate-100'
                      : armed ? 'border-amber-800/70 bg-slate-900/90 text-amber-200/80'
                      : idle ? 'border-dashed border-slate-600 bg-slate-900/90 text-slate-400'
                      : 'border-slate-700 bg-slate-900/90 text-slate-300'
                  }`}
                >
                  {r.emoji
                    ? <span className={`text-sm leading-none ${idle ? 'grayscale' : ''}`}>{r.emoji}</span>
                    : <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                  <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: idle ? 0.4 : 1 }} />
                  {/* El dorsal, aquí también: en el mapa de una carrera con
                      dorsales es como se busca a alguien, y quien mira desde
                      fuera lo cruza con la clasificación oficial. */}
                  {r.bib && (
                    <span className="rounded border border-slate-700 bg-slate-800 px-1 text-[10px] font-bold tabular-nums text-slate-300">
                      {r.bib}
                    </span>
                  )}
                  {r.username}
                  {/* El borde discontinuo ya lo insinúa, pero a un participante
                      que falta en el mapa hay que decírselo con palabras: sin
                      esto se lee como un fallo de la aplicación. */}
                  {armed && <span className="text-[10px] text-amber-400/80">preparado</span>}
                  {lost && <span className="text-[10px] text-amber-400/80" title="Sin cobertura: su punto es la última posición conocida">📡</span>}
                  {desviadoM > DESVIADO_M && (
                    <span className="text-[10px] text-amber-400/80" title={`Fuera del recorrido: a unos ${Math.round(desviadoM)} m`}>↯</span>
                  )}
                  {idle && <span className="text-[10px] text-slate-500">sin emitir</span>}
                </button>
              )
            })}
          </div>
          {/* Plegado, el reloj sigue a la vista y encima del perfil: es lo que
              no se quiere perder mientras se mira por dónde pasa la carrera. */}
          {waiting && !panelOpen && (
            <div className="flex justify-center pb-1">
              <button
                onClick={() => setPanelOpen(true)}
                className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-200 shadow-lg shadow-slate-950/50 backdrop-blur hover:border-sky-700"
              >
                {startMs !== null && (
                  <span className="font-mono tabular-nums text-slate-100">{countdownText(startMs - now)}</span>
                )}
                <span className="text-slate-400">{rows.length} en parrilla</span>
                <span className="text-slate-500">▲</span>
              </button>
            </div>
          )}
          </div>
          {/* El perfil, pegado abajo y a lo ancho: es la otra gráfica de la
              carrera, y los mismos puntos de colores salen en las dos. */}
          {profile && (
            <EventProfile
              profile={profile}
              rows={rows}
              pois={pois}
              selected={selected}
              onSelect={(k) => setSelected(k === selected ? null : k)}
              open={profileOpen}
              onToggle={() => setProfileOpen((v) => !v)}
              hoverKm={hoverKm}
              onHoverKm={setHoverKm}
              hoverKey={hoverKey}
              onHoverKey={setHoverKey}
            />
          )}
        </div>
      )}

      {/* La carrera TERMINÓ. Igual de grande que el cuadro de la salida y por el
          mismo motivo: es el otro momento en que el mapa deja de ser lo que se
          viene a mirar. Con lo que de verdad se pregunta —quién ganó, en qué
          tiempo, cuántos acabaron— y las dos puertas a lo que queda: los
          resultados y el replay. */}
      {endedAt !== null && view === 'mapa' && finPanelOpen && (
        <div className={`pointer-events-none absolute inset-0 z-[900] grid place-items-center p-4 ${
          profile && profileOpen ? 'pb-36' : 'pb-12'
        }`}>
          <div
            className="pointer-events-auto relative w-[min(20rem,86vw)] overflow-y-auto scrollbar-fantasma rounded-xl border border-amber-800/60 bg-slate-900 text-center shadow-xl shadow-slate-950/60"
            style={{ maxHeight: profile && profileOpen ? 'calc(100dvh - 13rem)' : 'calc(100dvh - 6rem)' }}
          >
            <button
              onClick={() => setFinPanelOpen(false)}
              aria-label="Ocultar el resumen de la carrera"
              className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-slate-700 bg-slate-950/80 text-xs text-slate-300 backdrop-blur hover:text-white"
            >
              ✕
            </button>
            {photoUrl && (
              <img src={photoUrl} alt="" style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }} className="w-full object-cover" />
            )}
            <div className="p-4">
              <p className="text-[11px] uppercase tracking-wider text-amber-400/80">Carrera terminada</p>
              <p className="mt-0.5 text-2xl font-bold text-slate-100">🏁 {eventName ?? 'Evento'}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {new Date(endedAt).toLocaleString('es-ES', {
                  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}
              </p>

              {stats && (
                <>
                  <p className="mt-2.5 text-sm text-slate-200">
                    <b>{stats.finishers}</b> de {stats.runners} llegaron a meta
                  </p>
                  {/* El podio: los tres primeros con su tiempo. Es lo que se
                      cuenta al llegar a casa; el resto está en Resultados. */}
                  {stats.corredores.filter((c) => c.finished).length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2.5 text-left">
                      {stats.corredores.filter((c) => c.finished).slice(0, 3).map((c, i) => (
                        <li key={c.username} className="flex items-center gap-1.5 text-[11px]">
                          <span className="w-4 text-center">{['🥇', '🥈', '🥉'][i]}</span>
                          <MarkBadge emoji={c.emoji} color={c.color} size={18} />
                          <span className="min-w-0 flex-1 truncate text-slate-100">{c.username}</span>
                          <span className="shrink-0 font-bold tabular-nums text-emerald-300">
                            {c.minutos != null ? durLabel(c.minutos) : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {stats.fastestKm && (
                    <p className="mt-2 text-[11px] text-amber-200/90">
                      ⚡ Kilómetro más rápido: <b>{ritmoLabel(stats.fastestKm.minutos)}</b>{' '}
                      — {stats.fastestKm.username}
                    </p>
                  )}
                </>
              )}

              <div className="mt-3 flex gap-1.5">
                {stats && (
                  <button
                    onClick={() => setView('meta')}
                    className="flex-1 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100 hover:border-amber-600"
                  >
                    🏆 Resultados
                  </button>
                )}
                <button
                  onClick={() => setView('replay')}
                  className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-sky-700"
                >
                  ⏱️ Ver el replay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapa sin nadie: antes de la salida esto no es un vacío, es una espera.
          Lo que se pregunta quien abre el enlace a esa hora es CUÁNTO FALTA, y
          un reloj que corre lo dice mejor que cualquier frase. El aviso de que
          los puntos llegarán cuando cada uno comparta su posición sigue ahí,
          pero pequeño y debajo: explica, no es la noticia. */}
      {waiting && panelOpen && view === 'mapa' && (
        <div className={`pointer-events-none absolute inset-0 z-[900] grid place-items-center p-4 ${
          profile && profileOpen ? 'pb-36' : 'pb-12'
        }`}>
          {/* Alto acotado y con scroll dentro: en un movil bajo, el cartel más
              el reloj más una parrilla larga se salían de la pantalla —y ahora
              el perfil se lleva su trozo de abajo. */}
          <div
            className="pointer-events-auto relative w-[min(20rem,86vw)] overflow-y-auto scrollbar-fantasma rounded-xl border border-slate-700 bg-slate-900 text-center shadow-xl shadow-slate-950/60"
            style={{ maxHeight: profile && profileOpen ? 'calc(100dvh - 13rem)' : 'calc(100dvh - 6rem)' }}
          >
            {/* Plegar: en el móvil este cuadro tapa el trazado, que es lo otro
                que se viene a ver. Sale abierto porque antes de la salida el
                reloj manda, y se recupera de un toque en la chapa de abajo. */}
            <button
              onClick={() => setPanelOpen(false)}
              aria-label="Ocultar la salida y la parrilla"
              className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-slate-700 bg-slate-950/80 text-xs text-slate-300 backdrop-blur hover:text-white"
            >
              ✕
            </button>
            {/* El cartel, arriba del todo y a lo ancho: aquí sí hay sitio para
                que se vea la carrera, no un recorte de miniatura. */}
            {photoUrl && (
              <img
                src={photoUrl}
                alt=""
                style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }}
                className="w-full object-cover"
              />
            )}
            <div className="p-4">
            {/* El nombre, solo si no hay cartel: cuando lo hay, ya lo lleva
                dibujado y repetirlo debajo es decirlo dos veces. */}
            {!photoUrl && (
              <p className="mb-1 text-sm font-bold text-slate-100">{eventName ?? 'Evento'}</p>
            )}
            {raceStats && (
              <p className="mb-2.5 flex flex-wrap items-center justify-center gap-x-2 text-[11px] tabular-nums text-slate-400">
                <span>{raceStats.km.toFixed(1)} km</span>
                <span className="text-slate-600">·</span>
                <span>↑{Math.round(raceStats.gain).toLocaleString('es-ES')} m</span>
                {raceStats.limitMin !== null && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span>límite {durLabel(raceStats.limitMin)}</span>
                  </>
                )}
              </p>
            )}
            {startMs !== null ? (
              <StartCountdown startMs={startMs} now={now} />
            ) : (
              <p className="text-sm text-slate-300">Todavía no hay nadie emitiendo en este evento.</p>
            )}
            {/* La parrilla, aquí dentro y no solo en la tira de abajo: mientras
                el mapa está vacío, QUIÉN corre es la otra mitad de lo que se
                viene a mirar, y una lista al lado del reloj se lee de un
                vistazo —quién falta por empezar— sin ir a buscarla. */}
            {rows.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-2.5 text-left">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Parrilla · {rows.length} {rows.length === 1 ? 'participante' : 'participantes'}
                </p>
                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto scrollbar-fantasma pr-0.5">
                  {rows.map(({ r, key, idle, armed, lost }) => (
                    <li key={key} className="flex items-center gap-1.5 text-[11px]">
                      <MarkBadge emoji={r.emoji} color={r.color} size={18} />
                      {r.bib && (
                        <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1 text-[10px] font-bold tabular-nums text-slate-300">
                          {r.bib}
                        </span>
                      )}
                      <span className={`min-w-0 flex-1 truncate ${idle ? 'text-slate-400' : 'text-slate-100'}`}>
                        {r.username}
                      </span>
                      <span className={`shrink-0 ${
                        armed ? 'text-amber-400/90' : idle ? 'text-slate-500'
                          : r.status === 'ended' ? 'text-slate-400'
                          : lost ? 'text-amber-400/90' : 'text-emerald-400'
                      }`}>
                        {armed ? `preparado · ${hhmm(r.startedAt!)}`
                          : idle ? 'sin emitir'
                          : r.status === 'ended' ? 'terminado'
                          : lost ? 'sin cobertura' : 'emitiendo'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* La porra, ofrecida donde se espera: es AQUÍ donde hay tiempo
                muerto que llenar, y una vez que empieza la carrera ya no se
                admiten pronósticos. */}
            {betsEnabled && eventId && (
              <button
                onClick={() => setView('porra')}
                className="mt-3 w-full rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100 transition-colors hover:border-amber-600"
              >
                🔮 Echa tu porra
              </button>
            )}
            <p className="mt-3 border-t border-slate-800 pt-2.5 text-[11px] leading-snug text-slate-500">
              Los participantes aparecerán en el mapa cuando empiecen a compartir su posición.
            </p>
            {/* Los enlaces de la organización, aquí dentro mientras el cuadro
                tapa su sitio de siempre: a quien espera en meta le sirven tanto
                como el reloj. */}
            {(isHttpUrl(links.trackingUrl) || isHttpUrl(links.websiteUrl)) && (
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {isHttpUrl(links.trackingUrl) && (
                  <a href={links.trackingUrl!} target="_blank" rel="noopener noreferrer"
                     className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-sky-400 hover:border-sky-700">
                    ⏱️ Oficial ↗
                  </a>
                )}
                {isHttpUrl(links.websiteUrl) && (
                  <a href={links.websiteUrl!} target="_blank" rel="noopener noreferrer"
                     className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-sky-400 hover:border-sky-700">
                    🌐 Web ↗
                  </a>
                )}
              </div>
            )}
            </div>
          </div>
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
  /** Baliza armada y en silencio: sale a una hora que todavía no ha llegado. */
  armed: boolean
  /** Lleva más de veinte minutos sin mandar nada: el punto es su última conocida. */
  lost: boolean
  /** A cuántos metros del trazado está su última posición. */
  desviadoM: number
  key: string
}

/**
 * La lista: la misma información que el mapa, ordenada por kilómetro.
 *
 * En el móvil responde mejor que el mapa a "¿cómo van todos?" —diez puntos
 * repartidos por un valle no se comparan de un vistazo— y de paso es la
 * clasificación oficiosa del grupo.
 */
function ListView({ rows, totalKm, now, isPublic, eventId, following, onFollow, onPick, topPad }: {
  rows: Row[]
  /** Lo que mide la barra de arriba: el contenido empieza justo debajo. */
  topPad: number
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
    <div className="h-full overflow-y-auto bg-slate-950 pb-6 scrollbar-fantasma" style={{ paddingTop: topPad + 12 }}>
      <div className="mx-auto w-full max-w-2xl px-3">
      {/* El buscador es lo que hace usable una carrera de cien: la lista deja
          de recorrerse entera para ir directo al tuyo. Solo cuando hay bastante
          gente como para que buscar sea más rápido que mirar. */}
      {rows.length > 8 && (
        // Pegado arriba: con cien filas, un buscador que se va con el
        // desplazamiento obliga a subir del todo cada vez que se cambia de idea.
        <div className="sticky z-[500] -mx-3 mb-2 bg-slate-950 px-3 pb-2" style={{ top: topPad }}>
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
        {shown.map(({ r, km, margin, stale, idle, armed, lost, desviadoM, key }, i) => {
          return (
            <li key={key} className={`rounded-xl border p-2.5 ${
              armed ? 'border-amber-900/50 bg-amber-950/10'
                : idle ? 'border-dashed border-slate-800 bg-slate-900/30'
                : 'border-slate-800 bg-slate-900/60'
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
                {/* "Terminado" es haber acabado de emitir algo. Una baliza
                    cerrada sin una sola posición no terminó nada: no ha
                    empezado, y ponerle las dos etiquetas se contradice. */}
                {!idle && r.status === 'ended' && <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">terminado</span>}
                {armed && <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">preparado</span>}
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
                ) : armed ? (
                  // Preparado no es una avería: es una baliza armada, callada a
                  // propósito, que arranca sola a su hora.
                  <span className="text-amber-400/90">
                    🌙 Baliza preparada · empieza a las {hhmm(r.startedAt!)}
                  </span>
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
                    {r.updatedAt === null ? 'sin señal'
                      : lost ? `📡 sin cobertura · hace ${agoLabel(now - r.updatedAt)}`
                      : desviadoM > DESVIADO_M ? `↯ fuera del recorrido · ${Math.round(desviadoM)} m`
                      : `hace ${agoLabel(now - r.updatedAt)}`}
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
    </div>
  )
}

/**
 * Los resultados de una carrera terminada.
 *
 * Lo que queda cuando ya no hay nada moviéndose por el mapa. Sale de los datos
 * CONGELADOS al cerrar el evento, no de las sesiones: a las 48 h las trazas se
 * purgan y esto tiene que seguir contando quién ganó el sábado.
 */
function ResultsView({ stats, endedAt, topPad, onBack }: {
  stats: EventStats
  endedAt: number | null
  topPad: number
  onBack: () => void
}) {
  return (
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 scrollbar-fantasma" style={{ paddingTop: topPad + 12 }}>
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-slate-100">🏆 Resultados</h1>
          <p className="mt-1 text-xs text-slate-400">
            {stats.finishers} de {stats.runners} llegaron a meta
            {endedAt !== null && ` · carrera cerrada el ${new Date(endedAt).toLocaleString('es-ES', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}`}
          </p>
        </header>

        {/* El kilómetro más rápido de la carrera: el dato que se discute luego. */}
        {stats.fastestKm && (
          <p className="mb-3 rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
            ⚡ Kilómetro más rápido: <b>{fmtRitmo(stats.fastestKm.minutos)}</b> — {stats.fastestKm.username},
            desde el km {stats.fastestKm.desdeKm.toFixed(1)}
          </p>
        )}

        <ul className="space-y-1.5">
          {stats.corredores.map((c, i) => (
            <li key={c.username} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-500">
                  {c.finished ? i + 1 : '·'}
                </span>
                <MarkBadge emoji={c.emoji} color={c.color} size={20} />
                {c.bib && (
                  <span className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1 text-[10px] font-bold tabular-nums text-slate-300">
                    {c.bib}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{c.username}</span>
                {c.finished
                  ? <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">{fmtDuracion(c.minutos)}</span>
                  : <span className="shrink-0 text-[10px] text-slate-500">{c.tracked ? 'no llegó a meta' : 'no emitió'}</span>}
              </div>
              {c.tracked && (
                <p className="mt-0.5 flex flex-wrap gap-x-2 pl-7 text-[11px] tabular-nums text-slate-500">
                  <span>{c.km?.toFixed(1)} km</span>
                  {c.ritmoMinKm != null && <span>· {fmtRitmo(c.ritmoMinKm)} /km de media</span>}
                  {c.mejorKmMin != null && (
                    <span>· mejor km {fmtRitmo(c.mejorKmMin)}{c.mejorKmDesde != null ? ` (km ${c.mejorKmDesde.toFixed(1)})` : ''}</span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>

        <button
          onClick={onBack}
          className="mt-4 w-full rounded-lg border border-slate-700 py-2 text-center text-xs text-sky-400 transition-colors hover:bg-sky-950/40"
        >
          ← Volver al mapa
        </button>
      </div>
    </div>
  )
}

/** Un ritmo o un tiempo de kilómetro: "4:35". */
function fmtRitmo(min: number): string {
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Un tiempo de carrera: "5h 12m". */
function fmtDuracion(min: number | null): string {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
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
        <Dato
          valor={ago ?? '—'}
          unidad={row.lost ? 'sin cobertura' : 'última señal'}
          tono={stale ? 'text-amber-400' : 'text-slate-100'}
        />
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
/** Un toque en el mapa: sirve para soltar la marca que dejó el dedo en el perfil. */
function MapTap({ onTap }: { onTap: () => void }) {
  useMapEvents({ click: onTap })
  return null
}

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
/**
 * En qué kilómetro del recorrido está una posición.
 *
 * Con `nearKm` se busca SOLO en una ventana alrededor de ese kilómetro, y eso
 * es lo que distingue este cálculo de "el punto más cercano" a secas: en un
 * circuito que acaba donde empieza —o en una ruta que pasa dos veces por el
 * mismo collado— el punto más cercano al cruzar meta es el de la salida, y el
 * corredor aparecía en el km 0 después de cinco horas. Con eso no había forma
 * de saber quién había terminado.
 *
 * Sin `nearKm` (el primer punto que se ve de alguien) se busca en todo el
 * trazado, que es lo único que se puede hacer y además es correcto.
 */
function projectKm(
  lat: number,
  lon: number,
  route: { pts: [number, number][]; cumKm: number[] },
  nearKm?: number | null,
  windowKm = 3,
  fuera?: { m: number },
): number | null {
  let desde = 0
  let hasta = route.pts.length - 1
  if (nearKm != null) {
    desde = route.cumKm.findIndex((k) => k >= nearKm - windowKm)
    if (desde < 0) desde = route.pts.length - 1
    for (hasta = desde; hasta + 1 < route.cumKm.length && route.cumKm[hasta + 1] <= nearKm + windowKm; hasta++) { /* avanza */ }
  }
  let bi = -1, bd = Infinity
  for (let i = desde; i <= hasta; i++) {
    const d = (route.pts[i][0] - lat) ** 2 + ((route.pts[i][1] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bd) { bd = d; bi = i }
  }
  if (bi < 0) return null
  // Cuánto se separa del trazado, en metros aproximados: sirve para avisar de
  // que alguien va por otro sitio en vez de pegarlo al recorrido y mentir.
  if (fuera) fuera.m = Math.sqrt(bd) * 111_320
  return route.cumKm[bi] ?? null
}

/** Lat/lon del punto que está en el km `km` del recorrido, interpolando. */
function coordsAtKm(route: { pts: [number, number][]; cumKm: number[] }, km: number): [number, number] | null {
  const { pts, cumKm } = route
  if (pts.length === 0) return null
  if (km <= cumKm[0]) return pts[0]
  if (km >= cumKm[cumKm.length - 1]) return pts[pts.length - 1]
  let lo = 0, hi = cumKm.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumKm[mid] <= km) lo = mid; else hi = mid
  }
  const span = cumKm[hi] - cumKm[lo]
  const t = span > 0 ? (km - cumKm[lo]) / span : 0
  return [pts[lo][0] + t * (pts[hi][0] - pts[lo][0]), pts[lo][1] + t * (pts[hi][1] - pts[lo][1])]
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

/**
 * La cuenta atrás hasta la salida —o el tiempo en carrera si ya salió—.
 *
 * Al segundo y en monoespaciada de ancho fijo: un reloj cuyos dígitos bailan
 * de anchura se lee como un error, y aquí el número es lo único que hay.
 */
function StartCountdown({ startMs, now }: { startMs: number; now: number }) {
  const diff = startMs - now
  const before = diff > 0
  const { d, h, m, s: sec } = countdownParts(diff)
  // Los cuatro grupos SIEMPRE, aunque falten cero días: un reloj que cambia de
  // formato por el camino obliga a releerlo cada vez. La letra debajo dice cuál
  // es cuál, que "03:09:04:15" a secas se lee como una hora rarísima.
  const grupos: { v: string; u: string }[] = [
    { v: d, u: 'd' },
    { v: h, u: 'h' },
    { v: m, u: 'min' },
    { v: sec, u: 's' },
  ]
  return (
    <>
      <p className="text-[11px] uppercase tracking-wider text-slate-500">
        {before ? 'Salida en' : 'En marcha desde hace'}
      </p>
      <div className="mt-1 flex items-start justify-center gap-1 font-mono">
        {grupos.map((g, i) => (
          <div key={g.u} className="flex items-start gap-1">
            {i > 0 && <span className="text-2xl font-bold leading-none text-slate-600">:</span>}
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold leading-none tabular-nums text-slate-100">{g.v}</span>
              <span className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">{g.u}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        {new Date(startMs).toLocaleString('es-ES', {
          weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}
      </p>
    </>
  )
}

/**
 * El perfil del recorrido: silueta en coordenadas de SVG + altura por km.
 *
 * El SVG se estira con `preserveAspectRatio="none"`, así que se dibuja en una
 * caja fija de 1000×100 y quien lo pinta lo escala a lo ancho que tenga. La
 * altura de cada corredor NO se saca de la silueta muestreada sino del track
 * entero (`eleAtKm`): el punto tiene que caer donde de verdad está, no donde
 * cayó la muestra más cercana.
 */
const PROF_W = 1000
const PROF_H = 100
/** Recorrido casi llano: sin un mínimo de desnivel la silueta sale inventada. */
const PROF_MIN_SPAN_M = 300

interface Profile {
  line: string
  area: string
  minE: number
  maxE: number
  totalKm: number
  /** Y en coordenadas del SVG (0 arriba) para una altura dada. */
  y: (ele: number) => number
  /** Altura interpolada en un km del recorrido. */
  eleAtKm: (km: number) => number
}

function buildProfile(track: { points: { ele: number }[]; cumKm: number[]; totalDistanceKm: number }): Profile | null {
  const { points, cumKm } = track
  if (points.length < 2 || cumKm.length !== points.length) return null
  const totalKm = track.totalDistanceKm || cumKm[cumKm.length - 1] || 1

  const step = Math.max(1, Math.ceil(points.length / 400))
  const sel: number[] = []
  for (let i = 0; i < points.length; i += step) sel.push(i)
  if (sel[sel.length - 1] !== points.length - 1) sel.push(points.length - 1)

  let minE = Infinity, maxE = -Infinity
  for (const i of sel) {
    const e = points[i].ele
    if (e < minE) minE = e
    if (e > maxE) maxE = e
  }
  if (!Number.isFinite(minE) || !Number.isFinite(maxE)) return null
  if (maxE - minE < PROF_MIN_SPAN_M) {
    const mid = (minE + maxE) / 2
    minE = mid - PROF_MIN_SPAN_M / 2
    maxE = mid + PROF_MIN_SPAN_M / 2
  }
  const eleSpan = maxE - minE || 1
  const x = (km: number) => (km / totalKm) * PROF_W
  const y = (ele: number) => PROF_H - 3 - ((ele - minE) / eleSpan) * (PROF_H - 6)

  const coords = sel.map((i) => `${x(cumKm[i]).toFixed(1)},${y(points[i].ele).toFixed(1)}`)
  const line = `M${coords.join('L')}`
  const area = `M${x(cumKm[sel[0]]).toFixed(1)},${PROF_H}L${coords.join('L')}L${x(cumKm[sel[sel.length - 1]]).toFixed(1)},${PROF_H}Z`

  const eleAtKm = (km: number): number => {
    if (km <= cumKm[0]) return points[0].ele
    if (km >= cumKm[cumKm.length - 1]) return points[points.length - 1].ele
    // Binaria: el track puede traer miles de puntos y esto corre por corredor
    // en cada refresco.
    let lo = 0, hi = cumKm.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cumKm[mid] <= km) lo = mid; else hi = mid
    }
    const span = cumKm[hi] - cumKm[lo]
    const t = span > 0 ? (km - cumKm[lo]) / span : 0
    return points[lo].ele + t * (points[hi].ele - points[lo].ele)
  }

  return { line, area, minE, maxE, totalKm, y, eleAtKm }
}

/**
 * El perfil abajo del todo, con cada corredor en su sitio.
 *
 * El mapa dice DÓNDE va cada uno; el perfil dice CONTRA QUÉ va: quien está a
 * mitad de una pared de 400 m no lleva la misma carrera que quien baja hacia
 * meta aunque los dos vayan por el km 22. Antes de la salida sirve solo: es la
 * carrera que se va a correr, de un vistazo.
 */
function EventProfile({ profile, rows, pois, selected, onSelect, open, onToggle, hoverKm, onHoverKm, hoverKey, onHoverKey }: {
  profile: Profile
  rows: Row[]
  pois: { km: number; name: string; cutoffAt: number | null }[]
  selected: string | null
  onSelect: (key: string) => void
  open: boolean
  onToggle: () => void
  hoverKm: number | null
  onHoverKm: (km: number | null) => void
  hoverKey: string | null
  onHoverKey: (key: string | null) => void
}) {
  const { totalKm } = profile
  const señalado = rows.find((x) => x.key === hoverKey && x.km !== null) ?? null
  return (
    <div className="pointer-events-auto border-t border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
        {/* Señalar a alguien lo dice AQUÍ y no en una etiqueta flotando sobre
            su punto: en los extremos esa etiqueta se salía de la tira, y en un
            punto alto se subía por encima del mapa. */}
        {señalado ? (
          <span className="truncate normal-case tracking-normal text-slate-200">
            {señalado.r.emoji ?? ''} {señalado.r.username} · km {señalado.km!.toFixed(1)} ·{' '}
            {Math.round(profile.eleAtKm(señalado.km!))} m
          </span>
        ) : (
          <span>Perfil · {Math.round(profile.minE)}–{Math.round(profile.maxE)} m</span>
        )}
        <button onClick={onToggle} className="rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-200">
          {open ? 'ocultar ▼' : 'ver el perfil ▲'}
        </button>
      </div>
      {open && (
        <div
          // `overflow-hidden` porque TODO lo de dentro se coloca en porcentajes
          // y en los extremos se sale por medio punto o por medio circulito: el
          // kilómetro 37,7 cae en el 100%, y con el traslado de media anchura
          // el punto asomaba un par de píxeles por la derecha. Dos píxeles de
          // nada, pero el navegador saca su barra de desplazamiento horizontal
          // y de repente la página entera se mueve de lado.
          className="relative mx-auto h-24 w-full max-w-6xl cursor-crosshair overflow-hidden"
          // `touch-action: none` es lo que hace que el dedo ARRASTRE en vez de
          // desplazar la página: sin esto el navegador se queda el gesto y en
          // el móvil solo quedaba ir dando toques uno a uno.
          style={{ touchAction: 'none' }}
          onMouseMove={(e) => readHoverKm(e.clientX, e.currentTarget, totalKm, onHoverKm)}
          onMouseLeave={() => onHoverKm(null)}
          onTouchStart={(e) => readHoverKm(e.touches[0].clientX, e.currentTarget, totalKm, onHoverKm)}
          onTouchMove={(e) => readHoverKm(e.touches[0].clientX, e.currentTarget, totalKm, onHoverKm)}
          // Al levantar el dedo la marca SE QUEDA: en un móvil el dedo tapa
          // justo lo que se quiere leer, y borrarla al soltar dejaría sin ver
          // el dato. Se quita tocando el mapa.
        >
          <svg viewBox={`0 0 ${PROF_W} ${PROF_H}`} preserveAspectRatio="none" className="block h-full w-full">
            <defs>
              <linearGradient id="profFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path d={profile.area} fill="url(#profFill)" />
            <path d={profile.line} fill="none" stroke="#a78bfa" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {/* Los puntos del recorrido, como rayas verticales: los cierres en
                ámbar, que son los que mandan. Sin nombre —no cabe— pero el
                mapa los lleva rotulados justo encima. */}
            {pois.map((poi) => (
              <line
                key={`${poi.km}-${poi.name}`}
                x1={(poi.km / totalKm) * PROF_W} x2={(poi.km / totalKm) * PROF_W}
                y1={0} y2={PROF_H}
                stroke={poi.cutoffAt ? '#f59e0b' : '#475569'}
                strokeWidth={1}
                strokeOpacity={poi.cutoffAt ? 0.7 : 0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {/* El rastro del ratón: la vertical con su altura, y el mismo punto
              encendido en el mapa (lo pinta la pantalla, no el perfil). */}
          {hoverKm !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-violet-300/70"
              style={{ left: `${(hoverKm / totalKm) * 100}%` }}
            >
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-200 ring-2 ring-slate-950"
                style={{ top: `${(profile.y(profile.eleAtKm(hoverKm)) / PROF_H) * 100}%`, width: 8, height: 8 }}
              />
              <span className={`absolute top-0.5 whitespace-nowrap rounded bg-slate-950/90 px-1 text-[10px] tabular-nums text-slate-200 ${
                hoverKm > totalKm / 2 ? 'right-1.5' : 'left-1.5'
              }`}>
                km {hoverKm.toFixed(1)} · {Math.round(profile.eleAtKm(hoverKm))} m
              </span>
            </div>
          )}
          {/* Los corredores van como HTML encima y no como <circle>: el SVG se
              estira a lo ancho y un círculo dentro saldría ovalado. */}
          {rows.map(({ r, km, key }) => {
            if (km === null) return null
            const color = r.color ? eventColorHex(r.color) : '#94a3b8'
            const isSel = key === selected
            const isHover = key === hoverKey
            const big = isSel || isHover
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                onMouseEnter={() => onHoverKey(key)}
                onMouseLeave={() => onHoverKey(null)}
                title={`${r.username} · km ${km.toFixed(1)} · ${Math.round(profile.eleAtKm(km))} m`}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 transition-transform"
                style={{
                  left: `${Math.max(0, Math.min(100, (km / totalKm) * 100))}%`,
                  top: `${(profile.y(profile.eleAtKm(km)) / PROF_H) * 100}%`,
                  width: big ? 16 : 12,
                  height: big ? 16 : 12,
                  background: color,
                  boxShadow: big ? `0 0 0 2px ${color}` : undefined,
                  zIndex: big ? 2 : 1,
                }}
              />
            )
          })}
          <span className="pointer-events-none absolute bottom-0.5 left-2 text-[10px] tabular-nums text-slate-500">0</span>
          <span className="pointer-events-none absolute bottom-0.5 right-2 text-[10px] tabular-nums text-slate-500">
            {totalKm.toFixed(1)} km
          </span>
        </div>
      )}
    </div>
  )
}

/** El km del recorrido que cae bajo un punto de la pantalla, dentro del perfil. */
function readHoverKm(clientX: number, el: HTMLElement, totalKm: number, emit: (km: number) => void): void {
  const r = el.getBoundingClientRect()
  if (r.width <= 0) return
  const t = (clientX - r.left) / r.width
  emit(Math.max(0, Math.min(1, t)) * totalKm)
}

/** Un ritmo o un tiempo de kilómetro en minutos decimales: "5:44". */
function ritmoLabel(min: number): string {
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Días, horas, minutos y segundos de un intervalo, ya con sus dos cifras. */
function countdownParts(ms: number): { d: string; h: string; m: string; s: string } {
  const total = Math.floor(Math.abs(ms) / 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return {
    d: p2(Math.floor(total / 86_400)),
    h: p2(Math.floor((total % 86_400) / 3600)),
    m: p2(Math.floor((total % 3600) / 60)),
    s: p2(total % 60),
  }
}

/** El mismo reloj en una línea, para cuando el cuadro está plegado. */
function countdownText(ms: number): string {
  const { d, h, m, s } = countdownParts(ms)
  return `${d}:${h}:${m}:${s}`
}

/** Un tiempo en minutos como se dice un límite de carrera: "7h 30m". */
function durLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
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
