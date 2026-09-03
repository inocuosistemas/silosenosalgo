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
/**
 * El kilómetro más rápido medido sobre el AVANCE en el recorrido.
 *
 * Es la versión buena: la traza cruda incluye el temblor del GPS —y sus saltos:
 * en esta misma carrera hay tramos de 127 m en 7 segundos, 65 km/h andando— y
 * medir sobre ella regala kilómetros imposibles a quien peor receptor lleva.
 * Sobre el avance no puede pasar: un salto lateral de treinta metros no mueve
 * el kilómetro del recorrido, que es lo que de verdad se ha progresado.
 */
function kmMasRapidoEnRuta(serie: [number, number][]): { minutos: number; desdeKm: number } | null {
  if (serie.length < 2) return null
  let mejor: { minutos: number; desdeKm: number } | null = null
  for (let j = 1; j < serie.length; j++) {
    const objetivo = serie[j][1] - 1
    if (objetivo < 0) continue
    // Hacia ATRÁS desde j hasta el último momento en que iba un kilómetro por
    // detrás. Hacia atrás y no con un puntero que avanza porque la serie NO es
    // monótona: quien llega a la salida andando por el último tramo del
    // circuito empieza en el km 7 y baja hasta el 3, y un puntero que solo sabe
    // avanzar se queda encallado en el primer punto y no encuentra nada.
    let i = -1
    for (let k = j - 1; k >= 0; k--) {
      if (serie[k][1] <= objetivo) { i = k; break }
    }
    if (i < 0) continue
    const tramo = serie[i + 1][1] - serie[i][1]
    if (tramo <= 0) continue
    const t = (objetivo - serie[i][1]) / tramo
    const inicio = serie[i][0] + t * (serie[i + 1][0] - serie[i][0])
    const minutos = (serie[j][0] - inicio) / 60_000
    // Menos de dos minutos por kilómetro no lo hace nadie a pie: es un salto
    // de GPS, y precisamente de eso va este cálculo.
    if (minutos <= 2) continue
    if (!mejor || minutos < mejor.minutos) mejor = { minutos, desdeKm: serie[i][1] }
  }
  return mejor
}

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

/** El trazado guardado del evento: [lat, lon, kmAcumulado] por punto. */
export type Polilinea = [number, number, number][]

/**
 * El kilómetro del recorrido más lejano que alcanzó una traza.
 *
 * Se recorre la traza EN ORDEN proyectando cada posición sobre el trazado, y
 * cada proyección busca solo en una ventana alrededor del kilómetro anterior.
 * Eso es lo que hace que funcione en un circuito que acaba donde empieza: sin
 * la ventana, el punto más cercano al volver a meta es el de la salida y el
 * avance se desploma a cero justo al terminar.
 *
 * Se devuelve el MÁXIMO alcanzado y no el último: quien cruza meta y sigue
 * andando hasta el coche no des-corre la carrera.
 */
interface Avance {
  /** El kilómetro más lejano alcanzado. */
  km: number
  /** Cuándo se alcanzó (epoch ms): el momento de cruzar meta, si llegó. */
  enMs: number
  /** Cuándo pisó el recorrido por primera vez: el crono empieza ahí. */
  desdeMs: number
  /** El avance punto a punto: [hora, kilómetro del recorrido]. */
  serie: [number, number][]
}

