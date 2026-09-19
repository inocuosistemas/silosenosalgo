import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TIPOS_PUNTO, TIPO_PUNTO, sugiereTipo, tipoDe, type TipoPunto } from '../lib/avituallamientos'
import { puntosDelEvento, rutaDelEvento, sitioEnKm } from '../lib/puntosEvento'
import { referenciaDe, PRECISO_M, type Referencia } from '../lib/igualaCon'
import type { SharePayloadV1 } from '../lib/sharePayload'
import type { PuntosAjustes } from '../../shared/wireTypes'
import { createPortal } from 'react-dom'
import { X, UserPlus, Shield, Download, Share2, MessageSquare, PenLine, Check, MapPin, Droplet, Utensils, UtensilsCrossed, Backpack, Flag, Timer, type LucideIcon } from 'lucide-react'
import { comparteEnlace, type ComoSeFueEnlace } from '../lib/compartirEnlace'
import { useAuth } from '../lib/AuthContext'
import { foldEmoji } from '../../shared/emoji'
import { EVENT_PRESENCE_MS, EVENT_NOTES_MAX, EVENT_NAME_MAX, type EventDetailResponse, type EventMember, type EventStats } from '../../shared/wireTypes'
import {
  getEvent, setEventColor, leaveEvent, deleteEvent, regenerateEventInvite,
  setEventPhoto, eventPhotoUrl, eventJoinLink, eventsErrorMessage, EventsError,
  EVENT_PHOTO_ASPECT, attachBeacon, setEventPublic, eventPublicLink, setBib, setEventLinks,
  setEventEmoji, setEventColorsLocked, setEventNotes, setEventName, setEventStart, setEventEnd, setEventLimit, setEventTotalKm,
  ultimoCierre,
  setEventBetsEnabled, setEventActivity, endEvent, recomputeEventStats, guardaEvento, joinEvent, getEventPlan, marcaRetirado, marcaManual, anadeSinBaliza, cambiaPunto,
  expulsaDelEvento, setEventOrganizer, getEventBets, setBocadillo, getEventLive, marcaOficial,
} from '../lib/eventsTransport'
import { getProfile, saveProfile } from '../lib/authClient'
import { isHttpUrl, BOCADILLO_MAX } from '../../shared/validate'
import { ANDROID_APK_URL } from '../../shared/config'
import { durationLabel, pendientesDeOficial } from '../../shared/bets'
import { PhotoCropper } from './PhotoCropper'
import { MiniBocadillo, usePensamiento } from './Bocadillo'
import { CargandoMarca } from './CargandoMarca'
import { MarkBadge, EmojiField, ColorPalette } from './MarkPicker'
import { ListaResultados, RecordDeKm } from './EventResults'
import { Plegable } from './Plegable'
import { simplificaTrazado, trazadoBastaFino } from '../lib/eventPlan'
import { BaseChangeNotice } from './BaseChangeNotice'
import { EventCabecera } from './EventCabecera'
import { enlaceDeVista, type VistaEvento } from '../lib/vistaEvento'
import { listPlans } from '../lib/plansTransport'
import { Dorsal, DorsalGrande, carreraDeBase, type DorsalCarrera } from './Dorsal'
import { reviveSharePayload } from '../lib/sharePayload'
import { downloadGpx } from '../lib/gpxSerialize'

/**
 * LA PARRILLA de un evento (`?e=<id>`): la foto y el nombre de la carrera, quién
 * está dentro y con qué marca se pinta cada uno en el mapa.
 *
 * Es la pantalla de ANTES de salir —de ahí el nombre—: aquí se elige la marca,
 * se ve quién ha llegado y el organizador reparte el código. Durante la carrera
 * lo que se mira es el mapa del evento, y la parrilla queda como el sitio al
 * que se vuelve para ver quién está emitiendo.
 *
 * Se refresca solo cada 15 s: la presencia y "quién está emitiendo" cambian
 * mientras la gente llega, y nadie va a estar recargando la página con el
 * dorsal puesto. No es el mapa, así que no hace falta el pulso de 10 s del
 * visor.
 */

const REFRESH_MS = 15_000
/** A partir de cuánto silencio una sesión abierta deja de ser "emitiendo".
 *  Veinte minutos: más que cualquier cadencia normal, incluidas las paradas. */
const SIN_SENAL_MS = 20 * 60_000

