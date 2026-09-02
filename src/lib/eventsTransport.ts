/**
 * Cliente de la API de eventos. Mismo patrón que `plansTransport`: envoltorio
 * de `fetch` que nunca lanza excepciones de red crudas y traduce el código del
 * servidor a un mensaje en español.
 */
import { gzipBytes, gunzipToString } from './shareTransport'
import type { SharePayloadV1 } from './sharePayload'
import { inferCutoffDatesFromWaypoints } from './cutoffInference'
import type { BaseChange } from './eventPlan'
import type { EventPlanOverlay } from './eventPlan'
import type {
  CreateEventResponse, EventDetailResponse, EventInfo, EventsListResponse, JoinEventResponse,
  CreateInviteResponse, EventLiveResponse, EventPublicResponse,
  EventBetsResponse, EventBetsInput,
} from '../../shared/wireTypes'
import { PUBLIC_BASE_URL } from '../../shared/config'

export class EventsError extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'EventsError'
  }
}

/** El enlace que se pega en el grupo: lleva el código, no el id del evento. */
export function eventJoinLink(code: string): string {
  return `${PUBLIC_BASE_URL}/?evento=${encodeURIComponent(code)}`
}

/** El enlace de la parrilla, para quien ya está dentro. */
export function eventLink(id: string): string {
  return `${PUBLIC_BASE_URL}/?e=${encodeURIComponent(id)}`
}

/** En la web se piden también los que uno organiza sin correr; ver el endpoint. */
export async function listEvents(): Promise<EventInfo[]> {
  const res = await fetchSafe('/api/events?organising=1', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as EventsListResponse).events
}

export async function getEvent(id: string): Promise<EventDetailResponse> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as EventDetailResponse
}

/** `join: false` monta el evento sin apuntarse a correrlo. */
export async function createEvent(name: string, startsAt?: number | null, join = true): Promise<string> {
  const res = await fetchSafe('/api/events', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, startsAt: startsAt ?? null, join }),
  })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as CreateEventResponse).id
}

export async function joinEvent(code: string): Promise<JoinEventResponse> {
  const res = await fetchSafe('/api/events/join', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as JoinEventResponse
}

/** Dónde está cada participante ahora mismo (el pulso del mapa del evento). */
export async function getEventLive(id: string): Promise<EventLiveResponse> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/live`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as EventLiveResponse
}

/** Lo mismo, pero por el enlace público: sin sesión y con datos recortados. */
export async function getEventPublic(token: string): Promise<EventPublicResponse> {
  const res = await fetchSafe(`/api/events/public/${encodeURIComponent(token)}`, { cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as EventPublicResponse
}

/** Publica el evento (o lo deja de publicar). Devuelve el token, o null. */
export async function setEventPublic(id: string, share: boolean): Promise<string | null> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/public`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ share }),
  })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as { publicToken: string | null }).publicToken
}

/** El enlace que se pega en el grupo de la familia. */
export function eventPublicLink(token: string): string {
  return `${PUBLIC_BASE_URL}/?ev=${encodeURIComponent(token)}`
}

/**
 * Une (o saca) al evento la baliza que ya se está emitiendo. Es lo que permite
 * salir a correr como siempre y decir después a qué carrera pertenece.
 */
export async function attachBeacon(id: string, attach: boolean): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/beacon`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attach }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

export async function setEventColor(id: string, color: string, userId?: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/color`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { color, userId } : { color }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/**
 * Pone (o quita, con cadena vacía) un dorsal. Sin `userId` es el propio; con
 * él, el de otro participante — solo el organizador puede.
 */
/**
 * La marca de uno en el mapa. Vacío la quita; `userId` es cosa del organizador,
 * que puede arreglar la de cualquiera igual que hace con los dorsales.
 */
export async function setEventEmoji(id: string, emoji: string, userId?: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/emoji`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { emoji, userId } : { emoji }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/** Reservar los colores para el organizador (o volver a soltarlos). */
export async function setEventColorsLocked(id: string, colorsLocked: boolean): Promise<void> {
  return setEventSettings(id, { colorsLocked })
}

/** El tablón de la carrera. Vacío lo quita. Solo quien organiza. */
export async function setEventNotes(id: string, notes: string): Promise<void> {
  return setEventSettings(id, { notes })
}

/**
 * Terminar la carrera (o reabrirla). Solo quien organiza.
 *
 * Al terminar se congelan los resultados; al reabrir se tiran, porque unos
 * resultados con gente todavía en carrera dirían que ganó quien iba primero.
 */
export async function endEvent(id: string, end: boolean): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/end`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ end }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/** La hora a la que cierra meta (epoch ms), o null para quitarla. */
export async function setEventEnd(id: string, endsAt: number | null): Promise<void> {
  return setEventSettings(id, { endsAt })
}

