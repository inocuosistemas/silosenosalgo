/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import type { TrailPoint, EventStats, EventRunnerStats } from '../../shared/wireTypes'

/**
 * lib/eventStats.ts — los resultados de una carrera, congelados al cerrarla.
 *
 * Se calculan UNA vez, al cerrar el evento, y se guardan como JSON. No es una
 * optimización: las trazas se purgan a las 48 h de la última posición, así que
 * si no se congelan, el lunes ya no se puede decir quién ganó el sábado. La
 * porra depende de lo mismo —se puntúa contra quién llegó a meta y cuándo—, y
 * un ranking que se vacía solo a los dos días no es un ranking.
 *
 * Todo sale de lo que ya hay guardado: la traza (hasta 2000 puntos con su hora
 * de GPS) y el kilómetro sobre el recorrido que reporta cada baliza. No hace
 * falta abrir el payload del recorrido —el servidor no lo abre nunca— porque
 * el km lo calcula quien corre, que es quien lo sabe.
 */

/** Metros entre dos puntos por la fórmula del semiverseno. */
function metros(a: TrailPoint, b: TrailPoint): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * El kilómetro más rápido: la ventana de 1 km que menos tardó.
 *
 * Se recorre la traza acumulando distancia y se busca, para cada punto, cuánto
 * se tardó en llegar hasta él desde el punto que está exactamente un kilómetro
 * antes (interpolando dentro del tramo que cruza la marca, que si no el
 * resultado depende de dónde cayeran las lecturas). Es el dato que todo el
 * mundo mira después de una carrera y el único que no se puede sacar del ritmo
 * medio: dice de lo que fue capaz, no lo que le salió de media.
 */
function kmMasRapido(pts: TrailPoint[], acumulado: number[]): { minutos: number; desdeKm: number } | null {
  if (pts.length < 2) return null
  let mejor: { minutos: number; desdeKm: number } | null = null
  let i = 0
  for (let j = 1; j < pts.length; j++) {
    const objetivo = acumulado[j] - 1000
    if (objetivo < 0) continue
    while (acumulado[i + 1] <= objetivo) i++
    // Interpolar dentro del tramo [i, i+1] el instante exacto del km redondo.
    const tramo = acumulado[i + 1] - acumulado[i]
    const t = tramo > 0 ? (objetivo - acumulado[i]) / tramo : 0
    const inicio = pts[i].t + t * (pts[i + 1].t - pts[i].t)
    const minutos = (pts[j].t - inicio) / 60_000
    // Un kilómetro en menos de dos minutos es un coche, un salto de GPS o un
    // teleférico; no se premia como récord personal.
    if (minutos <= 2) continue
    if (!mejor || minutos < mejor.minutos) {
      mejor = { minutos, desdeKm: acumulado[i] / 1000 }
    }
  }
  return mejor
}

interface FilaSesion {
  username: string
  bib: string | null
  emoji: string | null
  color: string | null
  status: string | null
  startedAt: number | null
  updatedAt: number | null
  trackKm: number | null
  trail: string | null
}

/**
 * Los resultados de un evento a partir de sus sesiones.
 *
 * `totalKm` es la distancia del recorrido (la sabe quien publicó la base y
 * llega por cabecera); con ella se decide quién llegó a meta —el 97%, que el
 * GPS no clava el último metro—. Sin ella no se declara meta a nadie: mejor no
 * decir nada que dar por finisher a quien se quedó en el km 30.
 */
