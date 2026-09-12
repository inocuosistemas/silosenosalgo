import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Settings, X } from 'lucide-react'
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
  eventCutoffs, marginToNextCutoff, marginToNextCutoffConPerfil, formatMargin, marginTone, type EventCutoff,
} from '../lib/eventCutoffs'
import { isHttpUrl } from '../../shared/validate'
import { paradoDesde } from '../lib/parado'
import { sanitizeTrail } from '../lib/trailSmoothing'
import { ACTIVITY_MAX_SPEED_KMH, haversineKm } from '../lib/timing'
import { MarkBadge } from './MarkPicker'
import { Dorsal } from './Dorsal'
import { ListaResultados, RecordDeKm, fmtRitmo } from './EventResults'
import { EventBets, type BetRunner } from './EventBets'
import { EventReplay } from './EventReplay'
import { AuthMenu } from './AuthMenu'
import { Confeti } from './Confeti'
import type { RunnerOutcome } from '../../shared/bets'
import { resultadosDeCarrera } from '../lib/eventOutcomes'
import { buildPlannedCurve } from '../lib/ghostPacer'
import { proyeccionFantasma, SILENCIO_MIN_MS, type Fantasma } from '../lib/proyeccionFantasma'

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
/**
 * Cuándo se sospecha que la VENTANA de proyección se ha quedado atrás, y no que
 * el corredor se haya salido del recorrido.
 *
 * El kilómetro de quien no lo manda se proyecta en una ventana alrededor de su
 * último kilómetro conocido, para que en un circuito no salte al otro extremo
 * del trazado. El precio es que la ventana se puede quedar descolgada: basta un
 * rato sin refrescar —la pantalla apagada, la pestaña en segundo plano, la app
 * reabierta— para que el corredor haya avanzado más de lo que la ventana
 * alcanza. Y entonces NO se recupera sola: la ventana se vuelve a centrar en el
 * kilómetro malo y se queda ahí clavada el resto de la carrera, enseñando un
 * "fuera del recorrido" y un margen a los cortes que son falsos.
 *
 * Así que pasado este umbral se rehace la búsqueda en TODO el recorrido y se
 * acepta solo si el corredor está MUCHO más cerca del punto nuevo: eso
 * distingue una ventana descolgada (donde el punto global está a metros) de
 * alguien que de verdad va por otro valle (donde también está lejos).
 */
const REENGANCHE_M = 300
/** A cuántos metros del final se da la meta por cruzada. Ver eventStats. */
const META_M = 50
/** A partir de cuánto tiempo quieto se dice que alguien está parado. Menos que
 *  esto es esperar a que cambie un semáforo, y avisarlo sería ruido. */
