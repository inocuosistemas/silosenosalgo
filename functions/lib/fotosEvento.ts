/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import type { EventFoto } from '../../shared/wireTypes'
import { puedeOrganizar } from './organiza'

/**
 * lib/fotosEvento.ts — las fotos de un evento, en su mapa.
 *
 * Salen de dos sitios:
 *
 *   · las NOTAS CON FOTO de las balizas de los participantes, que ya traen
 *     posición, hora y kilómetro;
 *   · las SUBIDAS desde la página del evento, con la posición que traiga la
 *     propia foto o la que se elija en el recorrido. Nunca la del móvil al
 *     subirla: se suben al acabar, y saldrían todas en la meta. Sin ninguna, va
 *     sin sitio y no sale en el mapa.
 *
 * Se sirven POR EL EVENTO (`/fotos/<id>`) y nunca con la URL de la nota: esa
 * lleva el identificador de la baliza de cada uno, que es su enlace de
 * seguimiento, y no hay por qué repartirlo con cada foto.
 *
 * Las subidas no caducan: son del evento. Las de las notas caducan a los 60 días
 * con la baliza, así que al guardar el evento se copian al archivo y desde
 * entonces salen de él (ver `lib/archivo`).
 */

export const claveFoto = (eventId: string, id: string) => `eventfoto:${eventId}:${id}`
export const claveFotoNotaArchivada = (eventId: string, noteId: string) => `archivo:${eventId}:nota:${noteId}`
export const claveNotasArchivadas = (eventId: string) => `archivo:${eventId}:notas`
/** El mismo formato que `mediaKvKey` en `api/track/[id]/notes/[noteId]/media.ts`. */
const claveMediaNota = (sessionId: string, noteId: string) => `notemedia:${sessionId}:${noteId}:photo`

/** Una foto antes de decidir desde dónde se descarga y quién la puede borrar. */
export type FotoSinUrl = Omit<EventFoto, 'url' | 'borrable'> & { autorId: string }

/**
 * Las fotos vivas completadas con las archivadas: una nota que ya no está —la
 * baliza se borró— sale del archivo; si está en los dos, manda la viva. Por
 * hora, que es como se recorren en el visor.
 */