/** El límite de tiempo de la carrera en minutos, o null para quitarlo. */
export async function setEventLimit(id: string, limitMin: number | null): Promise<void> {
  return setEventSettings(id, { limitMin })
}

/** La porra del evento: la enciende y la apaga quien organiza. */
export async function setEventBetsEnabled(id: string, betsEnabled: boolean): Promise<void> {
  return setEventSettings(id, { betsEnabled })
}

async function setEventSettings(
  id: string,
  patch: {
    colorsLocked?: boolean; notes?: string; startsAt?: number | null
    betsEnabled?: boolean; endsAt?: number | null; limitMin?: number | null
  },
): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/settings`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

export async function setBib(id: string, bib: string, userId?: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/bib`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { bib, userId } : { bib }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/** Los enlaces oficiales de la carrera (solo el organizador). */
export async function setEventLinks(
  id: string, links: { trackingUrl?: string | null; websiteUrl?: string | null },
): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/links`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(links),
  })
  if (!res.ok) throw errFrom(res)
}

export async function leaveEvent(id: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/leave`, {
    method: 'POST', credentials: 'same-origin',
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'same-origin',
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/** Regenera el código de unión: la única forma de revocar uno ya repartido. */
export async function regenerateEventInvite(id: string): Promise<string> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/invite`, {
    method: 'POST', credentials: 'same-origin',
  })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as CreateInviteResponse).code
}

/**
 * Publica la base común del evento: el payload YA recortado (ver
 * `eventPlan.stripToEventBase`), comprimido igual que un plan cualquiera.
 */
export async function setEventPlan(
  id: string,
  base: SharePayloadV1,
  planName: string,
  /** Qué cambia respecto a la base anterior; se enseña a los participantes. */
  change?: BaseChange | null,
): Promise<void> {
  const gz = await gzipBytes(JSON.stringify(base))
  // La hora de salida del recorrido viaja aparte, en cabecera: el servidor
  // nunca abre un payload —los trata como bytes opacos— y quien tiene delante
  // el dato es el cliente, que acaba de construirlo.
  const salida = Date.parse(base.startTimeISO)
  // Dos datos más que el servidor no puede sacar del payload porque no lo abre:
  // cuánto mide la carrera —con eso se sabe quién llegó a meta— y a qué hora
  // cierra —con eso el evento se termina solo—. El cierre de meta es el último
  // cierre del recorrido, resuelto con su día como en el mapa.
  const km = base.track.totalDistanceKm
  const cierre = ultimoCierre(base)
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/plan`, {
    method: 'PUT', credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Plan-Name': encodeURIComponent(planName),
      ...(Number.isFinite(salida) ? { 'X-Plan-Start': String(salida) } : {}),
      ...(Number.isFinite(km) && km > 0 ? { 'X-Plan-Km': String(km) } : {}),
      ...(cierre !== null ? { 'X-Plan-End': String(cierre) } : {}),
      ...(change ? { 'X-Plan-Change': encodeURIComponent(JSON.stringify(change)) } : {}),
    },
    body: new Blob([gz]),
  })
  if (!res.ok) throw errFrom(res)
}

/**
 * La hora a la que cierra meta: el ÚLTIMO cierre del recorrido.
 *
 * Es lo que de verdad define hasta cuándo hay carrera. Se resuelve con la misma
 * inferencia de día que el resto —una hora de pared suelta no dice si es de hoy
 * o de mañana— y devuelve null cuando el recorrido no lleva cierres: una
 * quedada de los martes no termina a ninguna hora, y entonces solo la cierra
 * quien organiza.
 */
function ultimoCierre(base: SharePayloadV1): number | null {
  const relojes = new Map(
    Object.entries(base.cutoffWallClocks ?? {}).map(([k, v]) => [k, { hour: v.hour, minute: v.minute }]),
  )
  if (relojes.size === 0) return null
  const salida = new Date(base.startTimeISO)
  if (Number.isNaN(salida.getTime())) return null
  const fechas = inferCutoffDatesFromWaypoints(base.track.namedWaypoints ?? [], relojes, salida)
  let ultimo: number | null = null
  for (const d of fechas.values()) {
    const ms = d.getTime()
    if (ultimo === null || ms > ultimo) ultimo = ms
  }
  return ultimo
}

/** La salida OFICIAL de la carrera (epoch ms), o null para quitarla. */
export async function setEventStart(id: string, startsAt: number | null): Promise<void> {
  return setEventSettings(id, { startsAt })
}