/** "8 min", "2 h 15". */
function haceTexto(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

export default function EventLobby({ id, seccion = 'parrilla', nav = null, onIr }: {
  id: string
  /** Qué parte de la casa del evento se pinta: la parrilla o tu plan. */
  seccion?: 'parrilla' | 'plan'
  /** La barra de secciones del evento, arriba y fija. */
  nav?: ReactNode
  /** Cambiar de sección sin recargar; sin él, se navega a su dirección. */
  onIr?: (vista: VistaEvento) => void
}) {
  const { user, status } = useAuth()
  const [data, setData] = useState<EventDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** A quién se está a punto de sacar de la parrilla (su userId). */
  const [expulsando, setExpulsando] = useState<string | null>(null)
  /** De quién se está precisando dónde lo dejó (su nombre), o ninguno. */
  const [ajustando, setAjustando] = useState<string | null>(null)
  /** De quién está abierto el panel de modo manual. */
  const [manualDe, setManualDe] = useState<string | null>(null)
  /** El editor de los puntos del recorrido (qué es cada uno, cuánto se para). */
  const [puntosAbierto, setPuntosAbierto] = useState(false)
  /** Los puntos tal como vienen en la ruta: para el editor y sus sugerencias. */
  const [baseRuta, setBaseRuta] = useState<SharePayloadV1 | null>(null)
  const pideRutaPuntos = useCallback(() => setPuntosAbierto(true), [])
  /** De quién se está mirando el dorsal en grande (su userId), o null. */
  const [dorsal, setDorsal] = useState<string | null>(null)
  /** La carrera para imprimir en el dorsal: perfil, pasos y cortes. */
  const carrera = useMemo<DorsalCarrera | null>(() => {
    const ev = data?.event
    if (!baseRuta || !ev) return null
    // Con los puntos del EVENTO: los añadidos y movidos por quien organiza
    // salen en el dorsal y en el panel manual igual que en el mapa.
    const base = rutaDelEvento(baseRuta, ev.puntosAjustes)
    return carreraDeBase(base, {
      nombre: ev.name,
      salida: ev.startsAt,
      // El cierre publicado manda; si el evento no lo tiene, el último
      // corte del recorrido, que es de donde sale.
      cierre: ev.endsAt ?? ultimoCierre(base),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRuta, data?.event.name, data?.event.startsAt, data?.event.endsAt, JSON.stringify(data?.event.puntosAjustes ?? null)])
  /** Lo que la porra le da a cada uno ("29h 00m – 33h 00m"), por nombre. */
  const [porras, setPorras] = useState<Map<string, string>>(new Map())
  /** Se está armando el GPX del recorrido para bajarlo. */
  const [bajandoGpx, setBajandoGpx] = useState(false)
  /** Tu previsión guardada para esta carrera, para "Mi plan". `undefined` mientras se mira. */
  const [miPrevision, setMiPrevision] = useState<Awaited<ReturnType<typeof listPlans>>[number] | null | undefined>(undefined)
  useEffect(() => {
    if (seccion !== 'plan' || !user) return
    let vivo = true
    listPlans()
      .then((ps) => { if (vivo) setMiPrevision(ps.find((pl) => pl.eventId === id) ?? null) })
      .catch(() => { if (vivo) setMiPrevision(null) })
    return () => { vivo = false }
  }, [seccion, id, user])
  /** Lo último que se subió como vista previa, para no repetir la subida. */
  const tarjetaSubida = useRef<string | null>(null)

  /**
   * La vista previa del enlace, dibujada y subida.
   *
   * Quien pega el enlace de la parrilla en el grupo no ve la aplicación: ve la
   * pastilla que arma WhatsApp con lo que diga el HTML, y decide si toca por
   * eso. Se dibuja aquí porque en el borde no hay lienzo, y la sube QUIEN
   * ORGANIZA, que es quien pone el nombre, el cartel y la hora: si la subiera
   * cualquiera que abre la parrilla, treinta personas dibujarían la misma
   * imagen treinta veces.
   *
   * Solo cuando algo de lo que se ve ha cambiado —la firma—: sin eso, cada
   * visita del organizador repetiría una subida idéntica.
   */
  useEffect(() => {
    const ev = data?.event
    if (!ev?.isOwner) return
    const cuantos = data?.members.length ?? 0
    const firma = [ev.name, ev.hasPhoto, ev.photoAt ?? '', ev.startsAt ?? '', ev.endedAt ?? '',
      ev.planTotalKm ?? '', cuantos].join('|')
    if (tarjetaSubida.current === firma) return
    tarjetaSubida.current = firma
    void (async () => {
      try {
        const { dibujaTarjetaEvento, cargaImagen, VARIANTES } = await import('../lib/eventCard')
        // `hasPhoto` y no `photoAt`: los eventos anteriores a que existiera esa
        // marca de tiempo tienen cartel y la traen a null, y se quedaban sin él.
        const cartel = ev.hasPhoto ? await cargaImagen(eventPhotoUrl(ev.id, ev.photoAt)) : null
        const datos = {
          nombre: ev.name,
          cartel,
          cuando: ev.startsAt ? new Date(ev.startsAt).toLocaleString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          }) : null,
          participantes: cuantos,
          km: ev.planTotalKm ?? null,
          desnivel: null,
          terminada: ev.endedAt !== null,
        }
        // Una por enlace. Los tres se pegan en el mismo grupo —la parrilla a
        // quien corre, el público a quien mira, la invitación a quien aún no
        // está— y con una sola imagen parecían el mismo enlace repetido. Se
        // suben en fila y al mejor esfuerzo: si una falla, las otras valen.
        for (const v of VARIANTES) {
          const png = dibujaTarjetaEvento({ ...datos, tipo: v.tipo })
          const blob = await (await fetch(png)).blob()
          await fetch(`/og/evento-${encodeURIComponent(ev.id)}${v.sufijo}.png`, {
            method: 'PUT', body: blob,
          })
        }
      } catch { /* al mejor esfuerzo: sin tarjeta, la vista previa es la de antes */ }
    })()
  }, [data])
  const [copied, setCopied] = useState(false)
  const [copiedPublic, setCopiedPublic] = useState(false)
  /** Qué pasó con "Compartir seguimiento": copiar no se ve, y hay que decirlo. */
  const [comoFueSeguimiento, setComoFueSeguimiento] = useState<ComoSeFueEnlace | null>(null)
  /** Foto elegida a la espera de encuadre (la sube el recortador, no el input). */
  const [cropping, setCropping] = useState<File | null>(null)
  /** La marca favorita de la cuenta, para ofrecer guardar la de aquí como tal. */
  const [fav, setFav] = useState<{ favEmoji: string | null; favColor: string | null } | null>(null)
  /** Participante cuya marca está editando el organizador (su userId). */
  const [editing, setEditing] = useState<string | null>(null)
  /** De quién se está leyendo la frase en la ventana (su userId), o null. Una
   *  a la vez: es una ventana encima, no un despliegue dentro de la lista. */
  const [bocadilloDe, setBocadilloDe] = useState<string | null>(null)
  /** El tablón, en edición (solo quien organiza). */
  const [editandoNotas, setEditandoNotas] = useState(false)
  /** Llega con `&marca=1` desde la unión cuando su emoji favorito estaba cogido. */
  const [emojiTaken] = useState(() => new URLSearchParams(window.location.search).has('marca'))

  /** Si ya se preguntó por la porra en esta visita (aunque no hubiera nada). */
  const porraPedida = useRef(false)

  /**
   * Lo que hace falta para IMPRIMIR el dorsal, y solo cuando se pide.
   *
   * El perfil sale de la base publicada —decenas de miles de puntos— y lo que
   * le da la porra, de los pronósticos: dos cosas que la parrilla no necesita
   * para nada más. Así que no se bajan al abrir la pantalla, sino la primera
   * vez que alguien pulsa un dorsal, y se quedan puestas para los demás.
   */
  useEffect(() => {
    const ev = data?.event
    // El recorrido se baja para el dorsal, para señalar dónde se retiró
    // alguien y para anotar pasos en modo manual: los tres necesitan sus
    // puntos de paso. (El manual se olvidó aquí, y su panel salía sin
    // controles donde poner las horas.)
    if ((dorsal === null && ajustando === null && manualDe === null && !puntosAbierto) || !ev) return
    let vivo = true
    if (baseRuta === null && ev.planShareId) {
      void (async () => {
        try {
          const base = await getEventPlan(ev.planShareId!)
          if (!vivo) return
          setBaseRuta(base)
        } catch { /* sin recorrido el dorsal sale sin perfil, y sigue valiendo */ }
      })()
    }
    if (!porraPedida.current && ev.betsEnabled) {
      porraPedida.current = true
      void (async () => {
        try {
          const d = await getEventBets(id)
          if (!vivo || d.startsAt === null) return
          const salida = d.startsAt
          const mins = new Map<string, number[]>()
          for (const b of d.bets) {
            if (b.kind !== 'finish_time') continue
            const m = (Number(b.value) - salida) / 60_000
            if (!Number.isFinite(m) || m <= 0) continue
            mins.set(b.target, [...(mins.get(b.target) ?? []), m])
          }
          const dicho = new Map<string, string>()
          for (const [nombre, lista] of mins) {
            const orden = [...lista].sort((a, b) => a - b)
            dicho.set(nombre, orden.length > 1
              ? `${durationLabel(orden[0] * 60_000)} – ${durationLabel(orden[orden.length - 1] * 60_000)}`
              : durationLabel(orden[0] * 60_000))
          }
          setPorras(dicho)
        } catch { /* sin porra, la banda del dorsal va con el día y ya está */ }
      })()
    }
    return () => { vivo = false }
  }, [dorsal, ajustando, manualDe, puntosAbierto, baseRuta, data, id])

  const refresh = useCallback(async () => {
    try {
      setData(await getEvent(id))
      setError(null)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    }
  }, [id])

  // La favorita se pide una vez: solo sirve para el botón de "guardar como mi
  // marca", no para pintar la parrilla.
  useEffect(() => {
    if (status !== 'ready' || !user) return
    let alive = true
    getProfile().then((p) => { if (alive) setFav(p) }).catch(() => { /* sin favorita se vive igual */ })
    return () => { alive = false }
  }, [status, user])

  useEffect(() => {
    if (status !== 'ready' || !user) return
    void refresh()
    const t = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [refresh, status, user])

  /**
   * Completa la distancia del recorrido si al evento le falta.
   *
   * Es dato del recorrido y llega al publicarlo, pero los eventos creados antes
   * de que existiera se quedaron sin él — y sin él no se puede decir quién
   * llegó a meta: los resultados salían con "0 de 3 llegaron". Lo calcula aquí
   * quien organiza, que es quien puede escribirlo, abriendo el payload que el
   * servidor nunca abre. Una vez y en silencio.
   */
  /** Eventos a los que ya se les intentó completar los datos en esta visita. */
  const rellenado = useRef<Set<string>>(new Set())

  useEffect(() => {
    const ev = data?.event
    if (!ev?.isOwner || !ev.planShareId) return
    // El trazado también se rehace si el guardado es demasiado basto: los
    // eventos anteriores a que se muestreara por distancia llevan 800 puntos
    // repartidos por toda la carrera, que en una de cien kilómetros son ciento
    // veinte metros entre vértices.
    const finoYa = ev.hasPolyline && trazadoBastaFino(ev.polylinePts, ev.planTotalKm)
    if (ev.planTotalKm != null && finoYa && ev.activity && ev.endsAt != null) return
    // Una vez por evento y por visita, pase lo que pase. La condición de arriba
    // no basta como freno: un recorrido SIN cortes no tiene cierre que copiar,
    // así que `endsAt` seguiría vacío después de intentarlo y la parrilla se
    // bajaría el payload entero en cada refresco. Lo que hay que recordar no es
    // el resultado, es que ya se intentó.
    if (rellenado.current.has(ev.id)) return
    rellenado.current.add(ev.id)
    let vivo = true
    void (async () => {
      try {
        const base = await getEventPlan(ev.planShareId!)
        const km = base.track.totalDistanceKm
        if (!vivo || !Number.isFinite(km) || km <= 0) return
        // El cierre de meta sale del propio recorrido —su último corte—, igual
        // que al publicarlo. Solo si falta: si el organizador puso una hora a
        // mano, esa manda.
        const cierre = ev.endsAt == null ? (ultimoCierre(base) ?? undefined) : undefined
        // Y solo se manda LO QUE FALTA. Un recorrido sin cortes no tiene cierre
        // que copiar, así que ese hueco no se va a llenar nunca: sin esta
        // comprobación, cada visita a su parrilla reescribía el trazado entero
        // para no cambiar nada.
        const faltaTrazado = !finoYa || ev.planTotalKm == null
        if (!faltaTrazado && !cierre && ev.activity) return
        await setEventTotalKm(
          id,
          km,
          faltaTrazado ? simplificaTrazado(base) : undefined,
          base.paceConfig?.activity,
          cierre,
        )
        await refresh()
      } catch { /* sin recorrido a mano se queda como estaba */ }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.event?.isOwner, data?.event?.planShareId, data?.event?.planTotalKm])

  /** A quién le toca asomar su frase en el globito del nombre: uno cada vez,
   *  sorteado entre los que han escrito algo. El turno lo lleva la parrilla y
   *  no cada fila, que es la única forma de que salga UNO y no todos.
   *
   *  Va aquí arriba y no junto a la lista, que es donde se usa, porque debajo
   *  hay cuatro salidas tempranas —sin sesión, cargando, error— y un hook
   *  detrás de un `return` se ejecuta en unos renders sí y en otros no. */
  const clavesConFrase = useMemo(
    () => (data?.members ?? []).filter((m) => m.bocadillo).map((m) => m.userId),
    [data],
  )
  const pensamiento = usePensamiento(clavesConFrase)

  if (status !== 'ready') {
    return <div className="h-dvh"><CargandoMarca texto="Cargando…" /></div>
  }
  // Sin sesión no se puede ni mirar: un evento es de sus participantes. El
  // enlace queda guardado en la URL, así que al entrar se vuelve aquí solo.
  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">Inicia sesión para ver este evento.</p>
        <a href="/" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
      </Shell>
    )
  }
  if (error && !data) {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error}</p>
        <a href="/" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">Ir al inicio →</a>
      </Shell>
    )
  }

  if (!data) return <div className="h-dvh"><CargandoMarca texto="Cargando el evento…" /></div>

  const { event, members: enParrilla, takenColors, takenEmojis } = data
  /**
   * La parrilla, por DORSAL.
   *
   * Venían en el orden en que se apuntaron, que de puertas afuera se lee como
   * un orden aleatorio: nadie recuerda quién entró antes al evento, y buscar a
   * alguien en una lista de treinta obligaba a leerla entera. Una parrilla se
   * ordena como se ordena una salida —por dorsal— y quien aún no lo tiene va
   * detrás, por nombre.
   *
   * Los dorsales se comparan como NÚMEROS cuando lo son, que si no el 100 se
   * cuela entre el 10 y el 11.
   */
  const members = [...enParrilla].sort((a, b) => {
    const na = Number(a.bib), nb = Number(b.bib)
    const numA = a.bib !== null && Number.isFinite(na)
    const numB = b.bib !== null && Number.isFinite(nb)
    if (numA && numB) return na - nb
    if (a.bib !== null && b.bib !== null) return a.bib.localeCompare(b.bib)
    if (a.bib !== null) return -1
    if (b.bib !== null) return 1
    return a.username.localeCompare(b.username)
  })
  // Las marcas de todos, plegadas: `takenEmojis` viene sin la propia (para que
  // el selector de uno no salga en blanco), y para editar la de otro hace falta
  // la lista entera menos la suya.
  const emojiKeys = new Map(members.filter((m) => m.emoji).map((m) => [m.userId, foldEmoji(m.emoji!)]))
  const allEmojiKeys = [...emojiKeys.values()]
  const me = members.find((m) => m.userId === user.id)
  /** ¿Mi baliza está ya unida a este evento? (la lista lo dice: trae mi sesión) */
  const meLive = !!me?.sessionId
  const now = Date.now()

  /**
   * Sacar a alguien de la parrilla.
   *
   * Se confirma en su propia fila y no con un `confirm()` del navegador: el
   * diálogo del sistema tapa la lista justo cuando hace falta verla para saber
   * a quién se está sacando, y con treinta filas iguales eso importa.
   */
  async function expulsa(userId: string) {
    setBusy(true); setError(null)
    try {
      await expulsaDelEvento(id, userId)
      setExpulsando(null)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  /**
   * El GPX del recorrido del evento, bajado desde la propia parrilla.
   *
   * Se pide la base publicada y se serializa AQUÍ, en el navegador: sale el
   * mismo fichero que daría el planificador —trazado a resolución completa,
   * los POIs como `<wpt>` y los cierres dentro de `<extensions>`—, pero sin
   * obligar a entrar al planificador a buscarlo. Quien lo quiere suele estar
   * en el móvil, recién llegado del enlace del grupo, y lo único que busca es
   * pasárselo al reloj.
   *
   * No se baja al abrir la pantalla: son decenas de miles de puntos que la
   * parrilla no necesita para nada más, así que solo cuando se pulsa.
   */
  async function descargaGpx() {
    const ev = data?.event
    if (!ev?.planShareId || bajandoGpx) return
    setBajandoGpx(true); setError(null)
    try {
      const base = await getEventPlan(ev.planShareId)
      const { track, cutoffWallClocks } = reviveSharePayload(base)
      // El nombre de la CARRERA, no el del track: es como la gente llama a
      // este fichero cuando lo tiene en el reloj entre otros veinte.
      const nombre = (ev.name || track.name || 'recorrido').replace(/[^a-z0-9_-]/gi, '_')
      downloadGpx(track, cutoffWallClocks, `${nombre}.gpx`)
    } catch (e) {
      setError(e instanceof EventsError
        ? eventsErrorMessage(e.code)
        : 'No se ha podido preparar el GPX del recorrido. Inténtalo de nuevo.')
    } finally { setBajandoGpx(false) }
  }

  /** Nombrar o quitar organizador. Solo lo ofrece la pantalla al dueño. */
  async function nombraOrganizador(userId: string, organizer: boolean) {
    setBusy(true); setError(null)
    try {
      await setEventOrganizer(id, userId, organizer)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  async function pickColor(slug: string, userId?: string) {
    setBusy(true); setError(null)
    try {
      await setEventColor(id, slug, userId)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  async function pickEmoji(emoji: string, userId?: string) {
    setBusy(true); setError(null)
    try {
      await setEventEmoji(id, emoji, userId)
      await refresh()
    } catch (e) {
      // Un choque de emoji es información nueva sobre el evento: se recarga
      // para que el selector deje de ofrecer el que ya no está libre.
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
      await refresh()
    } finally { setBusy(false) }
  }

  /** Guarda la marca de aquí como la favorita de la cuenta, para las próximas. */
  async function guardarFavorita(emoji: string | null, color: string | null) {
    setBusy(true); setError(null)
    try {
      setFav(await saveProfile({ favEmoji: emoji, favColor: color }))
    } catch {
      setError('No se pudo guardar tu marca favorita.')
    } finally { setBusy(false) }
  }

  /** Renombrar la carrera. Vacío no vale, así que ni se manda. */
  async function guardarNombre(texto: string) {
    const limpio = texto.trim()
    if (!limpio || limpio === event.name) return
    setBusy(true); setError(null)
    try { await setEventName(id, limpio); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function guardarNotas(texto: string) {
    setBusy(true); setError(null)
    try { await setEventNotes(id, texto); await refresh(); setEditandoNotas(false) }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  /** La hora oficial de la carrera. Vacío la quita. */
  async function guardarSalida(valor: string) {
    const ms = valor ? new Date(valor).getTime() : null
    if (valor && !Number.isFinite(ms as number)) return
    setBusy(true); setError(null)
    try { await setEventStart(id, ms); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function guardarCierre(valor: string) {
    const ms = valor ? new Date(valor).getTime() : null
    if (valor && !Number.isFinite(ms as number)) return
    setBusy(true); setError(null)
    try { await setEventEnd(id, ms); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function guardarLimite(horas: string) {
    const h = horas.trim() ? Number(horas) : null
    if (h !== null && (!Number.isFinite(h) || h <= 0)) return
    setBusy(true); setError(null)
    try { await setEventLimit(id, h === null ? null : Math.round(h * 60)); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function toggleColorsLocked(locked: boolean) {
    setBusy(true); setError(null)
    try {
      await setEventColorsLocked(id, locked)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  async function terminaCarrera(end: boolean) {
    if (end && !window.confirm(
      '¿Damos la carrera por terminada? Se congelan los resultados y deja de admitir gente. Puedes reabrirla.',
    )) return
    setBusy(true); setError(null)
    try {
      await endEvent(id, end)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  async function cambiaActividad(a: 'walk' | 'run' | 'bike') {
    setBusy(true); setError(null)
    try { await setEventActivity(id, a); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  /**
   * Dar a alguien por retirado, o devolverlo a la carrera.
   *
   * Es la vía para lo que la traza no puede saber: quien organiza tiene la
   * llamada del corredor o lo ha visto subir a la furgoneta. Manda sobre la
   * detección automática, que es prudente a propósito.
   */
  async function marcaAbandono(username: string, retirado: boolean, km?: number) {
    setBusy(true); setError(null)
    try {
      await marcaRetirado(id, username, retirado ? undefined : null, km)
      if (km !== undefined) setAjustando(null)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /**
   * Modo manual: cuando la baliza de alguien no sirve, quien organiza anota
   * sus pasos por los controles desde el cronometraje oficial.
   */
  async function cambiaManual(username: string, cambio: { modo: boolean } | { km: number; at: number | null; con?: string }) {
    setBusy(true); setError(null)
    try {
      await marcaManual(id, username, cambio)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Cambia un punto del recorrido en el evento: qué es, cuánto se para, dónde está; o lo añade o quita. */
  async function cambiaElPunto(cambio: Parameters<typeof cambiaPunto>[1]) {
    setBusy(true); setError(null)
    try {
      await cambiaPunto(id, cambio)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /**
   * "Va con…" para quien va en modo manual: los que llevan baliza (y no van en
   * manual ni se han retirado), y cómo sacar la referencia de uno de ellos.
   */
  function igualarPara(m: EventMember): Igualar {
    const con = (data?.members ?? [])
      .filter((o) => o.userId !== m.userId && o.sessionId !== null && o.manualPasos == null && o.retiredAt === null)
      .map((o) => ({ nombre: o.username, emoji: o.emoji }))
    return {
      con,
      calcula: async (nombre) => {
        if (!baseRuta) return 'Aún no se ha cargado el recorrido.'
        const live = await getEventLive(id)
        const r = live.runners.find((x) => x.username === nombre)
        if (!r) return `${nombre} no está en la carrera.`
        const pista = rutaDelEvento(baseRuta, data?.event.puntosAjustes).track
        const desde = (m.manualPasos ?? []).reduce((mx, [k]) => Math.max(mx, k), 0)
        return referenciaDe(r, pista, desde)
      },
    }
  }

  /** La hora de meta oficial de alguien (null la quita). */
  async function guardaOficial(username: string, at: number | null) {
    setBusy(true); setError(null)
    try {
      await marcaOficial(id, username, at)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Da de alta a un corredor sin baliza: va en modo manual desde el principio. */
  async function altaSinBaliza(nombre: string, dorsal: string) {
    setBusy(true); setError(null)
    try {
      await anadeSinBaliza(id, nombre, dorsal)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Guarda el evento ahora: el replay, el recorrido y la foto, sin caducidad. */
  async function guardar() {
    setBusy(true); setError(null)
    try {
      await guardaEvento(id)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  async function recalcular() {
    setBusy(true); setError(null)
    try {
      await recomputeEventStats(id)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  async function togglePorra(on: boolean) {
    setBusy(true); setError(null)
    try {
      await setEventBetsEnabled(id, on)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Sube el recorte ya hecho: lo que se vio en el marco es lo que se guarda. */
  async function uploadPhoto(jpeg: Blob) {
    setCropping(null)
    setBusy(true); setError(null)
    try {
      await setEventPhoto(id, jpeg)
      // El refresco trae el `photoAt` nuevo, y con él la url nueva.
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /**
   * Guarda la frase que uno cuelga de su nombre. Vacía la quita.
   *
   * La escribe la VENTANA y ya no un diálogo del sistema: hay un límite de
   * caracteres que enseñar mientras se teclea, y `window.prompt` ni lo enseña
   * ni deja ver la frase con el tamaño con el que la van a leer los demás.
   */
  async function guardaBocadillo(valor: string) {
    setBusy(true); setError(null)
    try {
      await setBocadillo(id, valor.trim().slice(0, BOCADILLO_MAX))
      await refresh()
      setBocadilloDe(null)
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Pide el dorsal y lo guarda. Vacío lo quita. */

  async function pedirDorsal(userId: string, actual: string) {
    const valor = window.prompt('Dorsal de la carrera (vacío para quitarlo)', actual)
    if (valor === null) return
    setBusy(true); setError(null)
    try {
      await setBib(id, valor.trim(), userId === user!.id ? undefined : userId)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }


  /** Guarda un enlace oficial de la carrera (solo el organizador). */
  async function pedirEnlace(cual: 'trackingUrl' | 'websiteUrl') {
    const etiqueta = cual === 'trackingUrl' ? 'Seguimiento oficial de la organización' : 'Web de la carrera'
    const valor = window.prompt(`${etiqueta} (vacío para quitarlo)`, event[cual] ?? '')
    if (valor === null) return
    setBusy(true); setError(null)
    try {
      await setEventLinks(id, { [cual]: valor.trim() })
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Une (o saca) del evento la baliza que ya se está emitiendo. */
  async function toggleBeacon(attach: boolean) {
    setBusy(true); setError(null)
    try {
      await attachBeacon(id, attach)
      await refresh()
    } catch (e) {
      setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network'))
    } finally { setBusy(false) }
  }

  /** Publica el evento, regenera el enlace, o lo deja de compartir. */
  async function togglePublic(share: boolean) {
    if (!share && !window.confirm('El enlace dejará de funcionar para quien lo tenga. ¿Seguro?')) return
    setBusy(true); setError(null)
    try { await setEventPublic(id, share); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function copyPublic() {
    if (!event.publicToken) return
    try {
      await navigator.clipboard.writeText(eventPublicLink(event.publicToken))
      setCopiedPublic(true)
      window.setTimeout(() => setCopiedPublic(false), 2000)
    } catch { /* sin portapapeles: el enlace está a la vista para copiarlo a mano */ }
  }

  /**
   * El enlace de seguimiento, al grupo de la familia: el mismo que "Copiar
   * enlace" de abajo, pero arriba y por el menú de compartir del móvil, que es
   * lo que un participante busca cuando le preguntan "¿dónde te sigo?". La URL
   * de esta pantalla no sirve para eso: sin cuenta pide iniciar sesión.
   */
  async function compartirSeguimiento() {
    if (!event.publicToken) return
    const fue = await comparteEnlace(
      eventPublicLink(event.publicToken),
      `${event.name} · en directo`,
      `Sigue ${event.name} en directo, sin necesidad de cuenta:`,
    )
    if (fue === 'cancelado') return
    setComoFueSeguimiento(fue)
    window.setTimeout(() => setComoFueSeguimiento(null), 3000)
  }

  async function copyInvite() {
    if (!event.inviteCode) return
    try {
      await navigator.clipboard.writeText(eventJoinLink(event.inviteCode))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* sin portapapeles: el enlace está a la vista para copiarlo a mano */ }
  }

  async function regenerate() {
    if (!window.confirm('El código actual dejará de funcionar al instante. Quien ya está dentro sigue dentro. ¿Generar uno nuevo?')) return
    setBusy(true)
    try { await regenerateEventInvite(id); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function leave() {
    // Quien organiza no se va a ningún sitio al salirse: deja de correrla y se
    // queda en su parrilla, así que ni el aviso ni el destino son los mismos.
    const soyDueño = event.isOwner
    const aviso = soyDueño
      ? '¿Dejas de correr esta carrera? Sigues organizándola: el código, la foto y el recorrido siguen siendo tuyos.'
      : '¿Salir del evento? Tus seguimientos se conservan; solo dejas de aparecer en el mapa del evento.'
    if (!window.confirm(aviso)) return
    setBusy(true)
    try {
      await leaveEvent(id)
      if (soyDueño) { await refresh(); setBusy(false) } else { window.location.href = '/' }
    } catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setBusy(false) }
  }

  /** Apuntarse a la propia carrera: con el código, que el organizador ya tiene. */
  async function apuntarme() {
    if (!event.inviteCode) return
    setBusy(true); setError(null)
    try { await joinEvent(event.inviteCode); await refresh() }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')) }
    finally { setBusy(false) }
  }

  async function destroy() {
    if (!window.confirm(`¿Borrar "${event.name}"? Los participantes dejan de verse entre sí. Los seguimientos de cada uno se conservan. No se puede deshacer.`)) return
    setBusy(true)
    try { await deleteEvent(id); window.location.href = '/' }
    catch (e) { setError(eventsErrorMessage(e instanceof EventsError ? e.code : 'network')); setBusy(false) }
  }

  const ir = onIr ?? ((vista: VistaEvento) => { window.location.href = enlaceDeVista(id, vista) })
  /** Un enlace a otra sección: dirección de verdad, pero un toque normal no recarga. */
  const alPulsar = (vista: VistaEvento) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    ir(vista)
  }

  /**
   * La barra del evento, arriba y fija: el nombre, quién mira y las
   * secciones. Sale en la parrilla y en tu plan igual que sobre el mapa.
   */
  const barra = nav ? (
    <div
      className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 pb-2 backdrop-blur"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <EventCabecera nombre={event.name} nav={nav} />
    </div>
  ) : null

  /**
   * MI PLAN: lo tuyo sobre la carrera de todos, en su propia sección.
   *
   * Antes era un bloque a mitad de la parrilla, y ajustar abría siempre una
   * copia nueva del recorrido del evento: al guardarla pisaba los ritmos que ya
   * tenías. Ahora dice si tienes previsión y de cuándo es, y "Ajustar" abre la
   * TUYA. Planificar desde cero solo se ofrece a quien no tiene ninguna.
   */
  if (seccion === 'plan') {
    const planificar = event.planShareId
      ? `/?s=${encodeURIComponent(event.planShareId)}&de=${encodeURIComponent(id)}${event.startsAt ? `&salida=${event.startsAt}` : ''}`
      : null
    const ajustar = miPrevision ? `/?prevision=${encodeURIComponent(miPrevision.id)}&de=${encodeURIComponent(id)}` : planificar
    return (
      <Shell barra={barra}>
        <p className="text-[11px] uppercase tracking-wider text-slate-500">🧭 Mi plan</p>
        <h1 className="text-xl font-bold text-slate-100">{event.name}</h1>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {!me ? (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
            El plan es de quien corre, y no estás en la parrilla de esta carrera.
          </p>
        ) : (
          <>
            <BaseChangeNotice
              eventId={id}
              planShareId={event.planShareId}
              planUpdatedAt={event.planUpdatedAt}
              planChange={event.planChange}
              startsAt={event.startsAt}
              soyParticipante
            />
            <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <h2 className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Tu ruta</h2>
              <p className="text-sm text-slate-300">
                {miPrevision === undefined
                  ? 'Mirando tus rutas…'
                  : miPrevision
                    ? <>«{miPrevision.name}», guardada el {fmtDate(miPrevision.updatedAt)}. Lleva tus ritmos y objetivos para esta carrera.</>
                    : 'Aún no tienes. Corres con los ritmos del recorrido del evento; ponte los tuyos sin cambiar nada a los demás.'}
              </p>
              {ajustar ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <a
                    href={ajustar}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
                  >
                    {miPrevision ? 'Ajustar mi ruta →' : 'Planificar mi salida →'}
                  </a>
                  {/* El GPX es el recorrido de la carrera: sin recorrido publicado no hay nada que bajar. */}
                  {event.planShareId && (
                  <button
                    type="button"
                    onClick={descargaGpx}
                    disabled={bajandoGpx}
                    title="Descargar el GPX del recorrido del evento, con los controles y los cierres dentro"
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800/60 disabled:opacity-50"
                  >
                    <Download size={13} className="shrink-0" />
                    {bajandoGpx ? 'Preparando…' : 'Descargar el GPX'}
                  </button>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">La organización todavía no ha publicado el recorrido.</p>
              )}
              {miPrevision && planificar && (
                <p className="mt-2 text-[11px] text-slate-500">
                  ¿Prefieres empezar de cero?{' '}
                  <a href={planificar} className="text-sky-400 hover:underline">Abrir el recorrido del evento</a>
                  : al guardar, sustituye a la que tienes.
                </p>
              )}
            </section>
            <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <h2 className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">En la baliza</h2>
              <p className="text-xs leading-relaxed text-slate-400">
                Al elegir esta carrera en la app, la baliza coge tu ruta sola (con la app al día; si no, elígela en la
                baliza). Sin ruta propia corre con la del evento. El GPX lleva dentro los controles y los horarios de
                cierre, listo para el reloj.
              </p>
            </section>
            <p className="mt-3 text-[11px] text-slate-500">
              El recorrido, los controles y los horarios de cierre son de la carrera, iguales para todos. Los ritmos son tuyos y no se comparten.
            </p>
          </>
        )}
      </Shell>
    )
  }

  return (
    <Shell barra={barra}>
      {event.hasPhoto && (
        <div className="mb-3">
          <img
            // La versión sale del servidor (`event.photoAt`), no de un estado
            // local: si dependiera de haber subido tú la foto, los demás
            // seguirían viendo la anterior mientras su caché aguantase.
            src={eventPhotoUrl(id, event.photoAt)}
            alt=""
            // La misma proporción con la que se encuadró: así se ve entera la
            // región elegida, sin un segundo recorte por el camino.
            style={{ aspectRatio: String(EVENT_PHOTO_ASPECT) }}
            className="w-full object-cover rounded-xl border border-slate-800"
          />
        </div>
      )}
      <p className="text-[11px] uppercase tracking-wider text-slate-500">🏁 La parrilla</p>
      <h1 className="text-xl font-bold text-slate-100">{event.name}</h1>
      <p className="text-xs text-slate-400 mt-0.5">
        {[
          event.planName ? `Ruta: ${event.planName}` : 'Sin recorrido todavía',
          event.startsAt ? fmtDate(event.startsAt) : null,
          `${members.length} ${members.length === 1 ? 'participante' : 'participantes'}`,
        ].filter(Boolean).join(' · ')}
      </p>
      {/* Cuándo se publicó por última vez el recorrido. Sale para todos, no
          solo para quien organiza: es el dato que dice si lo que tienes
          planificado se hizo sobre esta versión o sobre una anterior. Va en
          línea aparte para que no se confunda con la fecha de la carrera. */}
      {event.planUpdatedAt != null && (
        <p className="text-[11px] text-slate-500 mt-0.5">
          Recorrido actualizado el {fmtDate(event.planUpdatedAt)}
        </p>
      )}

      {/* Compartir el seguimiento, arriba, a la vista y SIEMPRE en el mismo
          sitio: es lo que se busca cuando la familia pregunta "¿dónde te
          sigo?", y lo busca igual quien corre que quien organiza o mira. Crear
          el enlace, regenerarlo o quitarlo es de la organización y vive allí;
          sin enlace, el botón sigue en su sitio y dice por qué no va. */}
      <div className="mt-3">
        <button
          onClick={() => void compartirSeguimiento()}
          disabled={!event.publicToken}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-700 bg-sky-950/40 py-2.5 text-sm font-semibold text-sky-300 transition-colors hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
        >
          <Share2 size={15} />
          {comoFueSeguimiento === 'copiado' ? 'Enlace copiado · pégalo en el grupo'
            : comoFueSeguimiento === 'compartido' ? 'Compartido ✓'
            : comoFueSeguimiento === 'fallido' ? 'No se ha podido compartir'
            : 'Compartir seguimiento'}
        </button>
        <p className="mt-1 text-center text-[11px] text-slate-500">
          {event.publicToken
            ? 'Para que familia y amigos sigan la carrera en directo, sin cuenta'
            : event.canOrganize
              ? 'Aún no hay enlace público: créalo en Organización, más abajo'
              : 'Aún no hay enlace público: lo crea quien organiza'}
        </p>
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {/* Antes que nada: si la organización movió el recorrido después de que
          guardaras tu previsión, eso manda sobre cualquier otra cosa de esta
          pantalla. */}
      <BaseChangeNotice
        eventId={id}
        planShareId={event.planShareId}
        planUpdatedAt={event.planUpdatedAt}
        planChange={event.planChange}
        startsAt={event.startsAt}
        soyParticipante={!!me}
      />

      {/* El tablón de la carrera: bolsa de vida, autobuses, avituallamientos.
          Va ARRIBA, antes que los participantes: es lo que hay que leer, y una
          nota que hay que ir a buscar al final de la página no la lee nadie.
          Se ve tal cual se escribió (`whitespace-pre-wrap`), sin interpretar
          nada: quien escribe una lista con guiones quiere una lista con
          guiones, y lo que llega es texto de otra persona, no marcado. */}
      {(event.notes || (event.canOrganize && editandoNotas)) && (
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <h2 className="text-[11px] uppercase tracking-wider text-slate-500">Notas de la carrera</h2>
            {event.canOrganize && !editandoNotas && (
              <button
                onClick={() => setEditandoNotas(true)}
                className="ml-auto text-[11px] text-slate-400 hover:text-sky-400"
              >
                Editar
              </button>
            )}
          </div>
          {editandoNotas ? (
            <NotasEditor
              inicial={event.notes ?? ''}
              busy={busy}
              onGuardar={(t) => void guardarNotas(t)}
              onCancelar={() => setEditandoNotas(false)}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{event.notes}</p>
          )}
        </section>
      )}

      {event.canOrganize && !event.notes && !editandoNotas && (
        <button
          onClick={() => setEditandoNotas(true)}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-400 transition-colors hover:border-sky-700 hover:text-sky-400"
        >
          + Notas de la carrera
        </button>
      )}

      {/* Participantes */}
      <section className="mt-4">
        <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">En la parrilla</h2>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <MemberRow
              key={m.userId} m={m} now={now} isMe={m.userId === user.id} eventId={id}
              // La marca de los demás solo la toca quien organiza: es de cada
              // uno, pero alguien tiene que poder arreglar un emoji repetido o
              // repartir los colores cuando están reservados.
              canEditMark={!!event.canOrganize}
              editing={editing === m.userId}
              onToggleMark={() => setEditing(editing === m.userId ? null : m.userId)}
              takenEmojis={allEmojiKeys.filter((k) => k !== emojiKeys.get(m.userId))}
              takenColors={takenColors}
              busy={busy}
              onPickEmoji={(e) => void pickEmoji(e, m.userId)}
              onPickColor={(c) => void pickColor(c, m.userId)}
              // El propio siempre; el de los demás, solo quien organiza — los
              // dorsales se reparten juntos y quien los tiene delante es él.
              canEditBib={m.userId === user.id || event.isOwner}
              onBib={(userId, actual) => void pedirDorsal(userId, actual)}
              onBocadillo={() => setBocadilloDe(m.userId)}
              pensando={pensamiento.clave === m.userId && pensamiento.visible}
              onDorsal={() => setDorsal(m.userId)}
              // Sacar de la parrilla: quien organiza y quien administra, y
              // nunca a uno mismo —para eso está "salir del evento", que dice
              // lo que hace— ni a quien organiza, que es de quien cuelga todo.
              canExpel={(event.isOwner || user.isAdmin) && m.userId !== user.id && !m.isOwner}
              confirmingExpel={expulsando === m.userId}
              onAskExpel={() => setExpulsando(expulsando === m.userId ? null : m.userId)}
              onExpel={() => void expulsa(m.userId)}
              // Nombrar organizadores es del DUEÑO y de quien administra, no de
              // un organizador: un permiso que se propaga solo acaba en que
              // nadie sabe quién dio qué a quién.
              canName={(event.isOwner || user.isAdmin) && !m.isOwner}
              onOrganizer={(v) => void nombraOrganizador(m.userId, v)}
              // Marcar el abandono: quien organiza, de cualquiera; y cualquiera,
              // de sí mismo — que es la forma honesta de bajarse, porque la
              // baliza se apaga cuando uno se acuerda.
              canRetire={event.canOrganize || m.userId === user.id}
              onRetire={(v) => void marcaAbandono(m.username, v)}
              // Precisar dónde lo dejó señalando un punto del recorrido: el
              // sitio se recuerda —"en Canfranc Pueblo"— y el kilómetro y la
              // hora salen de ahí.
              ajustando={ajustando === m.username}
              onAjustar={() => setAjustando(ajustando === m.username ? null : m.username)}
              puntos={carrera?.puntos ?? []}
              onPunto={(km) => void marcaAbandono(m.username, true, km)}
              // Modo manual: solo quien organiza, que es quien tiene el
              // cronometraje oficial delante.
              canManual={event.canOrganize === true}
              manualAbierto={manualDe === m.username}
              onToggleManual={() => setManualDe(manualDe === m.username ? null : m.username)}
              onManual={(cambio) => void cambiaManual(m.username, cambio)}
              salidaMs={event.startsAt}
              totalKm={carrera?.km ?? null}
              igualar={event.canOrganize === true && m.manualPasos != null ? igualarPara(m) : undefined}
            />
          ))}
        </ul>
        {/* Corredores SIN BALIZA: quien organiza ya sabe que alguno no la va a
            llevar (no tiene la app, su móvil no aguanta…). Se le da de alta
            aquí y va en modo manual desde el principio: sus pasos se anotan
            del cronometraje oficial, como los de quien se queda sin batería. */}
        {event.canOrganize === true && !event.endedAt && (
          <AltaSinBaliza busy={busy} onAlta={(nombre, dorsal) => void altaSinBaliza(nombre, dorsal)} />
        )}
      </section>

      {/* Invitar, PEGADO a la lista de quién hay: es la respuesta a la pregunta
          que se hace mirándola —falta fulano— y estaba al final de la pantalla,
          después de la marca, los enlaces y los ajustes, donde nadie lo
          buscaba. */}
      {event.canOrganize && event.inviteCode && (
        <Plegable orga title="Invitar participantes" icon={<UserPlus size={13} />} summary="enlace listo">
          <p className="text-[11px] text-slate-500 mb-2">
            Este enlace sirve para todo el que quieras: se pega una vez en el grupo. Hace falta tener cuenta para entrar.
          </p>
          <code className="block break-all rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-[11px] text-slate-300">
            {eventJoinLink(event.inviteCode)}
          </code>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void copyInvite()} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50">
              {copied ? 'Copiado ✓' : 'Copiar enlace'}
            </button>
            <button onClick={() => void regenerate()} disabled={busy} className="px-2.5 py-1 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
              Generar código nuevo
            </button>
          </div>
        </Plegable>
      )}

      {/* Mi marca: el emoji identifica (es único) y el color agrupa (se repite).
          Plegada en cuanto está elegida —que es casi siempre, porque se entra
          con marca—: es una decisión que se toma una vez y luego solo estorba
          entre uno y el botón de salir. El resumen del encabezado enseña cuál
          es, así que abrirla solo hace falta para cambiarla. */}
      {/* Organizar y correr no son lo mismo: quien monta la carrera puede no
          salir, y entonces nada de lo personal —marca, planificación, unir la
          baliza— pinta nada en su pantalla. Lo que sí necesita es poder
          apuntarse si al final corre. */}
      {!me && (
        <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-sm text-slate-200">Organizas esta carrera, pero no la corres.</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            No apareces entre los participantes ni en el mapa. Sigues repartiendo el código, la foto y el
            recorrido, y puedes seguir la carrera en directo como todos.
          </p>
          {event.inviteCode && (
            <button
              onClick={() => void apuntarme()}
              disabled={busy}
              className="mt-2 rounded border border-sky-800 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40 disabled:opacity-50"
            >
              Apuntarme también
            </button>
          )}
        </section>
      )}

      {me && (
      <Plegable
        title="Mi marca"
        defaultOpen={!me?.emoji || emojiTaken}
        summary={
          <>
            <MarkBadge emoji={me?.emoji ?? null} color={me?.color ?? null} size={22} />
            <span className="truncate">{me?.emoji ? 'en el mapa eres tú' : 'sin elegir'}</span>
          </>
        }
      >
          <div className="flex items-center gap-3">
            <MarkBadge emoji={me?.emoji ?? null} color={me?.color ?? null} size={44} />
            <div className="min-w-0">
              <p className="text-sm text-slate-200">
                {me?.emoji ? `Eres ${me.emoji} en esta carrera` : 'Todavía no tienes emoji'}
              </p>
              <p className="text-[11px] text-slate-500">
                El emoji no se repite: es lo que te distingue cuando el mapa va lleno. El color puede
                coincidir con el de otros.
              </p>
            </div>
          </div>

          {/* Ofrecer guardarla como favorita solo cuando de verdad cambia algo:
              un botón que no hace nada enseña a ignorar los botones. */}
          {me && (me.emoji !== fav?.favEmoji || me.color !== fav?.favColor) && (me.emoji || me.color) && (
            <button
              onClick={() => void guardarFavorita(me.emoji, me.color)}
              disabled={busy}
              className="mt-2 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-sky-400 disabled:opacity-50"
            >
              ★ Guardar como mi marca para las próximas carreras
            </button>
          )}

          {emojiTaken && (
            <p className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-300">
              Tu emoji de siempre ya lo llevaba alguien en esta carrera, así que te hemos puesto otro. Cámbialo
              por el que quieras.
            </p>
          )}

          <div className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Emoji</h3>
            <EmojiField
              value={me?.emoji ?? null}
              taken={takenEmojis}
              busy={busy}
              onPick={(e) => void pickEmoji(e)}
            />
          </div>

          <div className="mt-3">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Color</h3>
            <ColorPalette
              value={me?.color ?? null}
              taken={takenColors}
              disabled={event.colorsLocked && !event.canOrganize}
              busy={busy}
              onPick={(c) => void pickColor(c)}
            />
            {event.colorsLocked && !event.canOrganize && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                En esta carrera los colores agrupan —el club, el relevo, la categoría— y los reparte quien
                organiza. Tu emoji sí lo eliges tú.
              </p>
            )}
          </div>

          {/* El candado, solo para quien organiza */}
          {event.canOrganize && (
            <label className="mt-3 flex items-start gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={event.colorsLocked}
                onChange={(e) => void toggleColorsLocked(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-sky-500"
              />
              <span>
                Agrupar por colores
                <span className="block text-slate-600">
                  El color pasa a significar algo —club, relevo, categoría— y lo reparto yo, para que nadie
                  se lo cambie la víspera. No revuelve lo ya elegido.
                </span>
              </span>
            </label>
          )}

      </Plegable>
      )}

      {/* Los enlaces de la ORGANIZACIÓN. No competimos con ellos: su
          seguimiento cronometra por controles y esto enseña dónde va cada uno
          ahora mismo. Tenerlos aquí ahorra ir a buscarlos en mitad de la
          carrera. Se validan al pintar además de al guardar: en la base pueden
          quedar enlaces de antes de que existiera la comprobación. */}
      {(event.trackingUrl || event.websiteUrl || event.isOwner) && (
        <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">La carrera</h2>
          <div className="flex flex-wrap gap-2">
            {isHttpUrl(event.trackingUrl) && (
              <a
                href={event.trackingUrl!} target="_blank" rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40"
              >
                ⏱️ Seguimiento oficial ↗
              </a>
            )}
            {isHttpUrl(event.websiteUrl) && (
              <a
                href={event.websiteUrl!} target="_blank" rel="noopener noreferrer"
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40"
              >
                🌐 Web de la carrera ↗
              </a>
            )}
            {event.isOwner && (
              <>
                <button
                  onClick={() => void pedirEnlace('trackingUrl')}
                  disabled={busy}
                  className="rounded border border-dashed border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-sky-400 disabled:opacity-50"
                >
                  {event.trackingUrl ? 'Cambiar seguimiento' : '+ Seguimiento oficial'}
                </button>
                <button
                  onClick={() => void pedirEnlace('websiteUrl')}
                  disabled={busy}
                  className="rounded border border-dashed border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-sky-400 disabled:opacity-50"
                >
                  {event.websiteUrl ? 'Cambiar web' : '+ Web de la carrera'}
                </button>
              </>
            )}
          </div>
          {!event.trackingUrl && !event.websiteUrl && event.isOwner && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              El seguimiento por dorsal de la organización y la web del evento, a mano para todos.
            </p>
          )}
        </section>
      )}

      {/* El directo: unir mi baliza. El mapa ya está en la barra de arriba, y
          un botón grande que llevaba a él le quitaba el sitio a lo único que
          solo se puede hacer aquí. */}
      <section className="mt-5 space-y-2">
        {/* Se sale a correr como siempre y desde aquí se dice a qué carrera
            pertenece esta salida: no hace falta empezar la baliza "dentro" del
            evento, que en mitad de una salida ya empezada sería tarde. Nada de
            esto existe para quien organiza sin correr. */}
        {me && (
        <button
          onClick={() => void toggleBeacon(!meLive)}
          disabled={busy}
          className={`w-full rounded-lg border text-sm transition-colors disabled:opacity-50 ${
            meLive
              ? 'border-slate-700 py-2 text-slate-300 hover:bg-slate-800'
              : 'border-sky-600 bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500'
          }`}
        >
          {meLive ? 'Quitar mi baliza del evento' : 'Unir mi baliza a este evento'}
        </button>
        )}
        <p className="text-[11px] text-slate-500">
          {!me
            ? 'Sigues la carrera desde el mapa como todos, aunque no corras.'
            : meLive
              ? 'Los demás participantes te ven en el mapa del evento.'
              : 'Empieza a compartir tu posición con la app y pulsa aquí para aparecer en el mapa.'}
        </p>
        {/* La app, justo donde se descubre que hace falta: quien entra en la
            parrilla y lee "empieza a compartir con la app" es exactamente quien
            todavía no la tiene. Solo a quien corre y aún no está emitiendo: con
            la baliza en marcha, sobra. El enlace no caduca —apunta siempre a la
            última publicada— y la de iPhone no se enlaza porque se reparte por
            invitación, así que ahí lo honesto es decir a quién pedirla. */}
        {me && !meLive && (
          <p className="mt-1 text-[11px] text-slate-500">
            ¿Aún no tienes la baliza?{' '}
            <a
              href={ANDROID_APK_URL}
              className="text-sky-400 hover:underline"
              rel="noopener"
            >
              Descárgala para Android
            </a>
            . En iPhone se reparte por TestFlight: pídesela a quien organiza.
          </p>
        )}
      </section>

      {/* Mi plan, a un toque: lo personal tiene su propia sección. */}
      {me && (
        <a
          href={enlaceDeVista(id, 'plan')}
          onClick={alPulsar('plan')}
          className="mt-5 flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-left transition-colors hover:border-sky-800"
        >
          <span className="text-xl" aria-hidden>🧭</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-100">Mi plan</span>
            <span className="block text-[11px] text-slate-400">Tus ritmos y objetivos para esta carrera, y el GPX para el reloj.</span>
          </span>
          <span className="shrink-0 text-slate-500" aria-hidden>›</span>
        </a>
      )}

      {/* La frontera, dicha. Todo lo de abajo lo ve TODO EL MUNDO cuando se
          toca: la hora que se cambia aquí es la hora de la carrera, no una
          preferencia de uno. Con la banda ámbar de cada sección, esta línea es
          lo que convierte diez plegables sueltos en un bloque. */}
      {event.canOrganize && (
        <div className="mt-5 flex items-center gap-2 border-t border-slate-800 pt-4">
          <Shield size={13} className="shrink-0 text-amber-600" />
          <h2 className="text-[11px] uppercase tracking-wider text-amber-600/90">Organización</h2>
          <span className="text-[10px] text-slate-600">
            {event.isOwner ? 'lo que tocas aquí lo ven todos' : 'te han nombrado organizador'}
          </span>
        </div>
      )}
      {/* ORGANIZACIÓN. Todo lo de aquí abajo se toca una vez, al montar la
          carrera, y luego se mira cero veces: plegado por defecto, con el
          estado en el encabezado para no tener que abrir para comprobar. Quien
          organiza también corre, y ese día lo que necesita es lo de arriba. */}
      {/* El NOMBRE, el primero de la organización: es lo que ve todo el mundo en
          la lista y en el enlace que circula, y hasta ahora solo se escribía al
          crear la carrera. Corregir una errata obligaba a rehacer el evento
          entero, con código de unión nuevo y todos apuntándose otra vez. */}
      {/* El ENLACE DE SEGUIMIENTO, para quien no corre: otra llave distinta de
          la de unirse —con esta se mira, no se entra— que se puede regenerar o
          quitar sin tocar el evento. Compartirlo lo hace cualquiera desde el
          botón de arriba; crearlo, cambiarlo o apagarlo enseña o esconde la
          carrera entera, y es de quien organiza: quien la creó y los
          organizadores que nombró. */}
      {event.canOrganize && (
        <Plegable
          orga
          title="Enlace de seguimiento"
          icon={<Share2 size={13} />}
          summary={event.publicToken ? 'activo' : 'sin crear'}
        >
          {event.publicToken ? (
            <>
              <code className="block break-all rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-300">
                {eventPublicLink(event.publicToken)}
              </code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => void copyPublic()} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/50">
                  {copiedPublic ? 'Copiado ✓' : 'Copiar enlace'}
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('Se crea un enlace nuevo y el actual deja de funcionar para quien lo tenga. ¿Seguro?')) void togglePublic(true)
                  }}
                  disabled={busy}
                  className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Generar otro
                </button>
                <button onClick={() => void togglePublic(false)} disabled={busy} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
                  Dejar de compartir
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Sin cuenta se ve el mapa con todos: nombre, color, kilómetro y margen sobre los cortes. No se comparten las balizas individuales de cada uno.
              </p>
            </>
          ) : (
            <>
              <button onClick={() => void togglePublic(true)} disabled={busy} className="rounded border border-sky-800 px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-950/40 disabled:opacity-50">
                Crear enlace de seguimiento
              </button>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Para que familia y amigos sigan la carrera sin cuenta. Con él, cada participante lo comparte desde el botón de arriba. Se puede quitar cuando quieras.
              </p>
            </>
          )}
        </Plegable>
      )}

      {/* Los PUNTOS DEL RECORRIDO: qué es cada uno (avituallamiento, bolsa de
          vida…) y cuánto se para, sin volver a publicar la ruta. Lo cambiado
          aquí manda sobre la ruta y lo usan el mapa y las previsiones. */}
      {event.canOrganize === true && event.planShareId && (
        <Plegable
          orga
          title="Puntos del recorrido"
          icon={<MapPin size={13} />}
          summary={resumenPuntos(event.puntosAjustes ?? null)}
        >
          <EditorPuntos
            onNecesitaRuta={pideRutaPuntos}
            ruta={baseRuta?.track ?? null}
            ajustes={event.puntosAjustes ?? null}
            busy={busy}
            onCambio={(c) => void cambiaElPunto(c)}
          />
        </Plegable>
      )}

      {event.canOrganize && (
        <Plegable orga title="Nombre de la carrera" summary={event.name}>
          <NombreEditor
            inicial={event.name}
            busy={busy}
            onGuardar={(t) => void guardarNombre(t)}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            Se cambia solo el nombre: el enlace, el código de unión y quien ya está apuntado siguen igual.
          </p>
        </Plegable>
      )}

      {/* El recorrido, para quien organiza. Estaba SOLO dentro de "Mi
          planificación", que es de quien corre: un organizador que no corre se
          quedaba sin manera de abrir la base para retocar un POI, que es la
          edición más normal de todas —la organización mueve el avituallamiento
          tres días antes—. El editor sigue siendo el planificador de siempre;
          lo que faltaba era la puerta. */}
      {event.canOrganize && (
        <Plegable
          orga
          title="Recorrido del evento"
          summary={event.planName ?? (event.planShareId ? 'puesto' : 'sin recorrido')}
        >
          {event.planShareId ? (
            <>
              <a
                href={`/?s=${encodeURIComponent(event.planShareId)}&de=${encodeURIComponent(id)}${
                  event.startsAt ? `&salida=${event.startsAt}` : ''
                }`}
                className="block rounded-lg border border-slate-700 py-2 text-center text-xs text-sky-400 transition-colors hover:bg-sky-950/40"
              >
                Abrir el recorrido para ajustarlo →
              </a>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Se abre en el planificador con el recorrido, los controles y los cierres. Mueve o añade puntos y
                pulsa «Actualizar el recorrido del evento» en la barra de arriba: se publica para todos.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">
              Este evento aún no tiene recorrido. Abre una ruta tuya y usa «Convertir en evento» para
              ponérselo.
            </p>
          )}
        </Plegable>
      )}

      {event.canOrganize && (
        <Plegable
          orga
          title="Salida oficial"
          summary={event.startsAt ? fmtDate(event.startsAt) : 'sin fijar'}
        >
          <CampoFechaHora
            valor={event.startsAt}
            onGuardar={guardarSalida}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            El día y la hora de la carrera. Es con lo que arranca quien planifica sobre este recorrido, así que
            si está mal, todos empiezan corrigiéndola a mano. Al poner el recorrido se rellena sola con la de la
            ruta de origen, si no habías puesto ninguna.
          </p>
          {event.startsAt && (
            <button
              onClick={() => void guardarSalida('')}
              disabled={busy}
              className="mt-1.5 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
            >
              Quitar la hora de salida
            </button>
          )}
        </Plegable>
      )}

      {/* De qué va la carrera. Manda en cómo se leen las trazas: el umbral que
          descarta un salto de GPS no puede ser el mismo andando que en bici,
          donde 12 km/h es ir de paseo. Sale sola del recorrido publicado; esto
          es para corregirla. */}
      {event.canOrganize && (
        <Plegable
          orga
          title="Tipo de actividad"
          summary={event.activity ? ACTIVIDADES[event.activity] ?? event.activity : 'sin definir'}
        >
          <div className="flex flex-wrap gap-1.5">
            {(['walk', 'run', 'bike'] as const).map((a) => (
              <button
                key={a}
                onClick={() => void cambiaActividad(a)}
                disabled={busy}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                  event.activity === a
                    ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {ACTIVIDADES[a]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Con ella se descartan los saltos del GPS al calcular los resultados: lo que es imposible
            caminando —12 km/h— en bici es ir de paseo. Si la carrera ya está cerrada, cambiarla
            recalcula los resultados.
          </p>
        </Plegable>
      )}

      {/* Terminar la carrera. Va con los ajustes del evento y no escondido en un
          menú: es la acción que cierra la historia —congela los resultados y
          deja de admitir gente— y hasta ahora sencillamente no existía. */}
      {/* Los TIEMPOS OFICIALES de meta: los del cronometraje de la
          organización, al segundo. Mandan sobre la baliza y el paso manual, y
          son lo que deshace una llegada pegada que el GPS no sabe ordenar. Se
          abre sola cuando hay alguno así esperando. */}
      {event.canOrganize && (
        <Plegable
          orga
          title="Tiempos oficiales de meta"
          icon={<Timer size={13} />}
          summary={resumenOficiales(data.members, event.stats ?? null)}
          defaultOpen={pendientesDe(event.stats ?? null).size > 0}
        >
          <TiemposOficiales
            miembros={data.members}
            stats={event.stats ?? null}
            salidaMs={event.startsAt}
            busy={busy}
            onGuardar={(u, at) => void guardaOficial(u, at)}
          />
        </Plegable>
      )}

      {event.canOrganize && (
        <Plegable
          orga
          title="🏁 Terminar la carrera"
          summary={event.endedAt ? `terminada ${fmtDate(event.endedAt)}` : event.endsAt ? `cierra ${fmtDate(event.endsAt)}` : 'en marcha'}
        >
          {event.endedAt ? (
            <>
              <p className="text-[11px] text-slate-400">
                Terminada el {fmtDate(event.endedAt)}. Los resultados y la porra están congelados, y el
                evento se guarda al cerrar: el replay de todos, el recorrido y la foto se quedan aunque
                caduquen las balizas.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {event.archivedAt ? `Guardado el ${fmtDate(event.archivedAt)}.` : 'Todavía sin guardar.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {/* Guardar a mano: tras corregir algo, o un evento cerrado antes de
                    que existiera el archivo. Ver functions/lib/archivo.ts. */}
                <button
                  onClick={() => void guardar()}
                  disabled={busy}
                  className="rounded border border-sky-800 px-2 py-1 text-[11px] text-sky-300 hover:text-sky-200 disabled:opacity-50"
                >
                  {event.archivedAt ? 'Volver a guardar' : 'Guardar evento'}
                </button>
                <button
                  onClick={() => void recalcular()}
                  disabled={busy}
                  className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-sky-400 disabled:opacity-50"
                >
                  Recalcular resultados
                </button>
                <button
                  onClick={() => void terminaCarrera(false)}
                  disabled={busy}
                  className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-sky-400 disabled:opacity-50"
                >
                  Reabrirla
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-600">
                Los resultados se congelan al cerrar; recalcúlalos si el cálculo ha mejorado desde entonces.
              </p>
              <p className="mt-1 text-[10px] text-slate-600">
                Al reabrir se tiran los resultados: con gente aún en carrera dirían que ganó quien iba primero.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-400">
                {event.endsAt
                  ? <>Se cierra sola el {fmtDate(event.endsAt)}. Puedes adelantarlo o cambiar la hora.</>
                  : <>Esta carrera no tiene hora de cierre, así que solo termina cuando lo digas tú. La pone
                     sola el recorrido al publicarlo —es su último corte— o la escribes aquí.</>}
              </p>
              {/* La forma en que se anuncia una carrera: "sale a las 8:00 y
                  tienes 8 horas". Con la salida publicada, la hora de cierre es
                  una resta y no hay por qué pedirle a nadie que la calcule. */}
              <label className="mt-2 block text-[11px] text-slate-500">
                Límite de tiempo (horas)
                <input
                  type="number" inputMode="decimal" min={0} step={0.5}
                  defaultValue={event.limitMin != null ? String(Math.round((event.limitMin / 60) * 100) / 100) : ''}
                  onBlur={(e) => void guardarLimite(e.target.value)}
                  disabled={busy || !event.startsAt}
                  placeholder={event.startsAt ? 'p. ej. 8' : 'pon antes la salida oficial'}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-600 focus:outline-none disabled:opacity-50"
                />
              </label>
              {!event.startsAt && (
                <p className="mt-1 text-[10px] text-amber-500/80">
                  El límite se cuenta desde la salida, así que primero hay que fijarla arriba.
                </p>
              )}
              <label className="mt-2 block text-[11px] text-slate-500">
                Cierre de meta
                <CampoFechaHora
                  valor={event.endsAt ?? null}
                  onGuardar={guardarCierre}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-600 focus:outline-none"
                />
              </label>
              {event.endsAt && (
                <button
                  onClick={() => void guardarCierre('')}
                  disabled={busy}
                  className="mt-1 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
                >
                  Quitar la hora de cierre
                </button>
              )}
              <button
                onClick={() => void terminaCarrera(true)}
                disabled={busy}
                className="mt-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:border-amber-600 disabled:opacity-50"
              >
                🏁 Darla por terminada ahora
              </button>
            </>
          )}
        </Plegable>
      )}

      {/* Los resultados, para todos: es lo que queda de la carrera. */}
      {event.endedAt && event.stats && event.stats.corredores.length > 0 && (
        <Plegable
          title="🏆 Resultados"
          defaultOpen
          summary={`${event.stats.finishers} de ${event.stats.runners}`}
        >
          <RecordDeKm stats={event.stats} />
          <ListaResultados stats={event.stats} salidaMs={event.startsAt} />
        </Plegable>
      )}

      {/* La porra vive con los ajustes del EVENTO y no dentro de "Mi marca":
          quien organiza puede no correr, y allí ni siquiera veía la casilla.
          Es cosa de la carrera, como la salida o la foto. */}
      {event.canOrganize && (
        <Plegable
          orga
          title="🔮 La porra"
          summary={event.betsEnabled ? 'abierta' : 'apagada'}
        >
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={event.betsEnabled}
              onChange={(e) => void togglePorra(e.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-amber-500"
            />
            <span>
              Abrir la porra en esta carrera
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Quien MIRA la carrera pronostica quién gana, quién acaba y a qué hora — hasta la salida y
                nada más. No se juega dinero: sale un ranking de aciertos, con corona para el primero.
                Los que corréis no jugáis, que decidís el resultado con las piernas.
              </span>
            </span>
          </label>
          {!event.startsAt && (
            <p className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-300">
              Falta la hora de salida: es lo que cierra la porra, y sin ella no se admiten pronósticos.
              Ponla arriba, en «Salida oficial».
            </p>
          )}
          {event.betsEnabled && (
            <p className="mt-2 text-[11px] text-slate-500">
              Está abierta: sale como pestaña «🔮 Porra» en el mapa del evento y en el enlace público.
              Apagarla no borra nada — los pronósticos vuelven si la reabres.
            </p>
          )}
        </Plegable>
      )}

      {event.canOrganize && !(event.hasPhoto && !event.isOwner) && (
        <Plegable orga title="Foto" summary={event.hasPhoto ? 'puesta' : 'sin foto'}>
          <label className="inline-block px-2.5 py-1 rounded border border-slate-700 text-xs text-sky-400 hover:bg-sky-950/50 cursor-pointer">
            {event.hasPhoto ? 'Cambiar foto' : 'Subir foto'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropping(f) }}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Podrás encuadrarla: lo que dejes en el marco es lo que verán todos, aquí y en la lista.
          </p>
        </Plegable>
      )}



      <div className="mt-6 flex gap-2">
        <a href="/" className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800">← Inicio</a>
        {event.isOwner && me && (
          <button onClick={() => void leave()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            No corro esta carrera
          </button>
        )}
        {event.isOwner ? (
          <button onClick={() => void destroy()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
            Borrar evento
          </button>
        ) : (
          <button onClick={() => void leave()} disabled={busy} className="px-3 py-1.5 rounded border border-slate-700 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50">
            Salir del evento
          </button>
        )}
      </div>

      {cropping && (
        <PhotoCropper
          file={cropping}
          aspect={EVENT_PHOTO_ASPECT}
          title="Encuadrar la foto del evento"
          onCancel={() => setCropping(null)}
          onDone={(jpeg) => void uploadPhoto(jpeg)}
        />
      )}

      {/* La frase de quien se haya pulsado, encima de todo. */}
      {(() => {
        const m = members.find((x) => x.userId === bocadilloDe)
        if (!m) return null
        return (
          <BocadilloPopup
            m={m}
            isMe={m.userId === user.id}
            busy={busy}
            onGuardar={(v) => void guardaBocadillo(v)}
            onClose={() => setBocadilloDe(null)}
          />
        )
      })()}

      {/* El dorsal en grande. Se abre con lo que ya hay en pantalla y el perfil
          entra cuando llega: esperar a bajarse el recorrido para enseñar un
          número que ya sabemos sería hacer esperar por nada. */}
      {(() => {
        const m = members.find((x) => x.userId === dorsal)
        if (!m?.bib) return null
        return (
          <DorsalGrande
            bib={m.bib}
            username={m.username}
            emoji={m.emoji}
            color={m.color}
            carrera={carrera ?? {
              nombre: event.name,
              km: event.planTotalKm ?? null,
              desnivelM: null,
              salida: event.startsAt,
              cierre: event.endsAt ?? null,
              perfil: [],
              puntos: [],
            }}
            porra={porras.get(m.username) ?? null}
            onEditar={m.userId === user.id || event.isOwner
              ? () => { setDorsal(null); void pedirDorsal(m.userId, m.bib ?? '') }
              : undefined}
            onClose={() => setDorsal(null)}
          />
        )
      })()}
    </Shell>
  )
}

/**
 * El tablón, en edición. Con borrador propio y guardado explícito: no es un
 * campo que se autoguarde mientras se teclea —lo van a leer treinta personas y
 * media frase a medio escribir no es lo que se quiere publicar—.
 */
/**
 * El nombre de la carrera, en una línea. Sin botón de quitar —a diferencia del
 * tablón— porque una carrera sin nombre no existe: el servidor lo rechaza y
 * aquí ni se ofrece.
 */
function NombreEditor({ inicial, busy, onGuardar }: {
  inicial: string
  busy: boolean
  onGuardar: (texto: string) => void
}) {
  const [texto, setTexto] = useState(inicial)
  // Si lo renombra otro organizador mientras esto está abierto, el campo se
  // pone al día en vez de quedarse enseñando el nombre viejo como si fuera lo
  // que hay guardado.
  useEffect(() => { setTexto(inicial) }, [inicial])
  const limpio = texto.trim()
  const sinCambios = limpio === inicial
  return (
    <div className="flex items-center gap-2">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && limpio && !sinCambios && !busy) onGuardar(texto) }}
        maxLength={EVENT_NAME_MAX}
        placeholder="Cómo se llama la carrera"
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
      />
      <button
        onClick={() => onGuardar(texto)}
        disabled={busy || !limpio || sinCambios}
        className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        Guardar
      </button>
    </div>
  )
}

function NotasEditor({ inicial, busy, onGuardar, onCancelar }: {
  inicial: string
  busy: boolean
  onGuardar: (texto: string) => void
  onCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const pasado = texto.length > EVENT_NOTES_MAX
  return (
    <div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={6}
        autoFocus
        placeholder={'Dónde está la bolsa de vida, a qué hora sale el autobús, qué hay en cada avituallamiento…'}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => onGuardar(texto)}
          disabled={busy || pasado}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          onClick={onCancelar}
          disabled={busy}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Cancelar
        </button>
        {texto.trim() && (
          <button
            onClick={() => onGuardar('')}
            disabled={busy}
            className="ml-auto text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
          >
            Quitar las notas
          </button>
        )}
      </div>
      {pasado && (
        <p className="mt-1 text-[11px] text-red-400">
          Te has pasado por {texto.length - EVENT_NOTES_MAX} caracteres del máximo ({EVENT_NOTES_MAX}).
        </p>
      )}
    </div>
  )
}

/**
 * La frase de uno, en una ventana encima de todo.
 *
 * La propia se escribe aquí —con el contador a la vista— y la de los demás
 * solo se lee. Encima y no dentro de la fila porque la fila es estrecha y ya
 * va llena: la frase metida ahí salía en una columna de una palabra por línea.
 */
function BocadilloPopup({ m, isMe, busy, onGuardar, onClose }: {
  m: EventMember
  isMe: boolean
  busy: boolean
  onGuardar: (valor: string) => void
  onClose: () => void
}) {
  const [texto, setTexto] = useState(m.bocadillo ?? '')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="shrink-0 text-sky-400" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">
              {m.emoji ?? ''} {m.username}{isMe && <span className="text-slate-500"> · tú</span>}
            </span>
            <button onClick={onClose} aria-label="Cerrar" className="shrink-0 text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          {isMe ? (
            <>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, BOCADILLO_MAX))}
                rows={3}
                autoFocus
                placeholder="Una frase para la parrilla"
                className="mt-3 w-full resize-none rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-700"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{texto.length}/{BOCADILLO_MAX}</span>
                <div className="flex items-center gap-2">
                  {m.bocadillo && (
                    <button
                      onClick={() => onGuardar('')}
                      disabled={busy}
                      className="rounded-lg px-2.5 py-1.5 text-[12px] text-slate-400 transition-colors hover:text-rose-300 disabled:opacity-40"
                    >
                      Quitarla
                    </button>
                  )}
                  <button
                    onClick={() => onGuardar(texto)}
                    disabled={busy || texto.trim() === (m.bocadillo ?? '')}
                    className="rounded-lg border border-sky-700 bg-sky-950/40 px-3 py-1.5 text-[12px] font-semibold text-sky-300 transition-colors hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                  >
                    Guardar
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                La leen los demás en la parrilla y va saliendo sobre el cartel.
              </p>
            </>
          ) : (
            <p className="mt-3 text-[15px] leading-relaxed text-slate-100">{m.bocadillo}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function MemberRow({
  m, now, isMe, eventId, canEditBib, onBib, onDorsal,
  onBocadillo, pensando,
  canEditMark, editing, onToggleMark, takenEmojis, takenColors, busy, onPickEmoji, onPickColor,
  canExpel, confirmingExpel, onAskExpel, onExpel, canName, onOrganizer,
  canRetire, onRetire, ajustando, onAjustar, puntos, onPunto,
  canManual, manualAbierto, onToggleManual, onManual, salidaMs, totalKm, igualar,
}: {
  m: EventMember
  now: number
  isMe: boolean
  eventId: string
  /** El propio siempre; los de los demás, solo el organizador. */
  canEditBib: boolean
  onBib: (userId: string, bib: string) => void
  /** Sacar su dorsal en grande. */
  onDorsal: () => void
  /** Abrir su frase en una ventana aparte: la propia se escribe ahí, la de los
   *  demás solo se lee. */
  onBocadillo: () => void
  /** Si AHORA le toca a él asomar su frase en el globito del nombre. El turno
   *  lo reparte la parrilla, que es quien ve a todos: uno cada vez. */
  pensando: boolean
  canEditMark: boolean
  editing: boolean
  onToggleMark: () => void
  takenEmojis: readonly string[]
  takenColors: readonly string[]
  busy: boolean
  onPickEmoji: (emoji: string) => void
  onPickColor: (slug: string) => void
  /** Sacarle de la parrilla: quien organiza y quien administra. */
  canExpel: boolean
  confirmingExpel: boolean
  onAskExpel: () => void
  onExpel: () => void
  /** Nombrarle organizador: solo el dueño del evento y quien administra. */
  canName: boolean
  onOrganizer: (organizer: boolean) => void
  /** Marcar su abandono: quien organiza, de cualquiera; cualquiera, de sí mismo. */
  canRetire: boolean
  onRetire: (retirado: boolean) => void
  /** Si está abierto el selector de "¿dónde lo dejó?". */
  ajustando: boolean
  onAjustar: () => void
  /** Los puntos de paso del recorrido, para señalar uno. */
  puntos: { nombre: string; km: number }[]
  onPunto: (km: number) => void
  /** Modo manual (ver `cambiaManual`): quien organiza. */
  canManual: boolean
  manualAbierto: boolean
  onToggleManual: () => void
  onManual: (cambio: { modo: boolean } | { km: number; at: number | null; con?: string }) => void
  /** "Va con…": igualar sus pasos con alguien que lleva baliza. */
  igualar?: Igualar
  /** La salida, para convertir "07:21" en una hora del día de la carrera. */
  salidaMs: number | null
  totalKm: number | null
}) {
  const live = m.sessionId !== null
  const online = m.lastSeen !== null && now - m.lastSeen < EVENT_PRESENCE_MS
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
    <div className="flex items-center gap-2.5">
      {canEditMark ? (
        <button onClick={onToggleMark} title="Cambiar su marca" className="shrink-0">
          <MarkBadge emoji={m.emoji} color={m.color} size={24} selected={editing} />
        </button>
      ) : (
        <MarkBadge emoji={m.emoji} color={m.color} size={24} />
      )}
      {/* El dorsal, delante del nombre: ese día es el nombre. Pulsarlo lo
          saca en grande —el impreso entero, con el perfil y los cortes—, y
          desde ahí se cambia quien pueda; poner el primero sigue siendo un
          botón aparte, porque de un dorsal que no existe no hay nada que ver. */}
      {m.bib ? (
        <Dorsal bib={m.bib} size="md" onClick={onDorsal} title={`Ver el dorsal de ${m.username}`} />
      ) : canEditBib ? (
        <button
          onClick={() => onBib(m.userId, '')}
          title="Poner dorsal"
          className="shrink-0 rounded border border-dashed border-slate-700 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-500 transition-colors hover:text-sky-400"
        >
          + dorsal
        </button>
      ) : null}
      {/* El nombre, con su globo colgando. El envoltorio ancla y no recorta —un
          `truncate` aquí se comería el globo— y es `group` para que la frase
          salga también al pasar el ratón, sin esperar a que le toque turno. */}
      <span className="group relative min-w-0">
        {m.bocadillo && <MiniBocadillo texto={m.bocadillo} visible={pensando} />}
        <span className="block truncate text-sm text-slate-200">
          {m.username}{isMe && <span className="text-slate-500"> · tú</span>}
        </span>
      </span>
      {/* Su frase, colgada del nombre. En la fila solo va la burbuja —que ya
          dice que hay algo—; el texto se abre en una VENTANA encima, no
          desplegado aquí: la fila es estrecha y de sobra ocupada, y una frase
          metida dentro salía en columna de una palabra por línea. Se abre al
          pulsar y no al pasar el ratón, que en el móvil no existe. */}
      {(m.bocadillo || isMe) && (
        <button
          onClick={onBocadillo}
          title={m.bocadillo
            ? (isMe ? 'Tu frase · pulsa para verla o cambiarla' : `Lo que dice ${m.username}`)
            : 'Escribir tu frase'}
          aria-label={m.bocadillo ? `Ver lo que dice ${m.username}` : 'Escribir tu frase'}
          className={`shrink-0 transition-colors hover:text-sky-400 ${m.bocadillo ? 'text-slate-500' : 'text-slate-700'}`}
        >
          <MessageSquare size={14} />
        </button>
      )}
      {/* Quién manda aquí, dicho en su fila. Sin esto, "organizador" es un
          permiso invisible: nadie sabe a quién preguntarle por el enlace. */}
      {m.isOwner && (
        <span className="shrink-0 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300/90">organiza</span>
      )}
      {!m.isOwner && m.isOrganizer && (
        <span className="flex shrink-0 items-center gap-1 rounded bg-sky-950/60 px-1.5 py-0.5 text-[10px] text-sky-300">
          <Shield size={10} /> organizador
        </span>
      )}
      {canName && (
        <button
          onClick={() => onOrganizer(!m.isOrganizer)}
          disabled={busy}
          title={m.isOrganizer
            ? `Quitar a ${m.username} de organizador`
            : `Nombrar a ${m.username} organizador: podrá invitar y escribir el tablón`}
          className={`shrink-0 px-1 transition-colors disabled:opacity-40 ${
            m.isOrganizer ? 'text-sky-400 hover:text-slate-500' : 'text-slate-600 hover:text-sky-400'
          }`}
        >
          <Shield size={13} />
        </button>
      )}
      {m.hasPlan && <span className="text-[10px] text-slate-500 shrink-0">plan propio</span>}
      <span className="ml-auto shrink-0 text-[11px]">
        {/* Retirado manda sobre todo lo demás: quien se ha bajado no está
            "emitiendo" aunque su móvil siga hablando desde el coche. */}
        {m.retiredAt !== null ? (
          <button
            onClick={onAjustar}
            disabled={!canRetire}
            title="Señalar dónde lo dejó"
            className="text-rose-400 transition-colors hover:text-rose-300 disabled:cursor-default disabled:hover:text-rose-400"
          >
            ⊘ se retiró
            {m.retiredKm != null && <span className="text-slate-400"> · km {m.retiredKm.toFixed(1)}</span>}
          </button>
        ) : m.sinCuenta ? (
          <span className="text-sky-300" title="Dado de alta sin baliza: se le sigue con sus pasos por los controles">✎ sin baliza</span>
        ) : m.manualPasos ? (
          <span className="text-sky-300">✎ manual</span>
        ) : live && m.sessionUpdatedAt != null && now - m.sessionUpdatedAt > SIN_SENAL_MS ? (
          // Sesión abierta no es emitir: la de Valen siguió abierta horas
          // después de quedarse el móvil sin batería, y aquí decía "emitiendo".
          <span className="text-amber-400" title="Su baliza sigue abierta, pero no llega nada">
            📡 sin señal · hace {haceTexto(now - m.sessionUpdatedAt)}
          </span>
        ) : live ? (
          <span className="text-emerald-400">● emitiendo</span>
        ) : online ? (
          <span className="text-slate-400">en la parrilla</span>
        ) : (
          <span className="text-slate-600">desconectado</span>
        )}
      </span>
      {/* Marcar el abandono. Lo que la traza no puede saber —una llamada, una
          furgoneta— lo sabe quien organiza, y esto es su vía. Se deshace igual
          de fácil: alguien se marca por error y tiene que poder volver a la
          carrera sin dejar rastro. */}
      {/* ¿Dónde lo dejó? Señalar un punto del recorrido en vez de teclear un
          kilómetro: el sitio se recuerda y el número no. De ahí salen el
          kilómetro y —mirando su traza— la hora. */}
      {canManual && (
        <button
          onClick={onToggleManual}
          title={`Modo manual de ${m.username}: anotar sus pasos por los controles`}
          aria-label="Modo manual"
          aria-expanded={manualAbierto}
          className={`shrink-0 px-1 transition-colors ${m.manualPasos ? 'text-sky-300' : 'text-slate-600 hover:text-sky-400'}`}
        >
          <PenLine size={13} />
        </button>
      )}
      {canRetire && (
        <button
          onClick={() => onRetire(m.retiredAt === null)}
          disabled={busy}
          title={m.retiredAt !== null
            ? `Devolver a ${m.username} a la carrera`
            : `Dar a ${m.username} por retirado`}
          aria-label={m.retiredAt !== null ? 'Devolver a la carrera' : 'Dar por retirado'}
          className={`shrink-0 px-1 transition-colors disabled:opacity-40 ${
            m.retiredAt !== null ? 'text-rose-400 hover:text-emerald-400' : 'text-slate-600 hover:text-rose-400'
          }`}
        >
          ⊘
        </button>
      )}
      {/* La baliza completa de cada uno sigue siendo su visor de siempre: ahí
          están su traza entera, sus notas y sus ánimos. */}
      {live && (
        // Con el evento a cuestas, para poder volver desde la baliza.
        <a href={`/?t=${encodeURIComponent(m.sessionId!)}&e=${encodeURIComponent(eventId)}`} className="shrink-0 text-[11px] text-sky-400 hover:text-sky-300">ver</a>
      )}
      {/* Sacar de la parrilla. Una equis discreta y en gris: es de las cosas
          que menos se hacen y no puede competir por la mirada con el estado de
          cada uno, que es a lo que se viene. */}
      {canExpel && !confirmingExpel && (
        <button
          onClick={onAskExpel}
          title={`Sacar a ${m.username} de la parrilla`}
          aria-label={`Sacar a ${m.username} de la parrilla`}
          className="shrink-0 px-1 text-slate-600 transition-colors hover:text-red-400"
        >
          <X size={13} />
        </button>
      )}
    </div>

    {/* La confirmación, en su propia fila y contando lo que se lleva por
        delante. Un `confirm()` del navegador taparía la lista justo cuando hace
        falta ver a quién se está sacando, y "¿seguro?" a secas no dice que
        también se van sus pronósticos. */}
    {/* Los paneles, DEBAJO de la fila y a todo el ancho: dentro de la fila
        competían por el sitio con los botones y el texto salía en columna. */}
    {ajustando && (
      <div className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2">
        <p className="text-[11px] text-slate-400">
          ¿Dónde dejó la carrera {m.username}?
        </p>
        {puntos.length === 0 ? (
          <p className="mt-1 text-[11px] text-slate-600">
            Esta carrera no tiene puntos de paso en el recorrido.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {puntos.map((p) => (
              <button
                key={`${p.nombre}-${p.km}`}
                onClick={() => onPunto(p.km)}
                disabled={busy}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
                  m.retiredKm != null && Math.abs(m.retiredKm - p.km) < 0.05
                    ? 'border-rose-500 bg-rose-500/15 text-rose-200'
                    : 'border-slate-700 text-slate-300 hover:border-rose-500 hover:text-rose-300'
                }`}
              >
                {p.nombre} <span className="text-slate-500">km {p.km.toFixed(1)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )}
    {manualAbierto && (
      <PanelManual
        m={m} busy={busy} puntos={puntos} salidaMs={salidaMs} totalKm={totalKm} onManual={onManual} igualar={igualar}
      />
    )}
    {confirmingExpel && (
      <div className="mt-2 border-t border-slate-800 pt-2 text-[11px]">
        <p className="text-slate-400">
          ¿Sacar a <b className="text-slate-200">{m.username}</b> de la parrilla? Se van
          su sitio en la carrera y sus pronósticos de la porra.{' '}
          <span className="text-slate-500">Su baliza no se toca: sigue siendo suya y abierta por su enlace.</span>
        </p>
        <div className="mt-1.5 flex gap-2">
          <button
            onClick={onExpel}
            disabled={busy}
            className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-red-300 hover:bg-red-950/70 disabled:opacity-50"
          >
            Sacar
          </button>
          <button onClick={onAskExpel} className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:text-slate-200">
            Cancelar
          </button>
        </div>
      </div>
    )}

    {/* La marca de otro, desplegada bajo su fila: se ve a quién se le está
        cambiando mientras se cambia, que con treinta filas iguales no es poca
        cosa. */}
    {editing && canEditMark && (
      <div className="mt-2 border-t border-slate-800 pt-2">
        <h4 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Emoji de {m.username}</h4>
        <EmojiField value={m.emoji} taken={takenEmojis} busy={busy} onPick={onPickEmoji} />
        <h4 className="mt-2.5 text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Su color</h4>
        <ColorPalette value={m.color} taken={takenColors} busy={busy} onPick={onPickColor} />
      </div>
    )}
    </li>
  )
}

/** La página de la parrilla. Con la barra del evento, esta va arriba de lado a lado y el contenido debajo. */
function Shell({ children, barra = null }: { children: React.ReactNode; barra?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      {barra}
      <div className={`mx-auto max-w-lg px-4 ${barra ? 'pb-6 pt-4' : 'py-6'}`}>{children}</div>
    </div>
  )
}

/**
 * Un día y una hora que se guardan solos.
 *
 * Escribir una fecha son varios pasos —día, mes, año, hora, minuto— y hasta el
 * último el campo NO vale: `datetime-local` devuelve cadena vacía mientras
 * falte algo. Atado directamente al servidor eso hacía tres cosas mal a la vez:
 * cada paso guardaba una fecha a medias (y la vacía BORRABA la salida), el
 * campo se deshabilitaba mientras guardaba —y deshabilitar un campo cierra el
 * calendario del móvil y te echa fuera— y, para rematar, la parrilla se
 * refresca cada pocos segundos y te reescribía encima lo que estabas
 * escribiendo.
 *
 * Aquí lo que se teclea vive en local hasta que está completo. Se guarda al
 * salir del campo, y también sola tras un momento sin tocarlo —hay quien
 * termina de escribir y cierra la sección sin salir del campo, y esa fecha no
 * se puede perder—. Vacío no guarda nunca: para quitar la hora está su botón,
 * que es una decisión y no un descuido a medio escribir.
 */
function CampoFechaHora({ valor, onGuardar, className }: {
  valor: number | null
  onGuardar: (texto: string) => void | Promise<void>
  className: string
}) {
  const [borrador, setBorrador] = useState<string | null>(null)
  const reloj = useRef<number | undefined>(undefined)
  const delServidor = valor ? paraInput(valor) : ''

  useEffect(() => () => window.clearTimeout(reloj.current), [])

  const guarda = (texto: string) => {
    window.clearTimeout(reloj.current)
    if (!texto || !Number.isFinite(new Date(texto).getTime())) return
    if (texto === delServidor) return
    void onGuardar(texto)
  }

  return (
    <input
      type="datetime-local"
      value={borrador ?? delServidor}
      onChange={(e) => {
        const texto = e.target.value
        setBorrador(texto)
        // Con calma: mientras se teclea el año, "2026" pasa por 0002 y 0202, y
        // cada uno de esos es una fecha completa y válida que no hay que
        // guardar. Medio segundo de silencio es que ya ha terminado.
        window.clearTimeout(reloj.current)
        reloj.current = window.setTimeout(() => guarda(texto), 600)
      }}
      onBlur={(e) => { guarda(e.target.value); setBorrador(null) }}
      className={className}
    />
  )
}

/** `datetime-local` quiere hora LOCAL sin zona ("2026-09-05T08:30"). */
function paraInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * El trazado en lo justo para medir avance: [lat, lon, km] remuestreado.
 *
 * Un recorrido trae miles de puntos y con ochocientos sobra para proyectar
 * posiciones —entre dos puntos consecutivos quedan unos metros—, así que se
 * manda remuestreado. Lo hace el navegador porque es quien entiende el formato
 * del recorrido; al servidor le llegan solo coordenadas.
 */

/** Cómo se llama cada actividad, con su icono. */
const ACTIVIDADES: Record<string, string> = {
  walk: '🚶 Caminata',
  run: '🏃 Carrera',
  bike: '🚴 Bicicleta',
}

/** Un ritmo o un tiempo de kilómetro: "4:35". */
function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

/**
 * El panel del modo manual de un corredor.
 *
 * Para cuando su baliza no sirve —se quedó sin batería, no la llevaba—: quien
 * organiza copia sus pasos del cronometraje oficial ("Pujalt 07:21") y con
 * ellos se le sigue en el mapa, cuenta en la clasificación y en la porra. Un
 * control por fila con su hora; la meta al final aunque el recorrido no la
 * tenga como punto.
 */
function PanelManual({ m, busy, puntos, salidaMs, totalKm, onManual, igualar }: {
  m: EventMember
  busy: boolean
  puntos: { nombre: string; km: number }[]
  salidaMs: number | null
  totalKm: number | null
  onManual: (cambio: { modo: boolean } | { km: number; at: number | null; con?: string }) => void
  igualar?: Igualar
}) {
  const pasos = m.manualPasos ?? null
  const filas = [...puntos]
  if (totalKm != null && !filas.some((p) => Math.abs(p.km - totalKm) < 0.2)) filas.push({ nombre: 'Meta', km: totalKm })
  // Los pasos anotados en un km que no es un punto del recorrido: el
  // cronometraje de la organización tiene más controles que los cortes del
  // GPX. Salen en la lista, en su sitio por km, para corregirlos o borrarlos.
  for (const [km, , con] of pasos ?? []) {
    // Lo igualado con otro lo dice ("con Soriano"); lo demás es un control
    // del cronometraje que el GPX no trae.
    if (!filas.some((p) => Math.abs(p.km - km) < 0.05)) filas.push({ nombre: con ?? 'Control', km })
  }
  filas.sort((a, b) => a.km - b.km)
  const [horas, setHoras] = useState<Record<string, string>>({})
  /** El control libre: cualquier kilómetro con su hora. */
  const [kmLibre, setKmLibre] = useState('')
  const [horaLibre, setHoraLibre] = useState('')
  const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  /** "07:21" → epoch ms del día de la carrera; si cae antes de la salida, del día siguiente. */
  const aEpoch = (hhmm: string): number | null => {
    const mm = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
    if (!mm) return null
    const d = new Date(salidaMs ?? Date.now())
    d.setHours(Number(mm[1]), Number(mm[2]), 0, 0)
    let t = d.getTime()
    if (salidaMs != null && t < salidaMs) t += 24 * 3600_000
    return t
  }
  return (
    <div className="mt-1.5 w-full rounded-lg border border-sky-900/60 bg-slate-950/60 p-2">
      {pasos === null ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400">
            Si su baliza no funciona, pásalo a modo manual y anota sus pasos por los controles.
          </p>
          <button
            onClick={() => onManual({ modo: true })}
            disabled={busy}
            className="shrink-0 rounded-md bg-sky-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            Pasar a manual
          </button>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-slate-400">
            Modo manual: mandan estos pasos, no su baliza. Copia las horas del cronometraje oficial.
          </p>
          <div className="mt-1.5 space-y-1">
            {filas.map((p) => {
              const clave = p.km.toFixed(2)
              const anotado = pasos.find(([k]) => Math.abs(k - p.km) < 0.05) ?? null
              const valor = horas[clave] ?? (anotado ? hora(anotado[1]) : '')
              const at = aEpoch(valor)
              const cambiado = at != null && (!anotado || Math.abs(anotado[1] - at) >= 60_000)
              return (
                <div key={clave} className="flex items-center gap-2 text-[11px]">
                  <span className={`min-w-0 flex-1 truncate ${anotado ? 'text-slate-200' : 'text-slate-400'}`}>
                    {p.nombre} <span className="text-slate-500">km {p.km.toFixed(1)}</span>
                  </span>
                  <input
                    type="time"
                    value={valor}
                    onChange={(e) => setHoras((h) => ({ ...h, [clave]: e.target.value }))}
                    className="w-[5.5rem] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200"
                    aria-label={`Hora de paso por ${p.nombre}`}
                  />
                  <button
                    onClick={() => at != null && onManual({ km: p.km, at })}
                    disabled={busy || !cambiado}
                    title="Guardar este paso"
                    aria-label={`Guardar el paso por ${p.nombre}`}
                    className="shrink-0 text-emerald-400 disabled:opacity-20"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => { setHoras((h) => ({ ...h, [clave]: '' })); onManual({ km: p.km, at: null }) }}
                    disabled={busy || !anotado}
                    title="Borrar este paso"
                    aria-label={`Borrar el paso por ${p.nombre}`}
                    className="shrink-0 text-slate-500 hover:text-rose-400 disabled:opacity-20"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
          {(() => {
            const km = Number(kmLibre.replace(',', '.'))
            const kmOk = kmLibre.trim() !== '' && Number.isFinite(km) && km > 0 && (totalKm == null || km <= totalKm + 0.5)
            const at = aEpoch(horaLibre)
            return (
              <div className="mt-2 flex items-center gap-2 border-t border-slate-800 pt-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-slate-400">Otro punto · km</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={kmLibre}
                  onChange={(e) => setKmLibre(e.target.value)}
                  placeholder="15,2"
                  className="w-14 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-right tabular-nums text-slate-200"
                  aria-label="Kilómetro del control"
                />
                <input
                  type="time"
                  value={horaLibre}
                  onChange={(e) => setHoraLibre(e.target.value)}
                  className="w-[5.5rem] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200"
                  aria-label="Hora de paso por ese control"
                />
                <button
                  onClick={() => {
                    if (!kmOk || at == null) return
                    onManual({ km, at })
                    setKmLibre(''); setHoraLibre('')
                  }}
                  disabled={busy || !kmOk || at == null}
                  title="Guardar este paso"
                  aria-label="Guardar el paso por ese kilómetro"
                  className="shrink-0 text-emerald-400 disabled:opacity-20"
                >
                  <Check size={14} />
                </button>
                <span className="w-[13px] shrink-0" aria-hidden="true" />
              </div>
            )
          })()}
          {igualar && igualar.con.length > 0 && (
            <VaCon m={m} igualar={igualar} busy={busy} hora={hora} onAnotar={(km, at, con) => onManual({ km, at, con })} />
          )}
          <button
            onClick={() => onManual({ modo: false })}
            disabled={busy}
            className="mt-2 text-[11px] text-slate-400 underline hover:text-sky-300 disabled:opacity-40"
          >
            Volver a su baliza (borra los pasos anotados)
          </button>
        </>
      )}
    </div>
  )
}

/** Los que llegaron pegados sin hora oficial (ver `pendientesDeOficial`). */
function pendientesDe(stats: EventStats | null): Set<string> {
  if (!stats) return new Set()
  return pendientesDeOficial(stats.corredores.map((c) => ({
    username: c.username, tracked: c.tracked, finished: c.finished, finishedAt: c.finishedAt,
    settled: true, margenMs: c.margenMs, oficial: c.oficial ?? false,
  })))
}

function resumenOficiales(miembros: EventMember[], stats: EventStats | null): string {
  const pendientes = pendientesDe(stats).size
  if (pendientes > 0) return `${pendientes} por revisar`
  const puestos = miembros.filter((m) => m.oficialAt != null).length
  return puestos > 0 ? `${puestos} puesto${puestos > 1 ? 's' : ''}` : 'ninguno'
}

/**
 * Los tiempos de meta de la ORGANIZACIÓN, al segundo. Al lado de cada uno, la
 * hora que tenemos ahora (de la baliza o del paso manual) y si está en
 * revisión: llegó pegado a otro y el GPS no sabe quién entró antes.
 */
function TiemposOficiales({ miembros, stats, salidaMs, busy, onGuardar }: {
  miembros: EventMember[]
  stats: EventStats | null
  salidaMs: number | null
  busy: boolean
  onGuardar: (username: string, at: number | null) => void
}) {
  const [horas, setHoras] = useState<Record<string, string>>({})
  const revisar = pendientesDe(stats)
  const hms = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  /** "19:17:04" → epoch ms del día de la carrera; si cae antes de la salida, del día siguiente. */
  const aEpoch = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim())
    if (!m) return null
    const d = new Date(salidaMs ?? Date.now())
    d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0)
    let at = d.getTime()
    if (salidaMs != null && at < salidaMs) at += 24 * 3600_000
    return at
  }
  const filas = miembros.slice().sort((a, b) => {
    const ca = stats?.corredores.find((c) => c.username === a.username)
    const cb = stats?.corredores.find((c) => c.username === b.username)
    return (ca?.finishedAt ?? Infinity) - (cb?.finishedAt ?? Infinity) || a.username.localeCompare(b.username)
  })
  return (
    <div>
      <p className="text-[11px] leading-snug text-slate-500">
        La hora de llegada del cronometraje de la organización, al segundo. Manda sobre la baliza y los pasos
        anotados, y rehace resultados y porra. Cuando dos entran pegados, el GPS no sabe quién llegó antes: hasta
        que pongas sus tiempos, la porra los deja pendientes de revisión.
      </p>
      <ul className="mt-2 space-y-1.5">
        {filas.map((m) => {
          const c = stats?.corredores.find((x) => x.username === m.username) ?? null
          const valor = horas[m.username] ?? (m.oficialAt != null ? hms(m.oficialAt) : '')
          const at = aEpoch(valor)
          const cambiado = at != null && at !== m.oficialAt
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="min-w-0 flex-1">
                <span className="text-slate-200">{m.emoji ? `${m.emoji} ` : ''}{m.username}</span>
                <span className="block text-[10px] text-slate-500">
                  {m.oficialAt != null
                    ? <span className="text-emerald-400">oficial</span>
                    : c?.finished && c.finishedAt != null
                      ? <>ahora {hms(c.finishedAt)}{c.margenMs ? ` ±${Math.round(c.margenMs / 1000)} s` : ''}{c.manual ? ' · paso manual' : ' · GPS'}</>
                      : 'sin llegada'}
                  {revisar.has(m.username) && <span className="text-amber-300"> · pegado a otro: por revisar</span>}
                </span>
              </span>
              <input
                type="time" step={1}
                value={valor}
                onChange={(e) => setHoras((h) => ({ ...h, [m.username]: e.target.value }))}
                className="w-[7.2rem] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 tabular-nums text-slate-200"
                aria-label={`Hora oficial de meta de ${m.username}`}
              />
              <button
                onClick={() => { if (at != null) { onGuardar(m.username, at); setHoras((h) => { const n = { ...h }; delete n[m.username]; return n }) } }}
                disabled={busy || !cambiado}
                aria-label={`Guardar la hora oficial de ${m.username}`}
                className="shrink-0 text-emerald-400 disabled:opacity-20"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => { onGuardar(m.username, null); setHoras((h) => { const n = { ...h }; delete n[m.username]; return n }) }}
                disabled={busy || m.oficialAt == null}
                aria-label={`Quitar la hora oficial de ${m.username}`}
                className="shrink-0 text-slate-500 hover:text-rose-400 disabled:opacity-20"
              >
                <X size={13} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Con quién se puede igualar a quien va en manual, y cómo se saca la referencia. */
interface Igualar {
  con: { nombre: string; emoji: string | null }[]
  calcula: (nombre: string) => Promise<Referencia | string>
}

/**
 * "Va con…": quien va en manual y corre junto a alguien con baliza. Se elige
 * a ese alguien, se ve el km y la hora de su último fijo preciso, y se anota
 * como paso. Se enseña antes de anotar: si se han separado, se nota en la
 * hora, y quien organiza decide.
 */
function VaCon({ m, igualar, busy, hora, onAnotar }: {
  m: EventMember
  igualar: Igualar
  busy: boolean
  hora: (ms: number) => string
  onAnotar: (km: number, at: number, con: string) => void
}) {
  const [con, setCon] = useState('')
  const [ref, setRef] = useState<Referencia | string | null>(null)
  const [cargando, setCargando] = useState(false)
  const pide = async (nombre: string) => {
    setCon(nombre); setRef(null)
    if (!nombre) return
    setCargando(true)
    try { setRef(await igualar.calcula(nombre)) } catch { setRef('No se ha podido leer su posición. Prueba otra vez.') } finally { setCargando(false) }
  }
  const hace = typeof ref === 'object' && ref ? Math.round((Date.now() - ref.at) / 60_000) : 0
  const yaAnotado = typeof ref === 'object' && ref ? (m.manualPasos ?? []).some(([k]) => Math.abs(k - ref.km) < 0.05) : false
  return (
    <div className="mt-2 border-t border-slate-800 pt-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-slate-400">Va con</span>
        <select
          value={con}
          onChange={(e) => void pide(e.target.value)}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200"
          aria-label="Con quién va"
        >
          <option value="">elige a quién (con baliza)…</option>
          {igualar.con.map((c) => <option key={c.nombre} value={c.nombre}>{c.emoji ? `${c.emoji} ` : ''}{c.nombre}</option>)}
        </select>
        {con && (
          <button onClick={() => void pide(con)} disabled={cargando} className="shrink-0 text-sky-400 underline disabled:opacity-40">
            releer
          </button>
        )}
      </div>
      {cargando && <p className="mt-1 text-slate-500">Leyendo su posición…</p>}
      {typeof ref === 'string' && <p className="mt-1 text-amber-300">{ref}</p>}
      {ref && typeof ref === 'object' && (
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-slate-300">
            km <b className="tabular-nums text-slate-100">{ref.km.toFixed(2)}</b> a las <b className="tabular-nums text-slate-100">{hora(ref.at)}</b>
            <span className="text-slate-500"> · GPS ±{Math.round(ref.precision)} m{hace >= 2 ? ` · hace ${hace} min` : ''}</span>
          </p>
          <button
            onClick={() => { onAnotar(ref.km, ref.at, `con ${con}`); setRef(null); setCon('') }}
            disabled={busy || yaAnotado}
            className="shrink-0 rounded-md bg-sky-700 px-2 py-1 font-semibold text-white disabled:opacity-40"
          >
            {yaAnotado ? 'Ya anotado' : 'Anotar paso'}
          </button>
        </div>
      )}
      <p className="mt-1 text-[10px] text-slate-500">
        Su km y su hora del último fijo con error de {PRECISO_M} m o menos. Solo si van juntos de verdad.
      </p>
    </div>
  )
}

/**
 * El alta de un corredor sin baliza: su nombre y, si lo tiene, su dorsal.
 * Plegado en una línea hasta que se pulsa: es de las cosas que se hacen una
 * vez por carrera y no puede competir con la parrilla por el sitio.
 */
function AltaSinBaliza({ busy, onAlta }: { busy: boolean; onAlta: (nombre: string, dorsal: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [dorsal, setDorsal] = useState('')
  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-400 transition-colors hover:border-sky-700 hover:text-sky-300"
      >
        <PenLine size={13} /> Añadir un corredor sin baliza
      </button>
    )
  }
  const ok = nombre.trim().length >= 3
  return (
    <div className="mt-2 rounded-lg border border-sky-900/60 bg-slate-950/60 p-2.5">
      <p className="text-[11px] leading-snug text-slate-400">
        Para quien ya se sabe que no llevará la app: irá en <b className="text-slate-300">modo manual</b> desde
        el principio, y sus pasos se anotan del cronometraje oficial. No es una cuenta: no puede entrar ni emitir.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          maxLength={40}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          aria-label="Nombre del corredor"
        />
        <input
          value={dorsal}
          onChange={(e) => setDorsal(e.target.value)}
          placeholder="Dorsal"
          maxLength={12}
          className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200"
          aria-label="Dorsal (opcional)"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => { setAbierto(false); setNombre(''); setDorsal('') }} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
          Cancelar
        </button>
        <button
          onClick={() => { onAlta(nombre.trim(), dorsal.trim()); setAbierto(false); setNombre(''); setDorsal('') }}
          disabled={busy || !ok}
          className="rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Añadir
        </button>
      </div>
    </div>
  )
}

const ICONO_TIPO: Record<TipoPunto, LucideIcon> = {
  control: Timer, liquido: Droplet, solido: Utensils, completo: UtensilsCrossed, bolsa: Backpack, meta: Flag,
}
const CHIP_TIPO: Record<TipoPunto, string> = {
  control: 'Control', liquido: 'Líquido', solido: 'Comida', completo: 'Completo', bolsa: 'Bolsa de vida', meta: 'Meta',
}

/** "2 añadidos · 1 cambiado", para la sección cerrada. */
function resumenPuntos(ajustes: PuntosAjustes | null): string {
  const todos = Object.values(ajustes ?? {})
  const nuevos = todos.filter((a) => a.nuevo).length
  const cambiados = todos.length - nuevos
  const partes = [
    nuevos ? `${nuevos} añadido${nuevos > 1 ? 's' : ''}` : '',
    cambiados ? `${cambiados} cambiado${cambiados > 1 ? 's' : ''}` : '',
  ].filter(Boolean)
  return partes.length ? partes.join(' · ') : 'según la ruta'
}

type CambioPunto = Parameters<typeof cambiaPunto>[1]

/** "12,4" o "12.4" → 12.4; lo que no es un km, null. */
function leeKm(t: string): number | null {
  const v = Number(t.trim().replace(',', '.'))
  return t.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * El editor de los puntos del recorrido en el evento: qué es cada uno, cuánto
 * se para y DÓNDE está, y añadir los que la ruta no trae (un control
 * intermedio que la organización pone el mismo día).
 *
 * Cada punto en su línea, con el nombre entero, y el tipo en botones con su
 * icono, los mismos del mapa: se ven todos a la vez y un toque lo guarda. (Un
 * desplegable nativo no admite iconos y parecía un campo de texto.)
 *
 * El km se corrige aquí escribiéndolo, o en el mapa del evento tocando el
 * sitio. Con el km se enseña la altura de ese sitio: es lo que dice si ha
 * caído en el collado o a media bajada.
 */
function EditorPuntos({ onNecesitaRuta, ruta, ajustes, busy, onCambio }: {
  /** Se abre el editor: hay que bajar la ruta para tener sus puntos. */
  onNecesitaRuta: () => void
  ruta: SharePayloadV1['track'] | null
  ajustes: PuntosAjustes | null
  busy: boolean
  onCambio: (c: CambioPunto) => void
}) {
  useEffect(() => { onNecesitaRuta() }, [onNecesitaRuta])
  /** Lo que se está escribiendo en cada punto (pausa y km), por su clave. */
  const [borrador, setBorrador] = useState<Record<string, { pausa?: string; km?: string }>>({})
  const [nuevo, setNuevo] = useState<{ nombre: string; km: string; aid: TipoPunto } | null>(null)
  if (ruta === null) return <p className="text-xs text-slate-500">Cargando el recorrido…</p>
  const totalKm = ruta.totalDistanceKm
  const { puntos } = puntosDelEvento(ruta, ajustes)
  const altura = (km: number | null) => {
    if (km === null || km > totalKm + 0.5) return null
    const s = sitioEnKm(ruta, km)
    return s ? `${Math.round(s.ele)} m` : null
  }
  const olvida = (clave: string) => setBorrador((d) => { const n = { ...d }; delete n[clave]; return n })
  return (
    <div>
      <p className="text-[11px] leading-snug text-slate-500">
        Qué es cada punto, cuánto se para uno ahí y dónde está. Lo que cambies aquí manda sobre la ruta, sin volver a
        publicarla, y lo usan el mapa, los cortes, los avisos y las previsiones. El sitio también se corrige en el mapa
        del evento, tocando el punto.
      </p>
      {puntos.length === 0 && <p className="mt-2 text-xs text-slate-500">Esta ruta no tiene puntos.</p>}
      <ul className="mt-1 divide-y divide-slate-800/80">
        {puntos.map((w) => {
          const clave = w.clave
          const ajuste = ajustes?.[clave] ?? null
          const kmRuta = w.nuevo ? null : (w.kmRuta ?? w.distanceKm)
          const original = kmRuta === null ? null : ruta.namedWaypoints.find((p) => p.distanceKm.toFixed(2) === clave) ?? null
          const tipo = tipoDe(w, totalKm)
          const deRuta = original
            ? (original.aid ?? sugiereTipo(original, totalKm - original.distanceKm < 0.2))
            : 'control'
          const b = borrador[clave] ?? {}
          const pausaGuardada = ajuste?.pausa != null ? String(ajuste.pausa) : ''
          const textoPausa = b.pausa ?? pausaGuardada
          const pausa = textoPausa.trim() === '' ? null : Number(textoPausa)
          const pausaOk = pausa === null || (Number.isFinite(pausa) && pausa >= 0 && pausa <= 600)
          const kmGuardado = w.distanceKm.toFixed(2)
          const textoKm = b.km ?? kmGuardado
          const km = leeKm(textoKm)
          const kmOk = km !== null && km <= totalKm + 0.5
          const cambiado = textoPausa !== pausaGuardada || (km !== null && km.toFixed(2) !== kmGuardado)
          const guarda = (extra: { aid?: TipoPunto | null } = {}) => {
            const aid = 'aid' in extra ? extra.aid! : (ajuste?.aid ?? null)
            const p = cambiado && pausaOk ? pausa : (ajuste?.pausa ?? null)
            const pos = cambiado && kmOk ? km! : w.distanceKm
            if (w.nuevo) onCambio({ clave, aid: aid ?? 'control', pausa: p, pos })
            else onCambio({ km: kmRuta!, aid, pausa: p, pos: Math.abs(pos - kmRuta!) < 0.005 ? null : pos })
            olvida(clave)
          }
          return (
            <li key={clave} className="py-2.5">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words font-medium text-slate-100">
                  {w.name || 'Sin nombre'}
                  {w.nuevo && <span className="ml-1.5 rounded bg-amber-950/70 px-1 align-middle text-[10px] font-normal text-amber-300">añadido</span>}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-slate-400">km {w.distanceKm.toFixed(1)}</span>
              </div>
              {w.kmRuta != null && (
                <p className="text-[10px] text-sky-300/80">Movido: la ruta lo ponía en el km {w.kmRuta.toFixed(1)}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Qué es ${w.name}`}>
                {TIPOS_PUNTO.map((t) => {
                  const Icono = ICONO_TIPO[t]
                  const elegido = t === tipo
                  return (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={elegido}
                      disabled={busy}
                      onClick={() => {
                        if (elegido) return
                        // El de la ruta, elegido a mano, es volver a la ruta.
                        guarda({ aid: !w.nuevo && t === deRuta ? null : t })
                      }}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                        elegido
                          ? 'border-sky-500 bg-sky-600/25 text-sky-100'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                      }`}
                    >
                      <Icono size={13} aria-hidden />
                      {CHIP_TIPO[t]}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-400">
                <label className="flex items-center gap-1.5">
                  Km
                  <input
                    type="text" inputMode="decimal"
                    value={textoKm}
                    onChange={(e) => setBorrador((d) => ({ ...d, [clave]: { ...b, km: e.target.value } }))}
                    className={`w-16 rounded border bg-slate-950 px-1.5 py-1 text-right tabular-nums text-slate-200 ${kmOk ? 'border-slate-700' : 'border-red-700'}`}
                  />
                  <span className="text-[10px] text-slate-500">{altura(km)}</span>
                </label>
                <label className="flex items-center gap-1.5">
                  Parada
                  <input
                    type="number" inputMode="numeric" min={0} max={600} step={1}
                    value={textoPausa}
                    onChange={(e) => setBorrador((d) => ({ ...d, [clave]: { ...b, pausa: e.target.value } }))}
                    placeholder={String(w.pauseMin ?? (tipo === 'bolsa' ? TIPO_PUNTO.bolsa.paradaMin : 0))}
                    className="w-12 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right tabular-nums text-slate-200"
                  />
                  min
                </label>
                {cambiado && (
                  <button
                    onClick={() => guarda()}
                    disabled={busy || !pausaOk || !kmOk}
                    className="rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-30"
                  >
                    Guardar
                  </button>
                )}
                {cambiado && (
                  <button onClick={() => olvida(clave)} className="text-[11px] text-slate-500 underline">deshacer</button>
                )}
                {!cambiado && w.nuevo && (
                  <button
                    onClick={() => onCambio({ clave, borrar: true })}
                    disabled={busy}
                    className="ml-auto text-[11px] text-red-400/80 underline hover:text-red-300 disabled:opacity-30"
                  >
                    quitar
                  </button>
                )}
                {!cambiado && !w.nuevo && ajuste && (
                  <button
                    onClick={() => { onCambio({ km: kmRuta!, aid: null, pausa: null, pos: null }); olvida(clave) }}
                    disabled={busy}
                    className="ml-auto text-[11px] text-slate-500 underline hover:text-sky-300 disabled:opacity-30"
                  >
                    volver a la ruta
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Añadir un punto: el control intermedio que la organización pone y la
          ruta no trae. Por defecto es solo control: sin parada, no cambia las
          previsiones, pero se ve en el mapa, se puede pedir aviso de paso y
          anotar su hora en modo manual. */}
      {nuevo === null ? (
        <button
          onClick={() => setNuevo({ nombre: '', km: '', aid: 'control' })}
          className="mt-2 w-full rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-300 hover:bg-slate-900"
        >
          + Añadir un punto
        </button>
      ) : (() => {
        const km = leeKm(nuevo.km)
        const ok = nuevo.nombre.trim() !== '' && km !== null && km <= totalKm + 0.5
        return (
          <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60 p-2.5">
            <input
              autoFocus
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              maxLength={60}
              placeholder="Nombre (p. ej. Control Coll de Pal)"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <label className="flex items-center gap-1.5">
                Km
                <input
                  type="text" inputMode="decimal"
                  value={nuevo.km}
                  onChange={(e) => setNuevo({ ...nuevo, km: e.target.value })}
                  placeholder="12,4"
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right tabular-nums text-slate-200"
                />
              </label>
              <span className="text-[11px] text-slate-500">
                {km === null ? `de 0 a ${totalKm.toFixed(1)}` : km > totalKm + 0.5 ? 'más allá de la meta' : `a ${altura(km)}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TIPOS_PUNTO.filter((t) => t !== 'meta').map((t) => {
                const Icono = ICONO_TIPO[t]
                return (
                  <button
                    key={t}
                    onClick={() => setNuevo({ ...nuevo, aid: t })}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                      nuevo.aid === t ? 'border-sky-500 bg-sky-600/25 text-sky-100' : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    <Icono size={13} aria-hidden />
                    {CHIP_TIPO[t]}
                  </button>
                )
              })}
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <button onClick={() => setNuevo(null)} className="px-2 text-xs text-slate-400">Cancelar</button>
              <button
                onClick={() => { onCambio({ nombre: nuevo.nombre.trim(), pos: km!, aid: nuevo.aid }); setNuevo(null) }}
                disabled={busy || !ok}
                className="rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
              >
                Añadir
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