export function calculaEstadisticas(filas: FilaSesion[], totalKm: number | null): EventStats {
  const corredores: EventRunnerStats[] = []

  for (const f of filas) {
    let pts: TrailPoint[] = []
    if (f.trail) {
      try {
        const parsed = JSON.parse(f.trail) as TrailPoint[]
        if (Array.isArray(parsed)) pts = parsed.filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number')
      } catch { pts = [] }
    }
    pts.sort((a, b) => a.t - b.t)

    // Sin una sola posición no hay resultado que contar: sale con lo que se
    // sabe (que estaba en la parrilla) y sin números inventados.
    if (pts.length === 0) {
      corredores.push({
        username: f.username, bib: f.bib, emoji: f.emoji, color: f.color,
        km: null, minutos: null, ritmoMinKm: null, mejorKmMin: null, mejorKmDesde: null,
        finished: false, finishedAt: null, tracked: false,
      })
      continue
    }

    const acumulado: number[] = [0]
    for (let i = 1; i < pts.length; i++) acumulado.push(acumulado[i - 1] + metros(pts[i - 1], pts[i]))

    // La distancia que vale es la del RECORRIDO si la baliza la reportó: la
    // suma de la traza infla con el ruido del GPS y con los rodeos del
    // avituallamiento. Si no hay km del recorrido, la traza es lo que hay.
    const kmTraza = acumulado[acumulado.length - 1] / 1000
    const km = f.trackKm != null && f.trackKm > 0 ? f.trackKm : kmTraza
    const desde = f.startedAt ?? pts[0].t
    const hasta = pts[pts.length - 1].t
    const minutos = Math.max(0, (hasta - desde) / 60_000)
    const mejor = kmMasRapido(pts, acumulado)
    const finished = totalKm != null && km >= totalKm * 0.97

    corredores.push({
      username: f.username, bib: f.bib, emoji: f.emoji, color: f.color,
      km: Math.round(km * 100) / 100,
      minutos: Math.round(minutos),
      ritmoMinKm: km > 0.5 ? Math.round((minutos / km) * 100) / 100 : null,
      mejorKmMin: mejor ? Math.round(mejor.minutos * 100) / 100 : null,
      mejorKmDesde: mejor ? Math.round(mejor.desdeKm * 10) / 10 : null,
      finished,
      finishedAt: finished ? hasta : null,
      tracked: true,
    })
  }

  // Orden de llegada: primero los que acabaron por hora de meta, luego el resto
  // por kilómetro. Es la clasificación oficiosa, y el que no emitió va al final
  // porque de él no se sabe nada, no porque lo hiciera peor.
  corredores.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    if (a.finished && b.finished) return (a.finishedAt ?? 0) - (b.finishedAt ?? 0)
    if (a.tracked !== b.tracked) return a.tracked ? -1 : 1
    return (b.km ?? -1) - (a.km ?? -1)
  })

  const conKm = corredores.filter((c) => c.mejorKmMin != null)
  const record = conKm.length > 0
    ? conKm.reduce((a, b) => (b.mejorKmMin! < a.mejorKmMin! ? b : a))
    : null

  return {
    at: Date.now(),
    totalKm,
    finishers: corredores.filter((c) => c.finished).length,
    runners: corredores.length,
    /** El kilómetro más rápido de toda la carrera, con su dueño. */
    fastestKm: record
      ? { username: record.username, minutos: record.mejorKmMin!, desdeKm: record.mejorKmDesde! }
      : null,
    corredores,
  }
}

/** Las sesiones que cuentan para los resultados: una por participante, la que manda. */
export async function sesionesDelEvento(env: Env, eventId: string): Promise<FilaSesion[]> {
  const rows = await env.DB.prepare(
    `SELECT u.username AS username, m.bib AS bib, m.emoji AS emoji, m.color AS color,
            t.status AS status, t.started_at AS startedAt, t.updated_at AS updatedAt,
            t.track_km AS trackKm, t.trail AS trail
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
  ).bind(eventId).all<FilaSesion>()
  return rows.results ?? []
}

/**
 * Cierra el evento si ya pasó su hora límite, congelando los resultados.
 *
 * Se llama desde las rutas que LEEN un evento: sin cron, un evento se cierra al
 * primer vistazo posterior a su hora. Devuelve el `ended_at` resultante (o el
 * que ya tenía), para que quien la llame pinte el estado bueno sin releer.
 */
export async function cierraSiTocaEvento(
  env: Env,
  ev: { id: string; endsAt: number | null; endedAt: number | null; planTotalKm?: number | null },
): Promise<number | null> {
  if (ev.endedAt !== null) return ev.endedAt
  if (ev.endsAt === null || Date.now() < ev.endsAt) return null
  await cierraEvento(env, ev.id, ev.endsAt, ev.planTotalKm ?? null)
  return ev.endsAt
}

/** Cierra el evento a la hora dada y guarda los resultados. */
export async function cierraEvento(
  env: Env,
  eventId: string,
  endedAt: number,
  totalKm: number | null,
): Promise<EventStats> {
  const stats = calculaEstadisticas(await sesionesDelEvento(env, eventId), totalKm)
  await env.DB.prepare('UPDATE events SET ended_at = COALESCE(ended_at, ?), stats = ? WHERE id = ?')
    .bind(endedAt, JSON.stringify(stats), eventId).run()
  return stats
}