/** La base del evento, tal cual está publicada (para componerla con el overlay). */
export async function getEventPlan(planShareId: string): Promise<SharePayloadV1> {
  const res = await fetchSafe(`/api/share/${encodeURIComponent(planShareId)}`, { cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return JSON.parse(await gunzipToString(await res.arrayBuffer())) as SharePayloadV1
}

/**
 * La porra de un evento. El GET no pide sesión —se mira donde se mira la
 * carrera, y eso incluye el enlace público— y el POST manda la porra ENTERA de
 * quien juega: lo que no va, se borra.
 */
export async function getEventBets(id: string): Promise<EventBetsResponse> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/bets`, {
    credentials: 'same-origin', cache: 'no-store',
  })
  if (!res.ok) throw errFrom(res)
  return res.json() as Promise<EventBetsResponse>
}

export async function putEventBets(id: string, bets: EventBetsInput): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/bets`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bets),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/** La foto del evento: JPEG ya reescalado por quien la sube. */
export async function setEventPhoto(id: string, jpeg: Blob): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/photo`, {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'image/jpeg' }, body: jpeg,
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

/**
 * La URL de la foto, VERSIONADA con la hora de subida.
 *
 * La imagen vive siempre bajo la misma clave, así que sin el `?v=` reencuadrar
 * no cambia ninguna url y cada navegador sigue enseñando la que tuviera
 * cacheada: la misma pantalla acababa mostrando dos fotos distintas según
 * quién mirase. Con la versión, la url cambia exactamente cuando cambia la
 * foto — y por eso el servidor puede cachearla un año.
 */
export function eventPhotoUrl(id: string, photoAt?: number | null): string {
  const base = `/api/events/${encodeURIComponent(id)}/photo`
  return photoAt ? `${base}?v=${photoAt}` : base
}

/**
 * La proporción de la foto de un evento: tira apaisada de 3:1.
 *
 * Es una sola para TODOS los sitios donde sale —la cabecera de la parrilla y la
 * miniatura del listado— y por eso el encuadre que elige quien la sube vale en
 * los dos: si cada sitio recortara por su cuenta, lo que se encuadró con
 * cuidado saldría cortado en el otro.
 */
export const EVENT_PHOTO_ASPECT = 3

/** El overlay personal se guarda como JSON en la membresía (fase 2 del editor). */
export function serializeOverlay(overlay: EventPlanOverlay): string {
  return JSON.stringify(overlay)
}

export function parseOverlay(raw: string | null): EventPlanOverlay | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as EventPlanOverlay) : null
  } catch {
    return null
  }
}

async function fetchSafe(input: string, init: RequestInit): Promise<Response> {
  try { return await fetch(input, init) } catch { throw new EventsError('network') }
}

function errFrom(res: Response): EventsError {
  if (res.status === 401) return new EventsError('unauthorized')
  if (res.status === 403) return new EventsError('forbidden')
  if (res.status === 404) return new EventsError('not_found')
  // 409 lo usan dos cosas distintas: el color pillado y "no hay baliza que
  // unir". El cuerpo trae el código exacto, pero para el mensaje basta con
  // saber cuál de las dos rutas respondió.
  if (res.status === 409) {
    return new EventsError(res.url.includes('/beacon') ? 'no_session' : 'color_taken')
  }
  // 400 lo devuelven varias rutas; la que respondió dice cuál es el problema.
  if (res.status === 400) {
    if (res.url.includes('/bib')) return new EventsError('bad_bib')
    if (res.url.includes('/links')) return new EventsError('bad_url')
  }
  if (res.status === 410) return new EventsError('invalid_invite')
  if (res.status === 413) return new EventsError('too_large')
  if (res.status === 429) return new EventsError('rate_limited')
  return new EventsError('network')
}

export function eventsErrorMessage(code: string): string {
  switch (code) {
    case 'unauthorized': return 'Inicia sesión para acceder a los eventos.'
    case 'forbidden': return 'Solo un administrador puede crear eventos.'
    case 'not_found': return 'Este evento ya no existe o no participas en él.'
    case 'no_session': return 'No tienes ninguna baliza emitiendo ahora mismo. Empieza a compartir tu posición y vuelve.'
    case 'bad_bib': return 'Ese dorsal no vale: hasta 12 caracteres, letras y números.'
    case 'bad_url': return 'El enlace tiene que empezar por http:// o https://.'
    case 'color_taken': return 'Ese color acaba de cogerlo otro participante. Elige otro.'
    case 'emoji_taken': return 'Ese emoji acaba de cogerlo otro participante. Elige otro.'
    case 'bad_emoji': return 'Tiene que ser un solo emoji, y no una bandera de país.'
    case 'colors_locked': return 'En este evento los colores agrupan y los reparte quien organiza.'
    case 'invalid_invite': return 'El código no vale o el evento ya terminó.'
    case 'too_large': return 'El texto es demasiado largo.'
    case 'rate_limited': return 'Demasiados intentos. Espera un poco.'
    default: return 'No se pudo completar la operación. Revisa tu conexión.'
  }
}
