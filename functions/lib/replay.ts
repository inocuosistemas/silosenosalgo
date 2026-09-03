/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import type { TrailPoint, EventReplay, EventReplayRunner } from '../../shared/wireTypes'

/**
 * lib/replay.ts — la carrera entera, para volver a verla.
 *
 * El mapa en directo manda solo la COLA de cada traza (60 puntos): es contexto
 * de por dónde viene alguien, y mandar la traza entera de treinta personas cada
 * diez segundos convertiría la pantalla en una descarga continua. El replay es
 * justo lo contrario —se pide UNA vez, cuando la carrera ya terminó, y necesita
 * todo el recorrido— así que va por su propia puerta.
 *
 * Se remuestrea a `MAX_PUNTOS` por corredor. Una traza de 2000 puntos vista a
 * 60× pasa en cinco minutos: nadie distingue esos 2000 de 600, y la diferencia
 * en el móvil de quien lo mira es un megabyte contra trescientos kilobytes.
 */

const MAX_PUNTOS = 600

/** Uno de cada n, conservando siempre el primero y el último. */
function remuestrea(pts: TrailPoint[], max: number): TrailPoint[] {
  if (pts.length <= max) return pts
  const paso = pts.length / max
  const out: TrailPoint[] = []
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * paso)])
  const ultimo = pts[pts.length - 1]
  if (out[out.length - 1] !== ultimo) out.push(ultimo)
  return out
}

export async function construyeReplay(env: Env, eventId: string): Promise<EventReplay> {
  const rows = await env.DB.prepare(
    `SELECT u.username AS username, m.bib AS bib, m.emoji AS emoji, m.color AS color,
            t.started_at AS startedAt, t.trail AS trail
       FROM event_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN tracking_sessions t
              ON t.id = (SELECT t2.id FROM tracking_sessions t2
                          WHERE t2.event_id = m.event_id AND t2.owner_user_id = m.user_id
                          ORDER BY (t2.status = 'active') DESC,
                                   COALESCE(t2.updated_at, 0) DESC,
                                   t2.started_at DESC,
                                   t2.rowid DESC
                          LIMIT 1)
      WHERE m.event_id = ?
      ORDER BY u.username`,
  ).bind(eventId).all<{
    username: string; bib: string | null; emoji: string | null; color: string | null
    startedAt: number | null; trail: string | null
  }>()

  const runners: EventReplayRunner[] = []
  let desde = Infinity
  let hasta = -Infinity

  for (const r of rows.results ?? []) {
    if (!r.trail) continue
    let pts: TrailPoint[] = []
    try {
      const parsed = JSON.parse(r.trail) as TrailPoint[]
      if (Array.isArray(parsed)) {
        pts = parsed
          .filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number' && typeof p?.t === 'number')
          .sort((a, b) => a.t - b.t)
      }
    } catch { pts = [] }
    // Quien no llegó a emitir no sale en el replay: una fila vacía moviéndose
    // por ningún sitio no cuenta nada.
    if (pts.length < 2) continue
    desde = Math.min(desde, pts[0].t)
    hasta = Math.max(hasta, pts[pts.length - 1].t)
    runners.push({
      username: r.username,
      bib: r.bib,
      emoji: r.emoji,
      color: r.color,
      // Solo lo que hace falta para moverse por el mapa: hora y posición. La
      // precisión de cada punto no pinta nada a 60×.
      points: remuestrea(pts, MAX_PUNTOS).map((p) => ({ t: p.t, lat: p.lat, lon: p.lon })),
    })
  }

  return {
    from: Number.isFinite(desde) ? desde : 0,
    to: Number.isFinite(hasta) ? hasta : 0,
    runners,
  }
}