export function juntaFotos(vivas: FotoSinUrl[], archivadas: FotoSinUrl[]): FotoSinUrl[] {
  const ids = new Set(vivas.map((f) => f.id))
  return [...vivas, ...archivadas.filter((f) => !ids.has(f.id))]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

/** Quien participa o quien organiza: los que ven el evento con sesión. */
export async function puedeVerEvento(env: Env, eventId: string, user: { id: string; isAdmin?: boolean }): Promise<boolean> {
  const miembro = await env.DB.prepare('SELECT 1 AS ok FROM event_members WHERE event_id = ? AND user_id = ?')
    .bind(eventId, user.id).first<{ ok: number }>()
  return !!miembro || puedeOrganizar(env, eventId, user as never)
}

export async function fotosDelEvento(env: Env, eventId: string): Promise<FotoSinUrl[]> {
  const [notas, subidas, archivadas] = await Promise.all([
    env.DB.prepare(
      `SELECT n.id AS noteId, n.owner_user_id AS autorId, u.username AS username, n.created_at AS at,
              n.lat AS lat, n.lon AS lon, n.track_km AS km, COALESCE(n.title, n.body) AS texto
         FROM track_notes n
         JOIN tracking_sessions t ON t.id = n.session_id
         JOIN users u ON u.id = n.owner_user_id
        WHERE t.event_id = ? AND n.photo_key IS NOT NULL AND n.lat IS NOT NULL AND n.lon IS NOT NULL`,
    ).bind(eventId).all<{
      noteId: string; autorId: string; username: string; at: number
      lat: number; lon: number; km: number | null; texto: string | null
    }>(),
    env.DB.prepare(
      `SELECT p.id AS id, p.user_id AS autorId, u.username AS username, COALESCE(p.taken_at, p.created_at) AS at,
              p.lat AS lat, p.lon AS lon, p.km AS km, p.posicion AS posicion, p.caption AS texto
         FROM event_photos p JOIN users u ON u.id = p.user_id
        WHERE p.event_id = ?`,
    ).bind(eventId).all<{
      id: string; autorId: string; username: string; at: number
      lat: number | null; lon: number | null; km: number | null; posicion: 'foto' | 'recorrido' | null; texto: string | null
    }>(),
    env.SHARE_KV.get(claveNotasArchivadas(eventId), 'json') as Promise<FotoSinUrl[] | null>,
  ])
  const vivas: FotoSinUrl[] = [
    ...(notas.results ?? []).map((n): FotoSinUrl => ({
      id: `n_${n.noteId}`, origen: 'nota', autorId: n.autorId, username: n.username,
      at: n.at, lat: n.lat, lon: n.lon, km: n.km, posicion: 'foto', texto: n.texto,
    })),
    ...(subidas.results ?? []).map((p): FotoSinUrl => ({
      id: `s_${p.id}`, origen: 'subida', autorId: p.autorId, username: p.username,
      at: p.at, lat: p.lat, lon: p.lon, km: p.km, posicion: p.posicion, texto: p.texto,
    })),
  ]
  return juntaFotos(vivas, archivadas ?? [])
}

/** La foto de una nota, tal como la guardó la baliza, si sigue ahí. */
async function bytesVivosDeNota(env: Env, eventId: string, noteId: string): Promise<ArrayBuffer | null> {
  const n = await env.DB.prepare(
    `SELECT n.session_id AS sessionId FROM track_notes n JOIN tracking_sessions t ON t.id = n.session_id
      WHERE n.id = ? AND t.event_id = ? AND n.photo_key IS NOT NULL`,
  ).bind(noteId, eventId).first<{ sessionId: string }>()
  return n ? env.SHARE_KV.get(claveMediaNota(n.sessionId, noteId), 'arrayBuffer') : null
}

/** Los bytes de una foto del evento, o null. Solo de ESTE evento: el id no abre fotos de otros. */
export async function bytesDeFoto(env: Env, eventId: string, fotoId: string): Promise<ArrayBuffer | null> {
  if (fotoId.startsWith('s_')) return env.SHARE_KV.get(claveFoto(eventId, fotoId.slice(2)), 'arrayBuffer')
  if (fotoId.startsWith('n_')) {
    const noteId = fotoId.slice(2)
    return (await bytesVivosDeNota(env, eventId, noteId))
      ?? env.SHARE_KV.get(claveFotoNotaArchivada(eventId, noteId), 'arrayBuffer')
  }
  return null
}

/**
 * Copia al archivo del evento las fotos de las notas —caducan con la baliza— y
 * su lista, para que sigan en el mapa cuando ya no estén. Devuelve cuántas quedan
 * guardadas.
 */
export async function archivaFotosDeNotas(env: Env, eventId: string): Promise<number> {
  const deNotas = (await fotosDelEvento(env, eventId)).filter((f) => f.origen === 'nota')
  const guardadas: FotoSinUrl[] = []
  for (const f of deNotas) {
    const noteId = f.id.slice(2)
    const clave = claveFotoNotaArchivada(eventId, noteId)
    const viva = await bytesVivosDeNota(env, eventId, noteId)
    if (viva) {
      await env.SHARE_KV.put(clave, viva)
      guardadas.push(f)
    } else if ((await env.SHARE_KV.list({ prefix: clave, limit: 1 })).keys.length > 0) {
      // Ya caducó en la baliza, pero se guardó en una vez anterior.
      guardadas.push(f)
    }
  }
  await env.SHARE_KV.put(claveNotasArchivadas(eventId), JSON.stringify(guardadas))
  return guardadas.length
}

/** Lo que se manda de una foto: sin el id interno de su autor. */
export function paraEnviar(f: FotoSinUrl, url: string, borrable: boolean): EventFoto {
  const { autorId: _autor, ...resto } = f
  void _autor
  return { ...resto, url, ...(borrable ? { borrable: true } : {}) }
}

/** Un punto del trazado guardado del evento (`[lat, lon, km]`) en un km, interpolando. */
export function puntoEnKm(linea: [number, number, number][], km: number): [number, number] | null {
  if (linea.length === 0) return null
  if (km <= linea[0][2]) return [linea[0][0], linea[0][1]]
  const ultimo = linea[linea.length - 1]
  if (km >= ultimo[2]) return [ultimo[0], ultimo[1]]
  let lo = 0
  let hi = linea.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (linea[mid][2] <= km) lo = mid
    else hi = mid
  }
  const tramo = linea[hi][2] - linea[lo][2]
  const t = tramo > 0 ? (km - linea[lo][2]) / tramo : 0
  return [linea[lo][0] + t * (linea[hi][0] - linea[lo][0]), linea[lo][1] + t * (linea[hi][1] - linea[lo][1])]
}

export interface SitioFoto {
  lat: number | null
  lon: number | null
  km: number | null
  posicion: 'foto' | 'recorrido' | null
}

/**
 * El sitio de una foto a partir de lo que manda quien la sube o la recoloca: sus
 * coordenadas —las del GPS de la propia foto—, un km del recorrido, o nada.
 * `'bad'` si lo que manda no vale. Que las coordenadas sean de la foto y no del
 * móvil lo garantiza la web, que es quien las lee; aquí solo se comprueban.
 */
export function resuelveSitio(
  e: { lat?: number | null; lon?: number | null; km?: number | null },
  linea: [number, number, number][] | null,
): SitioFoto | 'bad' {
  if (e.lat != null || e.lon != null) {
    if (e.lat == null || e.lon == null || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)
      || Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180) return 'bad'
    return { lat: e.lat, lon: e.lon, km: null, posicion: 'foto' }
  }
  if (e.km != null) {
    if (!Number.isFinite(e.km) || e.km < 0 || !linea || linea.length === 0) return 'bad'
    const km = Math.min(e.km, linea[linea.length - 1][2])
    const p = puntoEnKm(linea, km)
    if (!p) return 'bad'
    return { lat: p[0], lon: p[1], km: Math.round(km * 100) / 100, posicion: 'recorrido' }
  }
  return { lat: null, lon: null, km: null, posicion: null }
}
