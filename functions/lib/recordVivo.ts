/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import { calculaAhora } from './eventStats'

/**
 * lib/recordVivo.ts — el kilómetro más rápido HASTA AHORA, mientras se corre.
 *
 * La porra tiene un pronóstico, "quién hace el kilómetro más rápido", que no se
 * podía seguir en directo: el dato solo existía en los resultados congelados, al
 * cerrar la carrera. Durante las horas en que la gente mira el móvil, el "cómo
 * va" no decía nada de él y esos pronósticos no sumaban ni en provisional.
 *
 * Se calcula con las trazas de ahora mismo —el mismo cálculo que los
 * resultados— y se guarda dos minutos en la caché del borde: la porra se
 * refresca cada minuto en cada móvil que la mira, y rehacer todas las trazas en
 * cada visita no tiene sentido para un dato que se mueve despacio.
 */

export interface RecordDeKm {
  username: string
  minutos: number
  desdeKm: number
}

/** Cuánto vale un récord provisional antes de volver a calcularlo (s). */
const VIGENCIA_S = 120

/**
 * ¿Toca calcularlo? Solo con la porra encendida y la carrera en marcha: antes de
 * la salida no hay kilómetros, y con la carrera cerrada manda el de los
 * resultados congelados.
 */
export function tocaRecordVivo(
  ev: { betsEnabled: number; startsAt: number | null; endedAt: number | null },
  ahora: number,
): boolean {
  return ev.betsEnabled === 1 && ev.startsAt !== null && ahora >= ev.startsAt && ev.endedAt === null
}

export async function recordVivo(
  env: Env,
  eventId: string,
  totalKm: number | null,
  /** El origen de la petición: la clave de caché tiene que ser de la propia zona. */
  origen: string,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<RecordDeKm | null> {
  const clave = new Request(`${origen}/__cache/record-vivo/${encodeURIComponent(eventId)}`)
  const cache = (caches as unknown as { default: Cache }).default
  try {
    const guardado = await cache.match(clave)
    if (guardado) return (await guardado.json()) as RecordDeKm | null
  } catch { /* sin caché, se calcula */ }

  const record = (await calculaAhora(env, eventId, totalKm)).fastestKm ?? null
  try {
    waitUntil(cache.put(clave, new Response(JSON.stringify(record), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${VIGENCIA_S}` },
    })))
  } catch { /* la próxima visita lo recalcula */ }
  return record
}