const PARADO_MIN_MS = 3 * 60_000
/** Las medallas del podio, por PUESTO (que se comparte en los empates). */
const MEDALLAS = ['🥇', '🥈', '🥉']

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
  /**
   * Cuánto ocupa la cabecera, medido.
   *
   * Los carteles que flotan sobre el mapa —la cuenta atrás de la salida, el
   * resumen de la carrera terminada— se centraban en la pantalla ENTERA. Con
   * pocos participantes cabían; con cuatro y foto, el cartel crecía hacia
   * arriba y se metía debajo de la cabecera, tapando el volver, el perfil y las
   * pestañas. Justo lo que no puede taparse: es por donde se sale.
   *
   * Se mide en vez de estimarse porque la cabecera cambia de alto sola —lleva
   * el nombre de la carrera, sus números, los enlaces de la organización, las
   * pestañas y, si sigues a alguien, una línea más— y cualquier número fijo
   * habría estado mal en la mitad de los casos.
   */
  const cabecera = useRef<HTMLDivElement>(null)
  const [altoCabecera, setAltoCabecera] = useState(0)
  useEffect(() => {
    const el = cabecera.current
    if (!el) return
    const ro = new ResizeObserver(() => setAltoCabecera(el.offsetHeight))
    ro.observe(el)
    setAltoCabecera(el.offsetHeight)
    return () => ro.disconnect()
  })
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

  /**
   * Quién ya cruzó la meta. Una vez llegado, la carrera se acabó para él y su
   * punto se queda EN la meta: lo que haga después —volver andando al coche, ir
   * a por el que viene detrás— no es la prueba. Sin esto se le ve retroceder
   * por el recorrido media hora después de llegar, y en el perfil el punto
   * aparece desplazado como si no hubiera terminado.
   *
   * Vive en una ref y no en el estado porque es MEMORIA del seguimiento: haber
   * llegado no se deshace porque el siguiente refresco le pille en otro sitio.
   */
  const llego = useRef<Set<string>>(new Set())
  /** Y a qué hora llegó, para poder cortarle la cola ahí mismo. */
  const horaMeta = useRef<Map<string, number>>(new Map())

  /**
   * La hora de meta de los resultados CONGELADOS, que es la buena: la calculó
   * el servidor con la traza entera. La detección de aquí solo hace falta en
   * directo, mientras la carrera no ha cerrado y no hay resultados todavía.
   */
  const metaOficial = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of stats?.corredores ?? []) {
      if (c.finishedAt != null) m.set(c.username, c.finishedAt)
    }
    return m
  }, [stats])

  /**
   * El recorrido en el formato que quiere la estimación de tiempos.
   *
   * El plan llega con las horas de cada punto como texto —así viaja por la
   * red— y la función que calcula "a qué hora se pasa por el km X" las quiere
   * como fechas. Se convierte UNA vez por recorrido y no en cada cuenta: son
   * miles de puntos y la cuenta se rehace por corredor y cada pocos segundos.
   */
  const pista = useMemo(() => {
    if (!plan) return null
    return {
      ...plan.track,
      points: plan.track.points.map((p) => ({
        lat: p.lat, lon: p.lon, ele: p.ele, time: p.time ? new Date(p.time) : null,
      })),
    }
  }, [plan])

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

  /** Cada corredor con lo derivado: km sobre el recorrido y margen al corte. */
  /**
   * La curva km ↔ minutos del recorrido, muestreada una vez.
   *
   * Es la que mueve al corredor virtual del visor individual, y aquí sirve para
   * proyectar a quien se queda sin cobertura por el terreno que tiene delante y
   * no en línea recta: en una subida el fantasma avanza poco y en una bajada
   * mucho, como haría él.
   */
  const curvaPlan = useMemo(
    // Con `pista` y no con `plan.track`: es el mismo recorrido con las horas ya
    // convertidas a fechas, que es lo que quiere el modelo de ritmos.
    () => (pista && plan ? buildPlannedCurve(pista, plan.paceConfig) : null),
    [pista, plan],
  )

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
        let proyectado = projectKm(r.fix.lat, r.fix.lon, route, km ?? cerca, 3, medida)
        // La ventana se ha quedado atrás: se reengancha buscando en todo el
        // recorrido. Ver REENGANCHE_M — sin esto, una sola pausa larga de la
        // pantalla deja a un corredor clavado en un kilómetro que ya no es suyo.
        if (km == null && medida.m > REENGANCHE_M) {
          const global = { m: 0 }
          const kmGlobal = projectKm(r.fix.lat, r.fix.lon, route, null, 3, global)
          if (kmGlobal != null && global.m < medida.m / 2) {
            proyectado = kmGlobal
            medida.m = global.m
          }
        }
        km = km ?? proyectado
      }
      if (km != null) kmPrevio.current.set(key, km)
      // Meta: el final del recorrido con un margen en METROS, que el GPS no
      // clava el último metro y el arco nunca cae en el punto exacto del GPX.
      // En metros y no en porcentaje: el 3% de una ultra de 160 km son casi
      // cinco kilómetros, y daría por llegado a quien aún no ha entrado en el
      // último avituallamiento.
      if (route && km != null && km >= route.totalKm - META_M / 1000) {
        llego.current.add(key)
        if (!horaMeta.current.has(key) && r.updatedAt != null) horaMeta.current.set(key, r.updatedAt)
      }
      const metaEn = metaOficial.get(r.username) ?? horaMeta.current.get(key) ?? null
      const acabo = metaEn != null || (route != null && llego.current.has(key))
      if (route && acabo) km = route.totalKm
      // Lejos del trazado no se le ancla: se le deja donde dice su GPS y se
      // avisa. Anclar a alguien que va por otro valle es dibujar una carrera
      // que no está corriendo.
      const desviadoM = r.fix && route ? medida.m : 0
      // El ritmo se mide desde la SALIDA OFICIAL, no desde que abrió la baliza:
      // quien llega pronto y la deja preparada acumula una hora de "carrera"
      // parado en la línea, y con eso el margen al corte sale delirante.
      const referencia = startMs ?? r.startedAt
      // Y contando con el desnivel que queda, que es la misma cuenta que hace
      // la baliza individual: las dos pantallas contestan a la misma pregunta y
      // no pueden dar números distintos. Sin plan con ritmos, la cuenta plana.
      const margin = km !== null && cutoffs.length > 0 && r.status === 'active' && referencia !== null
        ? (pista && plan?.paceConfig
          ? marginToNextCutoffConPerfil(cutoffs, km, referencia, r.updatedAt ?? now, pista, plan.paceConfig)
          : marginToNextCutoff(cutoffs, km, referencia, r.updatedAt ?? now))
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
      /**
       * Cuánto lleva sin moverse, si es que lleva.
       *
       * Es lo que explica el resto de la pantalla: quien lleva diez minutos en
       * el mismo sitio no es que vaya lento, es que está parado —en un
       * avituallamiento, atándose una zapatilla o esperando a alguien—, y sin
       * decirlo su ritmo medio se desploma sin motivo aparente.
       *
       * Solo con señal fresca: quien lleva un rato sin mandar nada no está
       * "parado", está sin cobertura, y eso ya se dice de otra manera.
       */
      const paradoMs = (() => {
        if (!r.fix || lost || stale || r.updatedAt === null) return 0
        const desde = paradoDesde(r.tail)
        return desde === null ? 0 : Math.max(0, r.updatedAt - desde)
      })()
      // La cola, sin los picotazos. Un móvil con mala señal manda saltos de
      // decenas de metros que en el mapa se ven como rayos que salen del
      // corredor y vuelven: no ha estado ahí, y dibujarlo es contar una carrera
      // falsa. Se cortan los que exigirían una velocidad imposible PARA SU
      // ACTIVIDAD —12 km/h es un salto andando y un paseo en bici—, que es lo
      // mismo que ya se hacía en la baliza individual y en los resultados.
      //
      // La actividad de SU sesión y, si no la declaró, la del evento. Una
      // baliza vieja no manda ninguna —la hereda del evento a partir de la 343—
      // y sin este respaldo sus picotazos serían justo los únicos que se
      // seguirían dibujando: los del que no puede actualizar la app. La del
      // evento es la buena de todos modos; la de la sesión solo manda por si
      // alguien va en bici barriendo una carrera a pie.
      const act = r.activity ?? actividad
      const tope = act && act in ACTIVITY_MAX_SPEED_KMH
        ? ACTIVITY_MAX_SPEED_KMH[act as keyof typeof ACTIVITY_MAX_SPEED_KMH]
        : undefined
      // Y la cola se corta en la meta: la sombra de por dónde se fue DESPUÉS de
      // llegar no es la carrera, y en un evento con recorrido marcado no cuenta
      // nada —solo dibuja al que volvió andando cruzando el trazado al revés—.
      const enCarrera = metaEn != null ? r.tail.filter((p) => p.t <= metaEn) : r.tail
      let tail = sanitizeTrail(enCarrera, tope).points
      // El último tramo, el que el GPS no llegó a contar: la meta se da por
      // cruzada al 97%, así que la última lectura buena puede quedarse
      // doscientos metros antes del final. Se cierra POR EL RECORRIDO —esos
      // metros los corrió— y así la cola acaba en la meta y no colgando a
      // mitad de un parque.
      if (acabo && route && tail.length > 0) {
        const ult = tail[tail.length - 1]
        const kmUlt = projectKm(ult.lat, ult.lon, route, route.totalKm - META_M / 1000, 1)
        if (kmUlt != null) {
          const resto = route.pts.filter((_, i) => route.cumKm[i] > kmUlt)
          if (resto.length > 0) {
            tail = tail.concat(resto.map(([lat, lon]) => ({ t: ult.t, lat, lon })))
          }
        }
      }
      /**
       * Por dónde DEBERÍA ir, cuando lleva un rato sin dar señal.
       *
       * Solo un dibujo: no toca ni un número de esta pantalla —ni el kilómetro,
       * ni el margen al corte, ni los resultados, ni la porra—. Lo que decide
       * dónde está sigue siendo su GPS; esto solo evita que un punto clavado
       * durante siete minutos se lea como una aplicación estropeada.
       *
       * Se apaga sola en los casos en que mentiría, y uno de ellos lo enseñó la
       * carrera: si sus últimas lecturas ya decían que no se movía, no se
       * proyecta. Lo dice `paradoMs`, que es la misma cuenta que pinta el "⏸
       * parado" de la lista.
       */
      const velocidadKmH = (() => {
        if (tail.length < 2) return null
        const ult = tail[tail.length - 1]
        const desde = tail.find((q) => ult.t - q.t <= 15 * 60_000) ?? tail[0]
        const horas = (ult.t - desde.t) / 3_600_000
        if (horas <= 0) return null
        let km = 0
        for (let i = tail.indexOf(desde) + 1; i < tail.length; i++) {
          km += haversineKm(tail[i - 1], tail[i])
        }
        return km / horas
      })()
      const fantasma = proyeccionFantasma({
        kmUltimo: km,
        silencioMs: r.updatedAt !== null ? now - r.updatedAt : 0,
        totalKm: route?.totalKm ?? null,
        estabaParado: paradoMs > 0,
        resuelto: acabo || r.status !== 'active',
        curva: curvaPlan,
        transcurridoMs: referencia !== null && r.updatedAt !== null ? r.updatedAt - referencia : null,
        velocidadKmH,
      })
      // Callado más de lo normal. No es todavía "sin cobertura" —eso son veinte
      // minutos— pero ya no es el pulso de la baliza, y decirlo es la mitad de
      // quitarle a quien mira la impresión de que esto no funciona.
      const callado = r.status === 'active' && r.fix !== null && r.updatedAt !== null
        && now - r.updatedAt >= SILENCIO_MIN_MS
      // RETIRADO: apagó la baliza sin cruzar la meta. Es lo que hace alguien
      // que se baja, y es una noticia distinta de un teléfono que se queda sin
      // batería o sin cobertura —ahí la baliza sigue abierta y callada—. Las
      // dos se veían igual, "terminado", y no lo son: una dice que ya está en
      // el coche y la otra que no se sabe nada de él.
      const retirado = !idle && !acabo && r.status === 'ended'
      return { r, km, margin, stale, lost, idle, armed, desviadoM, key, tail, acabo, metaEn, paradoMs, retirado, fantasma, callado }
    }).sort((a, b) => (b.km ?? -1) - (a.km ?? -1))
  }, [runners, route, cutoffs, now, actividad, metaOficial, startMs, plan, pista])

  /**
   * La parrilla de la cuenta atrás, BARAJADA hasta que se sale.
   *
   * Con la carrera parada no hay posiciones, así que cualquier orden que se
   * enseñe es mentira: por kilómetro están todos a cero, y por inscripción el
   * primero de la lista es el que se apuntó antes —que no es un mérito, pero
   * lo parece cuando encabeza la parrilla—. Barajarlos lo dice claro: antes de
   * la salida nadie va primero.
   *
   * Se baraja UNA VEZ POR CARGA, no en cada refresco. Son dos cosas distintas y
   * la diferencia importa: la pantalla se repinta cada pocos segundos, y una
   * lista que se reordenara sola delante de quien la está leyendo sería un
   * mareo, no una idea. Al recargar sale otro orden, que es lo que hace que no
   * haya un primero de la lista permanente.
   *
   * En cuanto alguien emite, mandan los kilómetros: ahí sí hay carrera.
   */
  const semilla = useRef(Math.random())
  const parrilla = useMemo(() => {
    if (rows.some((r) => r.km !== null)) return rows
    const peso = (clave: string) => {
      let h = Math.floor(semilla.current * 2 ** 31)
      for (const c of clave) h = (h * 31 + c.charCodeAt(0)) >>> 0
      return h
    }
    return [...rows].sort((a, b) => peso(a.key) - peso(b.key))
  }, [rows])


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
   * La cuenta ya está hecha más arriba, en las filas: `acabo` sabe quién ha
   * cruzado —con memoria, que haber llegado no se deshace— y `metaEn` a qué
   * hora, prefiriendo la de los resultados congelados. Aquí solo se traduce.
   * Antes se rehacía: otro umbral de meta y, sobre todo, la hora del ÚLTIMO
   * aviso en vez de la de la llegada. Lo que eso rompía está contado en
   * `lib/eventOutcomes.ts`.
   */
  const outcomes = useMemo<RunnerOutcome[]>(
    () => resultadosDeCarrera(rows.map(({ r, acabo, metaEn, retirado }) => ({
      username: r.username,
      emitiendo: r.fix !== null,
      acabo,
      metaEn,
      retirado,
    }))),
    [rows],
  )

  /**
   * Cómo va a acabar esto, si nadie cambia el ritmo.
   *
   * Es la única forma de que la porra se pueda seguir MIENTRAS se corre: sin
   * proyectar, todos los pronósticos están "por decidir" hasta que cruza el
   * último y la pantalla no se mueve en cinco horas. Con ella se puede decir
   * quién va ganando la porra ahora mismo, avisando de que es provisional.
   *
   * La cuenta es la de toda la vida: lo que lleva recorrido en el tiempo que
   * lleva corriendo, estirado hasta el final. No se afina más a propósito —ni
   * desnivel, ni fatiga, ni el ritmo de los últimos kilómetros—: esto es para
   * echar unas risas mirando el móvil, no para cronometrar a nadie, y una
   * cuenta que se entiende sin explicarla vale más aquí que una buena.
   *
   * Solo con medio kilómetro hecho y cinco minutos de carrera: antes de eso,
   * estirar lo poco que se sabe da tiempos absurdos.
   */
  const proyecciones = useMemo(() => {
    const total = route?.totalKm ?? null
    if (startMs === null || total === null || endedAt !== null) return []
    const limiteMs = raceStats?.limitMin != null ? raceStats.limitMin * 60_000 : null
    return rows.flatMap(({ r, km, lost }) => {
      if (km === null || km < 0.5 || r.fix === null) return []
      const transcurrido = (r.updatedAt ?? now) - startMs
      if (transcurrido < 5 * 60_000) return []
      const tardaria = transcurrido * (total / km)
      return [{
        username: r.username,
        /** A qué hora cruzaría meta a este ritmo. */
        acabaEn: startMs + tardaria,
        /** Si le da tiempo dentro del límite. Quien lleva mucho callado no
         *  cuenta como que va a llegar: puede estar parado en una cuneta. */
        llega: !lost && (limiteMs === null || tardaria <= limiteMs),
      }]
    })
  }, [rows, route, startMs, endedAt, raceStats, now])

  /** La parrilla tal como la necesita la porra: sin posiciones, solo identidad. */
  const betRunners = useMemo<BetRunner[]>(
    () => rows.map(({ r }) => ({ username: r.username, bib: r.bib, emoji: r.emoji, color: r.color })),
    [rows],
  )

  /**
   * Alguien acaba de cruzar la meta MIENTRAS mirábamos.
   *
   * Se compara con quién había llegado en el refresco anterior: si aparece uno
   * nuevo, confeti. No al abrir la pantalla con la carrera ya terminada —eso no
   * es una llegada, es un resultado— sino en el momento en que pasa, que es lo
   * que se celebra.
   */
  const llegadosAntes = useRef<Set<string> | null>(null)
  const [festejar, setFestejar] = useState(false)

  /** El corredor señalado, si hay alguno. */
  const sel = useMemo(() => withFix.find((x) => x.key === selected) ?? null, [withFix, selected])

  /**
   * Hasta qué kilómetro está el recorrido YA HECHO.
   *
   * El del corredor señalado, si hay uno; si no, el del que va más lejos. Un
   * trazado entero del mismo color no dice si la carrera va por el principio o
   * por el final, y esa es la primera pregunta de quien abre el mapa: por
   * dónde van. Pintado, se ve de un vistazo y sin leer un número.
   */
  const kmHecho = useMemo(() => {
    if (!route) return null
    if (sel?.km != null) return sel.km
    const kms = rows.map((r) => r.km).filter((k): k is number => k != null)
    return kms.length > 0 ? Math.max(...kms) : null
  }, [rows, route, sel])

  /**
   * El recorrido partido en dos: lo andado y lo que queda.
   *
   * Los dos trozos comparten el punto del corte, que si no queda un hueco
   * blanco justo donde está el corredor —el sitio al que todo el mundo mira—.
   */
  const trazado = useMemo(() => {
    if (!route) return null
    if (kmHecho === null || kmHecho <= 0) return { hecho: [], queda: route.pts }
    let corte = route.cumKm.findIndex((k) => k >= kmHecho)
    if (corte < 0) corte = route.pts.length - 1
    return { hecho: route.pts.slice(0, corte + 1), queda: route.pts.slice(corte) }
  }, [route, kmHecho])

  // Quién ha cruzado ya, para saber cuándo aparece uno nuevo. La primera vuelta
  // solo toma nota: al abrir con la carrera terminada no se celebra nada, que
  // eso no es una llegada sino un resultado.
  useEffect(() => {
    const ahora = new Set(rows.filter((x) => x.acabo).map((x) => x.key))
    const antes = llegadosAntes.current
    llegadosAntes.current = ahora
    if (antes === null) return
    for (const k of ahora) {
      if (!antes.has(k)) { setFestejar(true); window.setTimeout(() => setFestejar(false), 5_000); break }
    }
  }, [rows])

  /** La pantalla de espera: nadie ha mandado posición todavía. */
  const waiting = runners !== null && withFix.length === 0
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

  /** La vista de turno cuando no se está mirando el mapa. */
  const vistaSinMapa = view === 'replay' ? (
    <EventReplay source={source} route={route?.pts ?? null} onBack={() => setView('mapa')} />
  ) : view === 'meta' && stats ? (
    <ResultsView stats={stats} endedAt={endedAt} onBack={() => setView('mapa')} />
  ) : view === 'porra' && eventId ? (
    <EventBets
      eventId={eventId}
      eventName={eventName}
      photoUrl={photoUrl}
      runners={betRunners}
      outcomes={outcomes}
      startsAt={startsAt}
      limitMin={raceStats?.limitMin ?? null}
      // La porra congelada al cerrar, si la hay: manda sobre cualquier cuenta
      // que se pueda rehacer aquí.
      porraCongelada={stats?.porra ?? null}
      proyecciones={proyecciones}
      onBack={() => setView('mapa')}
    />
  ) : (
    // La MISMA parrilla que la del cuadro de la salida: barajada mientras nadie
    // ha empezado y por kilómetro en cuanto hay carrera. Dos listas de la misma
    // pantalla, a un toque una de otra, no pueden estar en orden distinto —y lo
    // estaban: aquí salía el orden de inscripción y allí el barajado.
    <ListView rows={parrilla} totalKm={route?.totalKm ?? null} now={now} isPublic={isPublic}
              eventId={source.kind === 'member' ? source.id : null}
              // La clave se arma igual que en la lista (`r.userId ?? r.username`),
              // así que basta con el id de la sesión iniciada. En el enlace
              // público no hay sesión y esto va nulo, que es lo correcto: ahí
              // nadie es "yo".
              yoKey={user ? (parrilla.find(({ r }) => r.userId === user.id)?.key ?? null) : null}
              following={following}
              onFollow={(k) => { setFollowing(k); setSelected(k); setView('mapa') }}
              onPick={(k) => { setSelected(k); setView('mapa') }} />
  )

  const center: [number, number] = withFix[0]?.r.fix
    ? [withFix[0].r.fix!.lat, withFix[0].r.fix!.lon]
    : route?.pts[0] ?? [42.7, -0.52]

  return (
    <div className={`relative h-[100dvh] w-full bg-slate-950 ${view === 'mapa' ? '' : 'flex flex-col'}`}>
      <Confeti activo={festejar} />
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
          {route && trazado && (
            <>
              <Polyline positions={route.pts} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
              {/* Lo que QUEDA, en el violeta de siempre; lo ya hecho, apagado.
                  El color fuerte se reserva para lo que todavía importa —por
                  dónde hay que ir— y el gris cuenta lo que ya pasó sin competir
                  con él. Se dibuja lo hecho DESPUÉS para que el corte quede
                  limpio justo donde va el corredor.

                  El gris es CLARO y no medio: medido con el validador de
                  paletas sobre el verde del mapa, este se separa del violeta en
                  30,7 donde el gris medio anterior se quedaba en 21,9 — y con
                  tritanopía la diferencia era de 23,7 contra 9,3, o sea que los
                  dos tramos casi se confundían. Que salga "sin color" es a
                  propósito: lo andado ya no es una opción, es historia. */}
              <Polyline positions={trazado.queda} pathOptions={{ color: '#6d28d9', weight: 4, opacity: 1 }} />
              {trazado.hecho.length > 1 && (
                <Polyline positions={trazado.hecho} pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.95 }} />
              )}
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

          {withFix.map(({ r, stale, key, km, desviadoM, tail, acabo, fantasma }) => {
            // Dónde se le pinta: pegado a su kilómetro del recorrido si el modo
            // está puesto y no se ha ido lejos; si no, donde dice su GPS.
            // Quien terminó va EN la meta, se esté imantando o no: su última
            // posición conocida es donde estaba media hora después de llegar, y
            // pintarlo ahí es decir que no acabó. Sin recorrido descargado no
            // hay meta que enseñar, así que se le deja donde dice su GPS.
            const enMeta = acabo && route !== null && km !== null
            const suelto = !enMeta && (!anclados || desviadoM > DESVIADO_M || km === null || !route)
            const punto: [number, number] = (!suelto && coordsAtKm(route!, km!)) || [r.fix!.lat, r.fix!.lon]
            const color = r.color ? eventColorHex(r.color) : '#94a3b8'
            const isSel = key === selected
            return (
              <div key={key}>
                {/* La cola: por dónde viene, con sombra debajo. La paleta tiene
                    colores claros —lima, ámbar— que sobre un mapa de fondo claro
                    casi desaparecen; la sombra los levanta sin tocarles el tono,
                    que es lo que identifica a cada corredor. */}
                {tail.length > 1 && (
                  <>
                    <Polyline
                      positions={tail.map((p) => [p.lat, p.lon] as [number, number])}
                      pathOptions={{ color: '#020617', weight: isSel ? 8 : 6, opacity: stale ? 0.12 : 0.25 }}
                    />
                    <Polyline
                      positions={tail.map((p) => [p.lat, p.lon] as [number, number])}
                      pathOptions={{ color, weight: isSel ? 5 : 3, opacity: stale ? 0.4 : 0.95 }}
                    />
                  </>
                )}
                {/* La proyección: la banda de recorrido donde tiene que
                    estar, y el aro hueco en su extremo optimista. El punto de
                    verdad se queda donde está, sin moverse, porque es lo único
                    que se sabe; entre los dos está él. Discontinuo y a media
                    tinta a propósito: esto no es una posición. */}
                {fantasma && route && (
                  <>
                    {/* Migas de pan, no una línea: puntos redondos sueltos y
                        muy separados. Es el color del corredor —hay que saber
                        de quién es la banda cuando hay treinta— pero su cola va
                        de ese mismo color, y una línea discontinua fina se leía
                        como la continuación de por dónde ha ido. Un rastro de
                        puntos gordos y sueltos no se confunde con nada, y a la
                        vez se ve sobre el verde del mapa, que bajarle la tinta
                        hasta que "no pareciera real" simplemente la borraba. */}
                    <Polyline
                      positions={tramoEntreKm(route, fantasma.desdeKm, fantasma.hastaKm)}
                      pathOptions={{
                        color, weight: isSel ? 10 : 9, opacity: 0.7,
                        dashArray: '0.1 16', lineCap: 'round',
                      }}
                      interactive={false}
                    />
                    {coordsAtKm(route, fantasma.hastaKm) && (
                      <Marker
                        position={coordsAtKm(route, fantasma.hastaKm)!}
                        icon={fantasmaIcon(color)}
                        interactive={false}
                      >
                        {/* La etiqueta, solo del que se está mirando. Fija
                            para todos serían treinta carteles tapando el mapa
                            en una carrera con gente, que es justo cuando esto
                            hace falta. El aro discontinuo ya dice por sí solo
                            que ahí no hay nadie confirmado. */}
                        {(isSel || key === hoverKey) && (
                          <Tooltip direction="bottom" offset={[0, 12]} permanent className="poi-tip">
                            {fantasma.enMeta
                              ? `debería estar llegando · sin señal hace ${agoLabel(fantasma.silencioMs)}`
                              : `debería ir por aquí · sin señal hace ${agoLabel(fantasma.silencioMs)}`}
                          </Tooltip>
                        )}
                      </Marker>
                    )}
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
      ) : (
        // Fuera del mapa la cabecera NO flota: es una barra de verdad y el
        // contenido va DEBAJO, en una columna. Así no hay hueco que reservar ni
        // altura que medir, y no puede volver a solaparse —que es justo lo que
        // pasaba cuando el volver y las pestañas caían en dos filas y la medida
        // se había quedado con la altura de una—.
        <div className="min-h-0 flex-1">{vistaSinMapa}</div>
      )}

      {/* Cabecera: volver, nombre (en el público, que no tiene parrilla) y vistas */}
      {/* Ancho acotado en todo lo que es TEXTO, aquí y abajo: el mapa gana con
          la pantalla entera, pero una fila de un participante estirada a 1400
          px deja el nombre a un lado y el dato al otro, con medio metro de
          nada en medio. El mapa y la silueta siguen a lo ancho. */}
      <div
        ref={cabecera}
        // Por encima del resto de lo que flota sobre el mapa: el menú de usuario
        // cuelga de aquí, y con el mismo z-index que el cartel de "carrera
        // terminada" ganaba el cartel por ser posterior en el DOM — el menú se
        // abría por debajo.
        className={`pointer-events-none z-[1200] ${
          // Sobre el mapa FLOTA, que el mapa se quiere entero. En las demás
          // vistas es una barra de verdad, en la columna y por delante del
          // contenido: `order-first` la sube sin tener que moverla en el
          // código, donde va después a propósito —el menú de usuario cuelga de
          // ella y tiene que quedar por encima de todo—.
          view === 'mapa'
            ? 'absolute inset-x-0 top-0'
            : 'order-first shrink-0 border-b border-slate-800 bg-slate-950/95'
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
        {/* `pointer-events-auto` obligatorio: la barra entera los tiene
            apagados para poder arrastrar el mapa por debajo de ella, así que
            todo lo que sea PULSABLE tiene que volver a encenderlos. Sin esto el
            volver se veía perfectamente y no respondía al dedo. */}
        {/* Volver y QUIÉN MIRA, juntos y a la izquierda.
            En el mismo grupo y no sueltos porque la fila reparte a los lados
            (`justify-between`): sueltos, en una pantalla ancha el perfil se
            quedaba flotando en mitad del mapa, sin nada al lado y sin explicar
            qué hacía ahí.
            Y el perfil detrás del volver, no delante: volver es navegación y se
            usa cien veces más. Quién mira importa desde que hay porra —se
            pronostica con una cuenta, y sin saber cuál está abierta no se
            entiende por qué no se puede— pero es una consulta, no un camino. */}
        <div className="flex shrink-0 items-start gap-2">
          {!isPublic && (
            <a
              href={`/?e=${encodeURIComponent((source as { kind: 'member'; id: string }).id)}`}
              aria-label="Volver a la parrilla"
              className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-base text-slate-200 backdrop-blur hover:border-sky-700 active:bg-slate-800"
            >
              ←
            </a>
          )}
          <AuthMenu />
        </div>
        {/* UN SOLO PANEL: el nombre de la carrera, sus números y las pestañas,
            todo en la misma caja.
            Antes eran dos cajas sueltas, la de la carrera arriba y el selector
            de vistas flotando debajo a su aire, y en un móvil quedaban
            escalonadas y desordenadas —cada una con su borde, empezando en
            sitios distintos—. Metidas en una, el bloque tiene un solo borde, un
            solo margen y una sola alineación, que es lo que hace que se lea
            como una cabecera y no como piezas caídas sobre el mapa.
            El nombre y los números solo en el mapa: la lista, la porra y los
            resultados llevan su propio título, y con el cuadro de la salida
            abierto ese ya lo dice. Las pestañas van SIEMPRE, que son la
            navegación. */}
        <div className="pointer-events-auto min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90 backdrop-blur sm:max-w-[22rem]">
          {view === 'mapa' && !(waiting && panelOpen) && !(endedAt !== null && finPanelOpen) && (
            <>
              <p className="truncate px-2.5 pt-1.5 text-sm font-bold text-slate-100">{eventName ?? 'Evento'}</p>
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
                  {/* Los enlaces de la organización, en esta misma línea y no en
                      una pastilla aparte: quien espera en meta los quiere —el
                      seguimiento por dorsal es lo que dan las webs oficiales—
                      pero dos palabras no valen una fila entera de la cabecera,
                      que en un móvil es pantalla que le quitas al mapa. Se
                      validan al pintar: en la base puede haber enlaces
                      anteriores a la comprobación. */}
                  {isHttpUrl(links.trackingUrl) && (
                    <>
                      <span className="text-slate-600">·</span>
                      <a href={links.trackingUrl!} target="_blank" rel="noopener noreferrer"
                         className="text-sky-400 hover:text-sky-300">Oficial ↗</a>
                    </>
                  )}
                  {isHttpUrl(links.websiteUrl) && (
                    <>
                      <span className="text-slate-600">·</span>
                      <a href={links.websiteUrl!} target="_blank" rel="noopener noreferrer"
                         className="text-sky-400 hover:text-sky-300">Web ↗</a>
                    </>
                  )}
                </p>
              )}
            </>
          )}
          <div className="flex items-stretch gap-1 p-1">
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
                className={`flex flex-1 items-center justify-center rounded-lg px-2 py-1.5 text-xs capitalize transition-colors ${
                  view === v ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {v === 'porra' ? '🔮 porra' : v === 'meta' ? '🏆 meta' : v === 'replay' ? '⏱️ replay' : v}
              </button>
            ))}
          </div>
          {/* A quién sigue el mapa, y cómo soltarlo. DENTRO de la tarjeta y no
              flotando debajo: flotando iba a una altura fija y la cabecera
              creció al meterle las pestañas, así que le caía encima. Y además
              es un modo del mapa —como las pestañas—, no un aviso suelto. */}
          {view === 'mapa' && followed && (
            <button
              onClick={() => setFollowing(null)}
              className="flex w-full items-center justify-center gap-1.5 border-t border-slate-800 px-2.5 py-1.5 text-[11px] text-sky-300 hover:bg-sky-950/30"
            >
              ◎ Siguiendo a {followed.r.emoji ?? ''} {followed.r.username} · soltar
            </button>
          )}
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
            <Settings size={14} />
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
            {rows.map(({ r, key, idle, armed, lost, desviadoM, paradoMs }) => {
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
                  {r.bib && <Dorsal bib={r.bib} />}
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
                  {/* Parado, y desde cuándo. Discreto —un símbolo y los minutos—
                      porque pararse es normal: en un avituallamiento se para
                      todo el mundo. Solo a partir de tres minutos, que menos que
                      eso es esperar a que cambie un semáforo. */}
                  {paradoMs >= PARADO_MIN_MS && (
                    <span
                      className="text-[10px] tabular-nums text-amber-400/80"
                      title={`Sin moverse desde hace ${Math.round(paradoMs / 60_000)} min`}
                    >
                      ⏸{Math.round(paradoMs / 60_000)}
                    </span>
                  )}
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
      {/* El cartel vive DEBAJO de la cabecera, no sobre toda la pantalla: se
          centra en el hueco que queda, y cuando no cabe crece hacia abajo y se
          desplaza por dentro. Antes se centraba en la pantalla entera y al
          crecer se metía bajo la cabecera, tapando el volver y las pestañas.
          El alto máximo es el del hueco (`max-h-full`), así que se ajusta solo:
          ya no hay que adivinar cuánto ocupan cabecera y perfil. */}
      {endedAt !== null && view === 'mapa' && finPanelOpen && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[900] grid place-items-center p-4 ${
            profile && profileOpen ? 'pb-36' : 'pb-12'
          }`}
          style={{ top: altoCabecera }}
        >
          <div
            className="pointer-events-auto relative max-h-full w-[min(20rem,86vw)] overflow-y-auto scrollbar-fantasma rounded-xl border border-amber-800/60 bg-slate-900 text-center shadow-xl shadow-slate-950/60"
          >
            <button
              onClick={() => setFinPanelOpen(false)}
              aria-label="Ocultar el resumen de la carrera"
              className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-slate-700 bg-slate-950/80 text-xs text-slate-300 backdrop-blur hover:text-white"
            >
              <X size={16} />
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
                      cuenta al llegar a casa; el resto está en Resultados.
                      La medalla la decide el PUESTO, no la fila: si tres
                      comparten el primero, las tres son de oro. Repartir plata
                      y bronce por el orden en que salieron de la consulta sería
                      contradecir a los resultados en la pantalla que más se
                      mira. */}
                  {stats.corredores.filter((c) => c.finished).length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2.5 text-left">
                      {stats.corredores.filter((c) => c.finished).slice(0, 3).map((c, i) => (
                        <li key={c.username} className="flex items-center gap-1.5 text-[11px]">
                          <span className="w-4 text-center">{MEDALLAS[(c.puesto ?? i + 1) - 1] ?? '·'}</span>
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
                      ⚡ Kilómetro más rápido: <b>{fmtRitmo(stats.fastestKm.minutos)}</b>{' '}
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
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[900] grid place-items-center p-4 ${
            profile && profileOpen ? 'pb-36' : 'pb-12'
          }`}
          style={{ top: altoCabecera }}
        >
          {/* Debajo de la cabecera y con scroll dentro: con cuatro corredores y
              foto, el cartel crecía hacia arriba y se comía el volver, el
              perfil y las pestañas —por donde se sale de aquí—. Ahora se centra
              en el hueco que queda y, cuando no cabe, crece hacia abajo y se
              desplaza por dentro. `max-h-full` es el alto de ese hueco, así que
              se ajusta solo a lo que ocupen cabecera y perfil. */}
          <div
            className="pointer-events-auto relative max-h-full w-[min(20rem,86vw)] overflow-y-auto scrollbar-fantasma rounded-xl border border-slate-700 bg-slate-900 text-center shadow-xl shadow-slate-950/60"
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
                  {parrilla.map(({ r, key, idle, armed, lost, retirado }) => (
                    <li key={key} className="flex items-center gap-1.5 text-[11px]">
                      <MarkBadge emoji={r.emoji} color={r.color} size={18} />
                      {r.bib && <Dorsal bib={r.bib} />}
                      <span className={`min-w-0 flex-1 truncate ${idle ? 'text-slate-400' : 'text-slate-100'}`}>
                        {r.username}
                      </span>
                      <span className={`shrink-0 ${
                        armed ? 'text-amber-400/90' : idle ? 'text-slate-500'
                          : retirado ? 'text-rose-400/80'
                          : r.status === 'ended' ? 'text-slate-400'
                          : lost ? 'text-amber-400/90' : 'text-emerald-400'
                      }`}>
                        {armed ? `preparado · ${hhmm(r.startedAt!)}`
                          : idle ? 'sin emitir'
                          : retirado ? 'se retiró'
                          : r.status === 'ended' ? 'en meta'
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
                🔮 La Porra
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
  /** Cuánto lleva sin moverse (ms). Cero si se mueve o si no hay señal fresca. */
  paradoMs: number
  /** Cerró la baliza sin llegar a meta: se bajó. No es lo mismo que quedarse sin señal. */
  retirado: boolean
  /** Ha llegado a meta. */
  acabo: boolean
  /** A qué hora cruzó (epoch ms): la congelada si la hay, si no la del primer aviso en meta. */
  metaEn: number | null
  /** Por dónde debería ir mientras no da señal. Un dibujo, nunca un dato. */
  fantasma: Fantasma | null
  /** Lleva más de tres minutos sin mandar nada: ya no es el pulso normal. */
  callado: boolean
  key: string
}

/**
 * La lista: la misma información que el mapa, ordenada por kilómetro.
 *
 * En el móvil responde mejor que el mapa a "¿cómo van todos?" —diez puntos
 * repartidos por un valle no se comparan de un vistazo— y de paso es la
 * clasificación oficiosa del grupo.
 */
function ListView({ rows, totalKm, now, isPublic, eventId, yoKey, following, onFollow, onPick }: {
  rows: Row[]
  /** Lo que mide la barra de arriba: el contenido empieza justo debajo. */
  totalKm: number | null
  now: number
  isPublic: boolean
  eventId: string | null
  /** Mi propia fila, para poder decir a cuánto va cada uno DE MÍ. Nulo sin
   *  sesión iniciada (el enlace público) o si no corro esta carrera. */
  yoKey: string | null
  following: string | null
  onFollow: (key: string) => void
  onPick: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  /**
   * Mi kilómetro, que es lo que convierte una lista de posiciones en una
   * carrera: lo que se quiere saber a las tres de la mañana no es que alguien
   * va por el km 18,2, sino que te lleva 1,7 km. La resta la hacía uno de
   * cabeza mirando dos números; ahora la hace la pantalla.
   *
   * Nulo cuando no estoy emitiendo, cuando no corro esta carrera o cuando el
   * enlace es el público: sin un "yo" no hay nada con lo que comparar, y
   * entonces la lista se queda exactamente como estaba.
   */
  const miKm = useMemo(
    () => (yoKey ? rows.find((x) => x.key === yoKey)?.km ?? null : null),
    [rows, yoKey],
  )
  // Por nombre, por dorsal y por emoji: los tres son "como se llama" según
  // quién pregunte. Sin tildes ni mayúsculas, que nadie las teclea con guantes.
  const shown = useMemo(() => {
    const q = fold(query)
    if (!q) return rows
    return rows.filter(({ r }) =>
      fold(r.username).includes(q) || fold(r.bib ?? '').includes(q) || (r.emoji ?? '').includes(query.trim()))
  }, [rows, query])

  return (
    <div className="h-full overflow-y-auto bg-slate-950 pb-6 pt-3 scrollbar-fantasma">
      <div className="mx-auto w-full max-w-2xl px-3">
      {/* El buscador es lo que hace usable una carrera de cien: la lista deja
          de recorrerse entera para ir directo al tuyo. Solo cuando hay bastante
          gente como para que buscar sea más rápido que mirar. */}
      {rows.length > 8 && (
        // Pegado arriba: con cien filas, un buscador que se va con el
        // desplazamiento obliga a subir del todo cada vez que se cambia de idea.
        <div className="sticky top-0 z-[500] -mx-3 mb-2 bg-slate-950 px-3 pb-2">
          <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, dorsal o emoji…"
            aria-label="Buscar participante"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-slate-600"><Search size={13} /></span>
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
        {shown.map(({ r, km, margin, stale, idle, armed, lost, desviadoM, key, retirado, callado, fantasma }, i) => {
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
                {r.bib && <Dorsal bib={r.bib} />}
                {idle ? (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-400">{r.username}</span>
                ) : (
                  <button onClick={() => onPick(key)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-100">
                    {r.username}
                  </button>
                )}
                {/* Apagar la baliza dice dos cosas muy distintas según dónde
                    se apague, y hasta ahora las dos ponían "terminado": el que
                    cruzó la meta y el que se bajó en el kilómetro 20. Al
                    segundo hay que llamarle por su nombre —se retiró— porque es
                    lo que la carrera necesita saber de él. Y una baliza cerrada
                    sin una sola posición no terminó ni abandonó nada: no
                    empezó. */}
                {retirado && <span className="shrink-0 rounded bg-rose-950/50 px-1.5 py-0.5 text-[10px] text-rose-300">se retiró</span>}
                {!idle && !retirado && r.status === 'ended' && <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-300">en meta</span>}
                {armed && <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">preparado</span>}
                {idle && <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">sin emitir</span>}
                {key === yoKey && (
                  <span className="shrink-0 rounded bg-sky-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">tú</span>
                )}
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-100">
                  {km !== null ? `${km.toFixed(1)}` : '—'}
                  <span className="ml-0.5 text-[10px] font-normal text-slate-500">{totalKm ? `/${totalKm.toFixed(0)} km` : 'km'}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 pl-7 text-[11px]">
                {/* Lo primero de la línea, antes que el ritmo: cuando se busca a
                    alguien en esta lista es para saber esto. Con palabras y no
                    con un signo, que a las tres de la mañana un "−1,7" se lee
                    mal en los dos sentidos. Solo cuando los dos tienen
                    kilómetro: de quien no lo manda no se puede restar nada. */}
                {miKm !== null && km !== null && key !== yoKey && (() => {
                  const d = km - miKm
                  if (Math.abs(d) < 0.05) return <span className="text-slate-300">a tu altura</span>
                  return (
                    <span className={d > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                      {Math.abs(d).toFixed(1)} km {d > 0 ? 'por delante' : 'por detrás'}
                    </span>
                  )
                })()}
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
                  <span className={`ml-auto ${stale || callado ? 'text-amber-400' : 'text-slate-500'}`}>
                    {r.updatedAt === null ? 'sin señal'
                      : lost ? `📡 sin cobertura · hace ${agoLabel(now - r.updatedAt)}`
                      // Entre el pulso normal y la avería hay un rato largo que
                      // antes no se decía: el número envejecía en gris claro y
                      // quien miraba solo veía un punto que no se movía. Decirlo
                      // es la mitad de quitarle la sensación de que esto falla.
                      : callado ? `📡 sin señal · hace ${agoLabel(now - r.updatedAt)}`
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
                  {/* Y se explica, que un aro raro en el mapa sin explicación
                      preocupa más que tranquiliza. Lo importante es la última
                      frase: los puntos que faltan NO se han perdido —la baliza
                      los guarda sin cobertura y los sube en bloque al
                      recuperarla—, así que el hueco se cierra solo con datos de
                      verdad al cabo de un rato. */}
                  {callado && (
                    <span className="w-full text-[10px] leading-snug text-slate-500">
                      {fantasma
                        ? 'El aro hueco del mapa es una proyección por su ritmo y el terreno, no su posición. '
                        : ''}
                      Los puntos que falten se rellenan solos cuando recupere cobertura.
                    </span>
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
function ResultsView({ stats, endedAt, onBack }: {
  stats: EventStats
  endedAt: number | null
  onBack: () => void
}) {
  return (
    <div className="h-full overflow-y-auto bg-slate-950 px-3 pb-6 pt-3 scrollbar-fantasma">
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

        <RecordDeKm stats={stats} />
        <ListaResultados stats={stats} />

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
        {r.bib && <Dorsal bib={r.bib} size="md" />}
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
        {/* Parado, en el sitio del ritmo: un ritmo instantáneo de cero no
            explica nada y "lleva 6 min parado" lo explica todo. Vuelve el ritmo
            en cuanto se mueva. */}
        {row.paradoMs >= PARADO_MIN_MS
          ? <Dato valor={`⏸ ${Math.round(row.paradoMs / 60_000)}`} unidad="min parado" tono="text-amber-300" />
          : <Dato valor={r.fix?.speed != null ? paceOrSpeed(r.fix.speed, r.activity) : '—'} unidad={isFoot(r.activity) ? 'min/km' : 'km/h'} />}
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
 * El icono de la proyección: un aro hueco y discontinuo.
 *
 * Tiene que parecerse al corredor lo justo para saber de quién es —su color— y
 * diferenciarse lo bastante para que nadie lo confunda con una posición: hueco
 * en vez de relleno, borde de trazos en vez de continuo y a media tinta. La
 * diferencia no se fía solo del color, que sobre un mapa lleno de verdes y
 * naranjas el color es lo primero que se pierde: la forma ya lo dice.
 */
const fantasmaCache = new Map<string, L.DivIcon>()
function fantasmaIcon(color: string): L.DivIcon {
  const hit = fantasmaCache.get(color)
  if (hit) return hit
  const size = 22
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;
      border:2px dashed ${color};background:rgba(2,6,23,0.6);
      box-shadow:0 0 0 1px rgba(2,6,23,0.5);
      display:grid;place-items:center;font-size:12px;font-weight:700;line-height:1;
      color:${color}">?</div>`
  const icon = L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  fantasmaCache.set(color, icon)
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

/**
 * El trozo de recorrido entre dos kilómetros, con los extremos exactos.
 *
 * Los vértices del trazado caen donde caen, así que quedarse con los que hay
 * entre medias deja la banda empezando y acabando hasta cien metros más allá de
 * lo que se quería decir. Se interpolan las dos puntas.
 */
function tramoEntreKm(
  route: { pts: [number, number][]; cumKm: number[] },
  desde: number,
  hasta: number,
): [number, number][] {
  const a = coordsAtKm(route, desde)
  const b = coordsAtKm(route, hasta)
  if (!a || !b) return []
  const medio = route.pts.filter((_, i) => route.cumKm[i] > desde && route.cumKm[i] < hasta)
  return [a, ...medio, b]
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
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </div>
  )
}