function avanceSobreRuta(linea: Polilinea, pts: TrailPoint[], toleranciaM = 250): Avance | null {
  if (linea.length < 2 || pts.length === 0) return null
  let previo: number | null = null
  let max = 0
  let enMs = pts[0].t
  let desdeMs: number | null = null
  let dentro = 0
  const serie: [number, number][] = []
  for (const p of pts) {
    let desde = 0
    let hasta = linea.length - 1
    if (previo !== null) {
      while (desde < linea.length && linea[desde][2] < previo - 3) desde++
      hasta = desde
      while (hasta + 1 < linea.length && linea[hasta + 1][2] <= previo + 3) hasta++
      if (desde > hasta) desde = hasta
    }
    let mejor = -1
    let mejorD = Infinity
    for (let i = desde; i <= hasta; i++) {
      const d = metros({ t: 0, lat: p.lat, lon: p.lon }, { t: 0, lat: linea[i][0], lon: linea[i][1] })
      if (d < mejorD) { mejorD = d; mejor = i }
    }
    if (mejor < 0 || mejorD > toleranciaM) continue
    previo = linea[mejor][2]
    dentro++
    if (desdeMs === null) desdeMs = p.t
    serie.push([p.t, previo])
    if (previo > max) { max = previo; enMs = p.t }
  }
  // Sin ningún punto sobre el recorrido no se sabe nada: fue por otro sitio, o
  // el trazado guardado no es el de esta carrera.
  return dentro > 0 ? { km: max, enMs, desdeMs: desdeMs ?? pts[0].t, serie } : null
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
export function calculaEstadisticas(
  filas: FilaSesion[],
  totalKm: number | null,
  linea: Polilinea | null = null,
  /** La salida OFICIAL de la carrera: el pistoletazo, si lo hay. */
  startsAt: number | null = null,
): EventStats {
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

    // Lo que vale es el AVANCE SOBRE EL RECORRIDO, y por este orden: el
    // proyectado contra el trazado guardado (lo mejor: no lo infla el ruido ni
    // lo acorta perder cobertura al final), el que reportó la baliza, y solo
    // como último recurso la suma de la traza — que mide otra cosa y es lo que
    // daba 8,69 km en una carrera de 7,46.
    const kmTraza = acumulado[acumulado.length - 1] / 1000
    const avance = linea ? avanceSobreRuta(linea, pts) : null
    const km = avance?.km ?? (f.trackKm != null && f.trackKm > 0 ? f.trackKm : kmTraza)

    // El crono empieza en la SALIDA OFICIAL, como en cualquier carrera. Es lo
    // único que hace comparables los tiempos de gente que fue junta: la hora a
    // la que cada uno encendió su baliza no la decide la carrera, y "la primera
    // vez que pisa el recorrido" tampoco vale —quien llega a la salida andando
    // por el último tramo del circuito la pisa media hora antes, y su crono
    // arrancaba ahí—. Sin salida oficial se cae a lo mejor que hay: el primer
    // punto sobre el recorrido.
    //
    // Y termina al alcanzar el punto más lejano —cruzar meta— y no en la última
    // posición, que suele ser el aparcamiento.
    const desde = startsAt ?? avance?.desdeMs ?? f.startedAt ?? pts[0].t
    // Cruzar meta es la PRIMERA vez que se llega al final habiendo hecho antes
    // el recorrido. Las dos mitades importan: "la primera vez" porque el punto
    // más lejano se puede volver a rozar después, andando de vuelta al coche, y
    // eso alargaría el crono; y "habiendo hecho el recorrido" porque en un
    // circuito la meta es el mismo sitio que la salida, así que quien llega
    // andando por el último tramo ya está en el 97% antes de empezar —a JM le
    // pasó, y su meta habría quedado fijada a las 05:31—.
    const hasta = crucaMeta(avance?.serie ?? [], totalKm) ?? avance?.enMs ?? pts[pts.length - 1].t
    const minutos = Math.max(0, (hasta - desde) / 60_000)
    // Sobre el avance si lo hay; si no, sobre la traza, que es lo que queda.
    const mejor = (avance ? kmMasRapidoEnRuta(avance.serie) : null) ?? kmMasRapido(pts, acumulado)
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

/**
 * Los resultados guardados de un evento.
 *
 * Se le pasa lo que ya se leyó de la fila para no ir dos veces a la base; si
 * viene vacío —porque el cierre acaba de ocurrir en esta misma petición— se
 * releen.
 */
export async function leeStats(env: Env, id: string, crudos: string | null): Promise<EventStats | null> {
  let raw = crudos
  if (!raw) {
    const row = await env.DB.prepare('SELECT stats FROM events WHERE id = ?')
      .bind(id).first<{ stats: string | null }>()
    raw = row?.stats ?? null
  }
  if (!raw) return null
  try { return JSON.parse(raw) as EventStats } catch { return null }
}

/**
 * El instante de cruzar meta: la primera llegada al final DESPUÉS de haber
 * pasado por la mitad del recorrido.
 */
function crucaMeta(serie: [number, number][], totalKm: number | null): number | null {
  if (totalKm === null || serie.length === 0) return null
  const meta = totalKm * 0.97
  const mitad = totalKm * 0.5
  let hecho = false
  for (const [t, km] of serie) {
    if (km <= mitad) hecho = true
    else if (hecho && km >= meta) return t
  }
  return null
}

/** El trazado simplificado del evento, si lo tiene. */
export async function leePolilinea(env: Env, eventId: string): Promise<Polilinea | null> {
  const row = await env.DB.prepare('SELECT plan_polyline AS linea FROM events WHERE id = ?')
    .bind(eventId).first<{ linea: string | null }>()
  if (!row?.linea) return null
  try {
    const parsed = JSON.parse(row.linea) as Polilinea
    return Array.isArray(parsed) && parsed.length > 1 ? parsed : null
  } catch { return null }
}

/** Cierra el evento a la hora dada y guarda los resultados. */
export async function cierraEvento(
  env: Env,
  eventId: string,
  endedAt: number,
  totalKm: number | null,
): Promise<EventStats> {
  const linea = await leePolilinea(env, eventId)
  const ev = await env.DB.prepare('SELECT starts_at AS startsAt FROM events WHERE id = ?')
    .bind(eventId).first<{ startsAt: number | null }>()
  const stats = calculaEstadisticas(
    await sesionesDelEvento(env, eventId), totalKm, linea, ev?.startsAt ?? null,
  )
  await env.DB.prepare('UPDATE events SET ended_at = COALESCE(ended_at, ?), stats = ? WHERE id = ?')
    .bind(endedAt, JSON.stringify(stats), eventId).run()
  return stats
}
