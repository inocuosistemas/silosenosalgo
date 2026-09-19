import type { Env } from './db'
import { enviaPush } from './apns'
import { leePolilinea, type Polilinea } from './eventStats'

/**
 * Los AVISOS DE PASO: "avísame cuando pase alguien (o Soriano) por Espot".
 *
 * Se disparan cuando un corredor CRUZA el km del aviso: de por dónde iba a por
 * dónde va ahora, sobre el recorrido. Con las posiciones de su baliza (ver
 * `revisaAvisosDePosicion`) o con los pasos anotados en modo manual (ver
 * `disparaAvisos` desde `manual.ts`). Cada aviso se dispara UNA vez: el del
 * "primero que pase" se lo lleva el primero y ya no suena más.
 *
 * El aviso llega al iPhone de quien lo pidió, por la app (APNs): es donde hay
 * notificaciones de verdad. Al navegador no, y a Android aún no.
 */

/** Más lejos del recorrido que esto, un punto no dice por dónde va. */
const FUERA_M = 150
/** Ventana alrededor de lo último conocido: no se salta medio recorrido. */
const VENTANA_KM = 3

function metros(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = (b[0] - a[0]) * r
  return Math.hypot(x, y) * 6_371_000
}

/** El km del recorrido de una posición, buscado cerca de `cerca`. */
export function kmEnPolilinea(linea: Polilinea, lat: number, lon: number, cerca: number | null): number | null {
  let mejor = -1
  let mejorD = Infinity
  for (let i = 0; i < linea.length; i++) {
    if (cerca != null && (linea[i][2] < cerca - VENTANA_KM || linea[i][2] > cerca + VENTANA_KM)) continue
    const d = metros([lat, lon], [linea[i][0], linea[i][1]])
    if (d < mejorD) { mejorD = d; mejor = i }
  }
  return mejor >= 0 && mejorD <= FUERA_M ? linea[mejor][2] : null
}

function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
}

/**
 * Dispara los avisos pendientes de este evento cuyo km está entre `desdeKm`
 * (sin incluir) y `hastaKm` (incluido), para este corredor o para "el primero".
 */
export async function disparaAvisos(
  env: Env, eventId: string, corredorUserId: string, desdeKm: number, hastaKm: number, cuandoMs: number,
): Promise<number> {
  if (!(hastaKm > desdeKm)) return 0
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.user_id AS userId, a.km, a.nombre
       FROM event_avisos a
      WHERE a.event_id = ? AND a.disparado_at IS NULL AND a.km > ? AND a.km <= ?
        AND (a.corredor_user_id IS NULL OR a.corredor_user_id = ?)`,
  ).bind(eventId, desdeKm, hastaKm, corredorUserId).all<{ id: string; userId: string; km: number; nombre: string }>()
  const pendientes = results ?? []
  if (pendientes.length === 0) return 0

  const quien = await env.DB.prepare(
    `SELECT u.username, m.emoji, e.name AS evento FROM users u
       JOIN event_members m ON m.user_id = u.id AND m.event_id = ?
       JOIN events e ON e.id = m.event_id
      WHERE u.id = ?`,
  ).bind(eventId, corredorUserId).first<{ username: string; emoji: string | null; evento: string }>()
  if (!quien) return 0

  let enviados = 0
  for (const a of pendientes) {
    // Marcarlo ANTES de enviar, y solo si nadie lo ha marcado ya: dos
    // posiciones casi a la vez (o dos corredores juntos) no lo disparan dos
    // veces, y "el primero" se lo lleva de verdad el primero.
    const marcado = await env.DB.prepare('UPDATE event_avisos SET disparado_at = ? WHERE id = ? AND disparado_at IS NULL')
      .bind(Date.now(), a.id).run()
    if (!marcado.meta?.changes) continue
    await enviaPush(env, a.userId, {
      titulo: `${quien.emoji ? `${quien.emoji} ` : ''}${quien.username} ha pasado por ${a.nombre}`,
      cuerpo: `${hora(cuandoMs)} · km ${a.km.toFixed(1)} · ${quien.evento}`,
      collapseId: `aviso-${a.id}`,
      url: `https://silosenosalgo.themakercrowd.com/?e=${encodeURIComponent(eventId)}&v=mapa`,
    }).catch(() => 0)
    enviados++
  }
  return enviados
}

/**
 * Con cada posición nueva de una baliza de evento: por dónde va sobre el
 * recorrido y, si ha cruzado el km de algún aviso, avisarlo.
 *
 * Barato cuando no hay avisos, que es lo normal: una consulta por índice y
 * nada más. El recorrido solo se lee si hay algo pendiente.
 */
export async function revisaAvisosDePosicion(
  env: Env, sessionId: string, eventId: string, corredorUserId: string,
  kmAntes: number | null, lat: number, lon: number, cuandoMs: number,
): Promise<void> {
  const hay = await env.DB.prepare('SELECT 1 AS x FROM event_avisos WHERE event_id = ? AND disparado_at IS NULL LIMIT 1')
    .bind(eventId).first<{ x: number }>()
  if (!hay) return
  const linea = await leePolilinea(env, eventId)
  if (!linea) return
  const km = kmEnPolilinea(linea, lat, lon, kmAntes)
  if (km == null) return
  // Nunca hacia atrás: un punto que proyecta un poco por detrás (el GPS
  // baila) no "descruza" nada.
  if (kmAntes == null || km > kmAntes) {
    await env.DB.prepare('UPDATE tracking_sessions SET km_ruta = ? WHERE id = ?').bind(km, sessionId).run()
  }
  // La primera vez solo se apunta por dónde va: sin un "antes" no hay cruce.
  if (kmAntes != null && km > kmAntes) await disparaAvisos(env, eventId, corredorUserId, kmAntes, km, cuandoMs)
}
