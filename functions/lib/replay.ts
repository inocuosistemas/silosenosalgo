/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import type { TrailPoint, EventReplay, EventReplayRunner } from '../../shared/wireTypes'
import { sinSaltos, leeStats, leePolilinea, type Polilinea } from './eventStats'

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

/**
 * El último tramo, el que el GPS no llegó a contar.
 *
 * La meta se da por cruzada al 97% del recorrido —el receptor no clava el
 * último metro y el arco nunca cae en el punto exacto del GPX—, así que la
 * última lectura buena de cada uno puede estar doscientos metros antes del
 * final y en un sitio distinto para cada uno. En el replay eso se ve fatal: los
 * tres se paran desperdigados por el parque en vez de cruzar la meta, y quien
 * lo mira entiende que no llegaron.
 *
 * Se cierra POR EL RECORRIDO, no en línea recta: se enganchan los puntos del
 * trazado que quedaban desde donde se le vio por última vez hasta el final,
 * repartiendo el tiempo que falta. Es lo que hizo —esos metros los corrió— y
 * lo único que no se sabe es por qué lado exacto de la acera.
 */
function cierraEnMeta(pts: TrailPoint[], linea: Polilinea, metaMs: number): TrailPoint[] {
  const ultimo = pts[pts.length - 1]
  if (!ultimo) return pts
  // Dónde se le vio por última vez, buscando solo en el tramo final: en un
  // circuito el punto más cercano a la meta es también el de la salida.
  const desde = linea.findIndex((q) => q[2] >= linea[linea.length - 1][2] * 0.9)
  if (desde < 0) return pts
  let mejor = -1
  let mejorD = Infinity
  for (let i = desde; i < linea.length; i++) {
    const d = Math.hypot((linea[i][0] - ultimo.lat) * 111_320,
                         (linea[i][1] - ultimo.lon) * 111_320 * Math.cos((ultimo.lat * Math.PI) / 180))
    if (d < mejorD) { mejorD = d; mejor = i }
  }
  // Lejos del trazado no se inventa nada: si su última posición no está sobre
  // el recorrido, arrastrarla hasta la meta sería dibujar lo que no pasó.
  if (mejor < 0 || mejorD > 250) return pts
  const cola = linea.slice(mejor + 1)
  if (cola.length === 0) return pts
  const hueco = Math.max(0, metaMs - ultimo.t)
  return pts.concat(cola.map((q, i) => ({
    t: ultimo.t + (hueco * (i + 1)) / cola.length,
    lat: q[0], lon: q[1],
  })))
}

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
            t.started_at AS startedAt, t.trail AS trail,
            (SELECT e.activity FROM events e WHERE e.id = m.event_id) AS actividad
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
    startedAt: number | null; trail: string | null; actividad: string | null
  }>()

  // La hora a la que cada uno cruzó la meta, de los resultados ya congelados.
  // Cruzada la meta se acabó la carrera: lo que se hizo después —volver al
  // coche, ir a por el que venía detrás— no es la prueba, y verlo pasear por el
  // mapa media hora después de llegar no cuenta nada y confunde a quien mira.
  // Sin resultados congelados (una carrera cerrada antes de que existieran) se
  // enseña todo, que es mejor que nada.
  const ev = await env.DB.prepare('SELECT starts_at AS startsAt, ended_at AS endedAt, stats FROM events WHERE id = ?')
    .bind(eventId).first<{ startsAt: number | null; endedAt: number | null; stats: string | null }>()
  const stats = ev?.endedAt ? await leeStats(env, eventId, ev.stats) : null
  // El trazado, para poder cerrar el último tramo de quien llegó.
  const linea = stats ? await leePolilinea(env, eventId) : null
  const metaDe = new Map<string, number>()
  for (const c of stats?.corredores ?? []) {
    if (c.finishedAt != null) metaDe.set(c.username, c.finishedAt)
  }

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
    // Sin los picotazos de mala señal: el replay dibuja la línea entera, y un
    // salto de 60 metros y vuelta se ve como un rayo saliendo del corredor. Es
    // el MISMO filtro que descarta esos puntos en los resultados, así que el
    // mapa y los números cuentan lo mismo.
    const limpios = sinSaltos(pts, r.actividad)
    if (limpios.length >= 2) pts = limpios
    // Desde la salida OFICIAL, no desde que encendió el móvil. Quien llega con
    // tiempo enciende la baliza en el coche, en la cola del guardarropa o
    // calentando, y todo eso queda grabado: en el replay se veía a la gente
    // llegar por la carretera y dar vueltas por el pueblo antes de que la
    // carrera existiera —una hora de vídeo en la que no pasa nada y en la que
    // el reloj ya está corriendo—. Es la misma regla que ya usan los tiempos y
    // el margen a los cortes: la carrera empieza cuando la dan, no cuando cada
    // uno se prepara.
    //
    // Y si al cortar no queda carrera —la hora de salida está mal puesta, o es
    // de otro día— se enseña todo: es mejor un replay con el paseo de más que
    // un mapa vacío.
    if (ev?.startsAt != null) {
      const desdeLaSalida = pts.filter((p) => p.t >= ev.startsAt!)
      if (desdeLaSalida.length >= 2) pts = desdeLaSalida
    }
    // Hasta la meta y ni un punto más, para quien la cruzó.
    const meta = metaDe.get(r.username)
    if (meta != null) {
      const enCarrera = pts.filter((p) => p.t <= meta)
      if (enCarrera.length >= 2) pts = linea ? cierraEnMeta(enCarrera, linea, meta) : enCarrera
    }
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

  // El cronómetro del replay es el de la carrera: arranca en la salida oficial,
  // así que el tiempo que marca es el que llevaba cada uno de verdad. Sin ella
  // —o si alguien quedó con puntos anteriores— manda la primera lectura, que es
  // lo único que hay.
  const arranque = ev?.startsAt != null && Number.isFinite(desde)
    ? Math.min(ev.startsAt, desde)
    : desde

  return {
    from: Number.isFinite(arranque) ? arranque : 0,
    to: Number.isFinite(hasta) ? hasta : 0,
    runners,
  }
}
