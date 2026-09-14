/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import type { EventReplay } from '../../shared/wireTypes'
import { construyeReplay } from './replay'
import { archivaFotosDeNotas } from './fotosEvento'

/**
 * lib/archivo.ts — guardar un evento para siempre.
 *
 * Un evento está hecho de cosas que duran distinto:
 *
 *   · los resultados y la porra se congelan en la base de datos al cerrar, y
 *     se quedan;
 *   · las TRAZAS de cada corredor —con las que se hace el replay— caducan con
 *     el plazo que eligió cada uno en su baliza: treinta días como mucho, siete
 *     desde el cierre como poco en una carrera, y para siempre solo con la
 *     chincheta;
 *   · el recorrido y la foto del evento viven un año en KV.
 *
 * O sea que al mes de la carrera el replay se quedaba con quien hubiera puesto
 * la chincheta, y al año el mapa sin recorrido. Aquí se hace una copia SIN
 * caducidad de todo eso, y las pantallas tiran de ella cuando falta el original.
 *
 * Es decisión del organizador de la plataforma que el evento mande: la traza de
 * una carrera queda en su archivo aunque su dueño eligiera un plazo más corto,
 * igual que su nombre queda en la clasificación. Se avisa al apuntarse.
 */

export const claveArchivo = {
  replay: (eventId: string) => `archivo:${eventId}:replay`,
  plan: (eventId: string) => `archivo:${eventId}:plan`,
  foto: (eventId: string) => `archivo:${eventId}:foto`,
}

/**
 * El replay de ahora completado con el guardado.
 *
 * Quien todavía tiene traza sale de ella —puede traer correcciones: un abandono
 * marcado después recorta su traza—, y quien ya no la tiene sale del archivo.
 * Así volver a guardar con alguna traza ya purgada no pierde a nadie, y un
 * archivo bueno no se puede vaciar. El reloj —de la salida al cierre— es el de
 * ahora, que sale de los resultados vigentes.
 */
export function fusionaReplay(nuevo: EventReplay, guardado: EventReplay | null): EventReplay {
  if (!guardado || guardado.runners.length === 0) return nuevo
  if (nuevo.runners.length === 0) return guardado
  const conTraza = new Set(nuevo.runners.map((r) => r.username))
  const rescatados = guardado.runners.filter((r) => !conTraza.has(r.username))
  if (rescatados.length === 0) return nuevo
  return {
    from: nuevo.from,
    to: nuevo.to,
    runners: [...nuevo.runners, ...rescatados].sort((a, b) => a.username.localeCompare(b.username)),
  }
}

/** El replay que se enseña: el de ahora, con lo que falte sacado del archivo. */
export async function replayDelEvento(env: Env, eventId: string): Promise<EventReplay> {
  const [nuevo, guardado] = await Promise.all([
    construyeReplay(env, eventId),
    env.SHARE_KV.get(claveArchivo.replay(eventId), 'json') as Promise<EventReplay | null>,
  ])
  return fusionaReplay(nuevo, guardado)
}

/**
 * Guarda el evento: copia sin caducidad del replay, el recorrido, la foto del
 * evento y las fotos de las notas de las balizas.
 *
 * Se llama solo al cerrar la carrera —con los resultados recién hechos, que es
 * cuando todavía está todo— y a mano desde la parrilla, para repetirlo tras una
 * corrección o para guardar un evento cerrado antes de que esto existiera.
 */
export async function guardaEvento(
  env: Env, eventId: string,
): Promise<{ archivedAt: number; corredores: number; fotos: number }> {
  const ev = await env.DB.prepare('SELECT plan_share_id AS planShareId, photo_key AS photoKey FROM events WHERE id = ?')
    .bind(eventId).first<{ planShareId: string | null; photoKey: string | null }>()
  if (!ev) throw new Error('not_found')

  const replay = await replayDelEvento(env, eventId)
  if (replay.runners.length > 0) {
    await env.SHARE_KV.put(claveArchivo.replay(eventId), JSON.stringify(replay))
  }
  if (ev.planShareId) {
    const plan = await env.SHARE_KV.get(ev.planShareId, 'arrayBuffer')
    if (plan) await env.SHARE_KV.put(claveArchivo.plan(eventId), plan)
  }
  if (ev.photoKey) {
    const foto = await env.SHARE_KV.get(ev.photoKey, 'arrayBuffer')
    if (foto) await env.SHARE_KV.put(claveArchivo.foto(eventId), foto)
  }

  // Y las fotos de las notas de las balizas, que caducan con ellas a los 60 días.
  const fotos = await archivaFotosDeNotas(env, eventId)

  const archivedAt = Date.now()
  await env.DB.prepare('UPDATE events SET archived_at = ? WHERE id = ?').bind(archivedAt, eventId).run()
  return { archivedAt, corredores: replay.runners.length, fotos }
}
