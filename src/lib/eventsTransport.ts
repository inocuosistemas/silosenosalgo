/**
 * Cliente de la API de eventos. Mismo patrón que `plansTransport`: envoltorio
 * de `fetch` que nunca lanza excepciones de red crudas y traduce el código del
 * servidor a un mensaje en español.
 */
import { gzipBytes, gunzipToString } from './shareTransport'
import type { SharePayloadV1 } from './sharePayload'
import type { EventPlanOverlay } from './eventPlan'
import type {
  CreateEventResponse, EventDetailResponse, EventInfo, EventsListResponse, JoinEventResponse,
  CreateInviteResponse,
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

/** El enlace del lobby, para quien ya está dentro. */
export function eventLink(id: string): string {
  return `${PUBLIC_BASE_URL}/?e=${encodeURIComponent(id)}`
}

export async function listEvents(): Promise<EventInfo[]> {
  const res = await fetchSafe('/api/events', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as EventsListResponse).events
}

export async function getEvent(id: string): Promise<EventDetailResponse> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as EventDetailResponse
}

export async function createEvent(name: string, startsAt?: number | null): Promise<string> {
  const res = await fetchSafe('/api/events', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, startsAt: startsAt ?? null }),
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

export async function setEventColor(id: string, color: string): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/color`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
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
export async function setEventPlan(id: string, base: SharePayloadV1, planName: string): Promise<void> {
  const gz = await gzipBytes(JSON.stringify(base))
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/plan`, {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Plan-Name': encodeURIComponent(planName) },
    body: new Blob([gz]),
  })
  if (!res.ok) throw errFrom(res)
}

/** La base del evento, tal cual está publicada (para componerla con el overlay). */
export async function getEventPlan(planShareId: string): Promise<SharePayloadV1> {
  const res = await fetchSafe(`/api/share/${encodeURIComponent(planShareId)}`, { cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return JSON.parse(await gunzipToString(await res.arrayBuffer())) as SharePayloadV1
}

/** La foto del evento: JPEG ya reescalado por quien la sube. */
export async function setEventPhoto(id: string, jpeg: Blob): Promise<void> {
  const res = await fetchSafe(`/api/events/${encodeURIComponent(id)}/photo`, {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'image/jpeg' }, body: jpeg,
  })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

export function eventPhotoUrl(id: string): string {
  return `/api/events/${encodeURIComponent(id)}/photo`
}

/**
 * La proporción de la foto de un evento: tira apaisada de 3:1.
 *
 * Es una sola para TODOS los sitios donde sale —la cabecera del lobby y la
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
  if (res.status === 409) return new EventsError('color_taken')
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
    case 'color_taken': return 'Ese color acaba de cogerlo otro participante. Elige otro.'
    case 'invalid_invite': return 'El código no vale o el evento ya terminó.'
    case 'too_large': return 'La ruta es demasiado grande para el evento.'
    case 'rate_limited': return 'Demasiados intentos. Espera un poco.'
    default: return 'No se pudo completar la operación. Revisa tu conexión.'
  }
}
