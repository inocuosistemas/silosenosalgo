/**
 * Client for the saved-plans API. Reuses the share gzip helpers and the
 * SharePayload reviver, so a saved "previsión" is the exact same document as a
 * "compartir salida" snapshot — just stored privately per user instead of in KV.
 */
import { gzipBytes, gunzipToString } from './shareTransport'
import { reviveSharePayload, type RevivedShare, type SharePayloadV1 } from './sharePayload'
import type { PlanMeta, PlansListResponse } from '../../shared/wireTypes'

const MAX_PLAN_BYTES = 1.8 * 1024 * 1024

export class PlansError extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'PlansError'
  }
}

function planHeaders(p: SharePayloadV1, name: string): Record<string, string> {
  return {
    'Content-Type': 'application/octet-stream',
    'X-Plan-Name': encodeURIComponent(name),
    'X-Plan-Route': encodeURIComponent(p.track.name || ''),
    'X-Plan-Distance': String(p.track.totalDistanceKm ?? ''),
    'X-Plan-Elev': String(p.track.elevGainM ?? ''),
    'X-Plan-Start': encodeURIComponent(p.startTimeISO || ''),
  }
}

/** Suggested name when first saving the current route. */
export function suggestPlanName(p: SharePayloadV1): string {
  const km = p.track.totalDistanceKm
  const kmStr = km >= 100 ? Math.round(km).toString() : km.toFixed(0)
  return `${p.track.name?.trim() || 'Ruta'} · ${kmStr} km`
}

export async function listPlans(): Promise<PlanMeta[]> {
  const res = await fetchSafe('/api/plans', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  return ((await res.json()) as PlansListResponse).plans
}

export async function createPlan(payload: SharePayloadV1, name: string): Promise<PlanMeta> {
  const gz = await gzipBytes(JSON.stringify(payload))
  if (gz.byteLength > MAX_PLAN_BYTES) throw new PlansError('too_large')
  const res = await fetchSafe('/api/plans', {
    method: 'POST', credentials: 'same-origin', headers: planHeaders(payload, name), body: new Blob([gz]),
  })
  if (!res.ok) throw errFrom(res)
  return (await res.json()) as PlanMeta
}

/** Fetch + gunzip + revive a plan into in-memory shapes. */
export async function getPlan(id: string): Promise<RevivedShare> {
  const res = await fetchSafe(`/api/plans/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw errFrom(res)
  const buf = await res.arrayBuffer()
  return reviveSharePayload(JSON.parse(await gunzipToString(buf)))
}

export async function renamePlan(id: string, name: string): Promise<void> {
  const res = await fetchSafe(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  if (!res.ok) throw errFrom(res)
}

export async function deletePlan(id: string): Promise<void> {
  const res = await fetchSafe(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!(res.ok || res.status === 204)) throw errFrom(res)
}

async function fetchSafe(input: string, init: RequestInit): Promise<Response> {
  try { return await fetch(input, init) } catch { throw new PlansError('network') }
}

function errFrom(res: Response): PlansError {
  if (res.status === 401) return new PlansError('unauthorized')
  if (res.status === 404) return new PlansError('not_found')
  if (res.status === 413) return new PlansError('too_large')
  return new PlansError('network')
}

export function plansErrorMessage(code: string): string {
  switch (code) {
    case 'too_large': return 'La ruta es demasiado grande para guardarla en tu cuenta.'
    case 'unauthorized': return 'Inicia sesión para gestionar tus previsiones.'
    case 'not_found': return 'No se encontró la previsión.'
    default: return 'No se pudo completar la operación. Revisa tu conexión.'
  }
}
