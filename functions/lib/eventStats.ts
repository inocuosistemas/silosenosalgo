/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'
import { crucaMeta } from '../../shared/cruceMeta'
import type { TrailPoint, EventStats, EventRunnerStats } from '../../shared/wireTypes'

/**
 * lib/eventStats.ts — los resultados de una carrera, congelados al cerrarla.
 *
 * Se calculan UNA vez, al cerrar el evento, y se guardan como JSON. No es una
 * optimización: las trazas SE BORRAN, y no en un plazo que decidamos nosotros
 * sino el que eligió cada corredor en su baliza al terminar —el selector
 * ofrece de 6 horas a una semana, y viene en 48 h—. O sea que la traza del que
 * puso 6 horas desaparece esa misma tarde. Si los resultados no se congelan, el
 * lunes no se puede decir quién ganó el sábado. La porra depende de lo mismo
 * —se puntúa contra quién llegó a meta y cuándo—, y un ranking que se vacía
 * solo no es un ranking.
 *
 * Consecuencia práctica que conviene no olvidar: el evento se cierra en el
 * primer vistazo posterior a su hora de cierre, así que ese vistazo tiene que
 * pasar mientras las trazas siguen ahí. Nadie mira la parrilla el lunes para
 * enterarse de que se cerró sola con las manos vacías.
 *
 * Todo sale de lo que ya hay guardado: la traza (hasta 2000 puntos con su hora
 * de GPS) y el kilómetro sobre el recorrido que reporta cada baliza. No hace
 * falta abrir el payload del recorrido —el servidor no lo abre nunca— porque
 * el km lo calcula quien corre, que es quien lo sabe.
 */

/**
 * Lo que se puede hacer de verdad con cada actividad.
 *
 * `maxKmh` corta los saltos del GPS —lo que no es posible moviéndose así— y
 * `minMinPorKm` es el suelo por debajo del cual un "kilómetro rapidísimo" es un
 * salto y no una marca. Los dos tienen que depender de la actividad: 12 km/h
 * andando es imposible y en bici es ir de paseo; un kilómetro en dos minutos es
 * un salto a pie y una bajada normal sobre ruedas.
 */
const LIMITES: Record<string, { maxKmh: number; minMinPorKm: number }> = {
  walk: { maxKmh: 12, minMinPorKm: 4 },
  run: { maxKmh: 25, minMinPorKm: 2.5 },
  bike: { maxKmh: 80, minMinPorKm: 0.75 },
}
/** Sin actividad declarada, lo prudente es el techo más alto: mejor colar un
 *  salto raro que recortarle la marca a un ciclista. */
const LIMITE_POR_DEFECTO = { maxKmh: 80, minMinPorKm: 0.75 }

/**
 * La traza sin los saltos del receptor: un punto que exige ir más rápido de lo
 * que permite la actividad no es una posición, es ruido. Se descarta el punto y
 * se sigue comparando contra el último bueno, para que un salto y su vuelta no
 * cuenten como dos tramos imposibles.
 *
 * Lo usan los RESULTADOS y el REPLAY: si el número dice que nadie corrió a 65
 * km/h, la línea del mapa tampoco puede dibujarlo. Devuelve la traza tal cual
 * cuando el filtro se lo llevaría casi todo — con dos puntos malos no se
 * reconstruye nada mejor que lo que llegó.
 */
export function sinSaltos(pts: TrailPoint[], actividad: string | null | undefined): TrailPoint[] {
  const lim = limitesDe(actividad)
  const out: TrailPoint[] = []
  for (const p of pts) {
    const ant = out[out.length - 1]
    if (ant) {
      const dt = (p.t - ant.t) / 1000
      if (dt > 0 && (metros(ant, p) / dt) * 3.6 > lim.maxKmh) continue
    }
    out.push(p)
  }
  return out
}

function limitesDe(actividad: string | null | undefined) {
  return (actividad && LIMITES[actividad]) || LIMITE_POR_DEFECTO
}

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
function kmMasRapidoEnRuta(serie: [number, number, number][], minMinPorKm: number): { minutos: number; desdeKm: number } | null {
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
    // Por debajo del suelo de la actividad no es una marca, es un salto del
    // receptor: cuatro minutos por kilómetro andando, dos y medio corriendo,
    // cuarenta y cinco segundos en bici.
    if (minutos <= minMinPorKm) continue
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
  /**
   * El avance punto a punto: [hora, kilómetro del recorrido, metros andados
   * desde la lectura anterior].
   *
   * Los metros van aparte porque NO son la diferencia de kilómetros: al cruzar
   * la meta el recorrido se acaba y la proyección se queda clavada en el final,
   * pero la persona sigue andando. Esa diferencia es justo la que hace falta
   * para cronometrar el cruce (ver `crucaMeta`).
   */
  serie: [number, number, number][]
}

/**
 * A qué distancia queda un punto de un SEGMENTO del trazado, y por dónde.
 *
 * Proyectar sobre el vértice más cercano deja la resolución a merced de lo
 * fino que sea el trazado guardado, y el guardado tiene un techo de 800
 * puntos: en un circuito de 7 km son 11 metros entre vértices, pero en una
 * ultra de 160 km son doscientos. Proyectando sobre el segmento el kilómetro
 * sale con precisión de metros mida lo que mida la carrera.
 *
 * En metros planos locales: a esta escala la diferencia con la esfera es
 * despreciable y evita tres senos y un arcoseno por vértice.
 */
function enSegmento(
  p: { lat: number; lon: number }, a: [number, number, number], b: [number, number, number],
): { d: number; km: number } {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180)
  const ky = 110_540
  const ax = (a[1] - p.lon) * kx, ay = (a[0] - p.lat) * ky
  const bx = (b[1] - p.lon) * kx, by = (b[0] - p.lat) * ky
  const dx = bx - ax, dy = by - ay
  const largo = dx * dx + dy * dy
  const f = largo > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo)) : 0
  return { d: Math.hypot(ax + f * dx, ay + f * dy), km: a[2] + f * (b[2] - a[2]) }
}

/**
 * Cuánto margen hay que dar a la meta, en kilómetros.
 *
 * No un porcentaje: el 3% de un circuito de 7 km son doscientos metros, pero
 * el de una ultra de 160 son casi cinco kilómetros —quien abandona a cuatro
 * del final saldría como que llegó—. Es una distancia, y solo se estira si el
 * trazado guardado es tan basto que no puede afinar más: cincuenta metros de
 * suelo, o media separación entre vértices si esta es mayor.
 */
function toleranciaMeta(linea: Polilinea): number {
  const seps: number[] = []
  for (let i = 1; i < linea.length; i++) seps.push(linea[i][2] - linea[i - 1][2])
  if (seps.length === 0) return 0.05
  seps.sort((a, b) => a - b)
  return Math.max(0.05, (seps[Math.floor(seps.length / 2)] ?? 0) / 2)
}

/**
 * A cuánto del trazado deja de contar una lectura.
 *
 * Cuatrocientos metros, y no doscientos cincuenta como antes. Lo dice la
 * carrera de hoy: once lecturas cayeron entre 80 y 250 metros del recorrido
 * publicado CON UNA PRECISIÓN DE GPS DE CINCO METROS —o sea, el corredor estaba
 * de verdad ahí— y una tocó justo el umbral. No era un fallo del receptor: era
 * el recorrido, que la organización cambió a última hora por unos trabajos
 * forestales y avisó de que el track publicado no lo recogía.
 *
 * Eso va a volver a pasar: un desvío señalizado, un tramo cortado, una
 * variante por mal tiempo. Y descartar esas lecturas es lo peor que se puede
 * hacer, porque congela el kilómetro de quien está corriendo perfectamente.
 * Cuatrocientos metros siguen dejando fuera lo que hay que dejar fuera —quien
 * se ha ido a otro valle, o el coche que pasa por la carretera de al lado— y ya
 * no castigan a quien sigue las cintas.
 */
const FUERA_DE_RUTA_M = 400

function avanceSobreRuta(linea: Polilinea, pts: TrailPoint[], toleranciaM = FUERA_DE_RUTA_M): Avance | null {
  if (linea.length < 2 || pts.length === 0) return null
  let previo: number | null = null
  let max = 0
  let enMs = pts[0].t
  let desdeMs: number | null = null
  let dentro = 0
  const serie: [number, number, number][] = []
  let anterior: TrailPoint | null = null
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
    // Afinar sobre los dos segmentos que salen de ese vértice: el punto casi
    // nunca cae justo encima de uno, y quedarse en el vértice redondea el
    // kilómetro a la resolución del trazado.
    let km = linea[mejor][2]
    let dMin = mejorD
    for (const [i, j] of [[mejor - 1, mejor], [mejor, mejor + 1]]) {
      if (i < 0 || j >= linea.length) continue
      const r = enSegmento(p, linea[i], linea[j])
      if (r.d < dMin) { dMin = r.d; km = r.km }
    }
    previo = km
    dentro++
    if (desdeMs === null) desdeMs = p.t
    serie.push([p.t, previo, anterior ? metros(anterior, p) : 0])
    anterior = p
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
  /** De qué va la carrera: manda en los filtros de velocidad. */
  actividad: string | null = null,
): EventStats {
  const corredores: EventRunnerStats[] = []
  // Cuánto margen da la meta: lo que el trazado guardado permite afinar, y
  // nunca menos de cincuenta metros. Es de la CARRERA, no de cada corredor.
  const tolMeta = linea ? toleranciaMeta(linea) : (totalKm ?? 0) * 0.03
  // ¿Acaba donde empieza? Un circuito necesita precauciones que un punto a
  // punto no: en él, estar en la meta y estar en la salida es lo mismo.
  const circuito = linea !== null && linea.length > 1
    && metros(
      { t: 0, lat: linea[0][0], lon: linea[0][1] },
      { t: 0, lat: linea[linea.length - 1][0], lon: linea[linea.length - 1][1] },
    ) < 200

  for (const f of filas) {
    let pts: TrailPoint[] = []
    if (f.trail) {
      try {
        const parsed = JSON.parse(f.trail) as TrailPoint[]
        if (Array.isArray(parsed)) pts = parsed.filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number')
      } catch { pts = [] }
    }
    pts.sort((a, b) => a.t - b.t)
    // Fuera los saltos del receptor: un punto que exige ir más rápido de lo que
    // permite la actividad no es una posición, es ruido. Se descarta el punto y
    // se sigue comparando contra el último bueno, para que un salto y su vuelta
    // no cuenten como dos tramos imposibles.
    const lim = limitesDe(actividad)
    const limpios = sinSaltos(pts, actividad)
    if (limpios.length >= 2) pts = limpios

    // Sin una sola posición no hay resultado que contar: sale con lo que se
    // sabe (que estaba en la parrilla) y sin números inventados.
    if (pts.length === 0) {
      corredores.push({
        username: f.username, bib: f.bib, emoji: f.emoji, color: f.color,
        km: null, minutos: null, ritmoMinKm: null, mejorKmMin: null, mejorKmDesde: null,
        finished: false, finishedAt: null, margenMs: null, puesto: null, tracked: false,
        abandono: false,
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
    const cruce = crucaMeta(avance?.serie ?? [], totalKm, tolMeta, circuito)
    const hasta = cruce?.ms ?? avance?.enMs ?? pts[pts.length - 1].t
    const minutos = Math.max(0, (hasta - desde) / 60_000)
    // Y TODO se mide dentro de la carrera. Cruzada la meta se acaba: volver
    // andando al coche, dar la vuelta a por el que viene detrás o irse a
    // desayunar no son parte de la prueba, y medir ahí regala o roba marcas —el
    // camino de vuelta en coche a 20 km/h es el kilómetro más rápido de
    // cualquiera—. Como la serie va ordenada por hora, quedarse en la meta es
    // quedarse con el principio.
    const finDeCarrera = (t: number) => t <= hasta
    const serieCarrera = (avance?.serie ?? []).filter(([t]) => finDeCarrera(t))
    let nPts = pts.length
    while (nPts > 1 && !finDeCarrera(pts[nPts - 1].t)) nPts--
    // Sobre el avance si lo hay; si no, sobre la traza, que es lo que queda.
    const mejor = (avance ? kmMasRapidoEnRuta(serieCarrera, lim.minMinPorKm) : null)
      ?? kmMasRapido(pts.slice(0, nPts), acumulado.slice(0, nPts))
    // Llegar es haber CRUZADO la línea, no haber estado cerca del final alguna
    // vez. La diferencia importa en un circuito: quien llega andando a la
    // salida por el último tramo pisa el kilómetro final antes de empezar, y
    // por el máximo alcanzado salía como llegado sin haber corrido.

    corredores.push({
      username: f.username, bib: f.bib, emoji: f.emoji, color: f.color,
      km: Math.round(km * 100) / 100,
      minutos: Math.round(minutos),
      ritmoMinKm: km > 0.5 ? Math.round((minutos / km) * 100) / 100 : null,
      mejorKmMin: mejor ? Math.round(mejor.minutos * 100) / 100 : null,
      mejorKmDesde: mejor ? Math.round(mejor.desdeKm * 10) / 10 : null,
      finished: cruce !== null,
      finishedAt: cruce?.ms ?? null,
      margenMs: cruce ? Math.round(cruce.margenMs) : null,
      puesto: null,
      tracked: true,
      // Paró la baliza sin cruzar: se retiró. Apagarla es decir "para mí se ha
      // acabado", y si no pasó por meta, la única lectura posible es esa.
      abandono: cruce === null && f.status === 'ended',
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

  // El PUESTO, con los empates que el cronómetro no puede deshacer.
  //
  // Cada llegada es un intervalo [hora - margen, hora + margen], no un
  // instante. Si el siguiente pudo llegar antes que el anterior —si los
  // intervalos se tocan— ponerlos en fila es inventarse un resultado: se
  // reparte el mismo puesto y el siguiente número se salta los empatados, como
  // en cualquier clasificación. Si la carrera se midió con lecturas cada dos
  // minutos, es muy posible que acaben todos en el primer puesto: incómodo,
  // pero es lo que se sabe.
  //
  // La cadena es transitiva a propósito: si A se solapa con B y B con C, los
  // tres comparten puesto aunque A y C no se toquen. Deshacer ese empate
  // pidiendo un orden entre A y C exigiría creerse una precisión que no está.
  let puesto = 0
  let colocados = 0
  let topeGrupo = -Infinity
  for (const c of corredores) {
    if (!c.finished || c.finishedAt === null) break
    const m = c.margenMs ?? 0
    if (c.finishedAt - m > topeGrupo) {
      // Llega limpiamente después del grupo anterior: puesto nuevo, saltándose
      // tantos números como empatados hubiera antes.
      puesto = colocados + 1
      topeGrupo = c.finishedAt + m
    } else {
      topeGrupo = Math.max(topeGrupo, c.finishedAt + m)
    }
    c.puesto = puesto
    colocados++
  }

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
/** Los resultados tal como están AHORA, sin guardarlos ni cerrar nada. */
async function calculaAhora(env: Env, eventId: string, totalKm: number | null): Promise<EventStats> {
  const linea = await leePolilinea(env, eventId)
  const ev = await env.DB.prepare('SELECT starts_at AS startsAt, activity FROM events WHERE id = ?')
    .bind(eventId).first<{ startsAt: number | null; activity: string | null }>()
  return calculaEstadisticas(
    await sesionesDelEvento(env, eventId), totalKm, linea, ev?.startsAt ?? null, ev?.activity ?? null,
  )
}

export async function cierraEvento(
  env: Env,
  eventId: string,
  endedAt: number,
  totalKm: number | null,
): Promise<EventStats> {
  const stats = await calculaAhora(env, eventId, totalKm)

  // Un cierre NO puede vaciar unos resultados que ya estaban bien.
  //
  // El cierre ocurre en el primer vistazo posterior a la hora de cierre, y ese
  // vistazo puede ser el lunes. Para entonces las trazas pueden haberse borrado
  // —cada corredor elige su plazo al terminar la baliza, y hay quien deja seis
  // horas—, y recalcular sobre nada devuelve una tabla en la que no corrió
  // nadie. Si ya había resultados con datos, mandan ellos: unos resultados
  // viejos y buenos valen infinitamente más que unos recién hechos y vacíos.
  const previos = await leeStats(env, eventId, null)
  const vacios = stats.corredores.every((c) => !c.tracked)
  const habia = previos?.corredores.some((c) => c.tracked) ?? false
  if (vacios && habia) {
    await env.DB.prepare('UPDATE events SET ended_at = COALESCE(ended_at, ?) WHERE id = ?')
      .bind(endedAt, eventId).run()
    return previos!
  }

  await env.DB.prepare('UPDATE events SET ended_at = COALESCE(ended_at, ?), stats = ?, stats_at = ? WHERE id = ?')
    .bind(endedAt, JSON.stringify(stats), Date.now(), eventId).run()
  return stats
}

/** Cada cuánto se refresca la foto provisional de una carrera en marcha. */
const FOTO_CADA_MS = 3 * 60 * 1000

/**
 * La foto de cómo va la carrera, guardada por si acaso.
 *
 * No cierra nada ni se enseña: los resultados solo se leen cuando el evento
 * está terminado. Es un SEGURO contra el único caso en que se pierde todo —que
 * nadie mire la carrera hasta días después de su hora de cierre y para entonces
 * las trazas ya no estén—, y contra el organizador que se olvida de cerrarla.
 *
 * Cerrar sola en cuanto llega el último a meta sería peor remedio: "el último"
 * no se puede saber —quien abandona y apaga la baliza se ve igual que quien
 * sigue en el monte sin cobertura—, y cerrar quita la carrera de la lista de
 * las balizas de quienes aún corren.
 *
 * Cada diez minutos como mucho, y solo con la carrera empezada: leer las trazas
 * de todos en cada refresco de la parrilla sería tirar trabajo para no cambiar
 * nada.
 */
export async function fotoDeResultadosSiToca(
  env: Env,
  ev: { id: string; startsAt: number | null; endedAt: number | null; statsAt: number | null; planTotalKm: number | null },
): Promise<void> {
  if (ev.endedAt !== null) return
  const now = Date.now()
  if (ev.startsAt === null || now < ev.startsAt) return
  if (ev.statsAt !== null && now - ev.statsAt < FOTO_CADA_MS) return
  const stats = await calculaAhora(env, ev.id, ev.planTotalKm)

  /**
   * Si han llegado TODOS, la carrera se ha terminado sola.
   *
   * Hasta ahora una prueba solo acababa a su hora de cierre o cuando el
   * organizador le daba, y eso deja la pantalla diciendo "en marcha" horas
   * después de que el último cruzara el arco —con la meta ya recogida—.
   *
   * "Todos" son los que EMITIERON: quien se apuntó y no se presentó no puede
   * dejar una carrera abierta para siempre. Y "resuelto" es haber CRUZADO o
   * haber ABANDONADO —parar la baliza sin cruzar—, que son las dos formas de
   * que la carrera de alguien haya terminado. Quien lleva horas sin señal no
   * cuenta como ninguna de las dos: puede estar andando por una zona sin
   * cobertura, y cerrar por ahí sería dar la prueba por acabada con gente
   * todavía en el monte.
   *
   * Y termina cuando cruzó el último, no ahora: la carrera se acabó en ese
   * instante, no cuando alguien abrió la pantalla y se dio cuenta.
   */
  const enCarrera = stats.corredores.filter((c) => c.tracked)
  const resueltos = enCarrera.filter((c) => c.finished || c.abandono)
  if (enCarrera.length > 0 && resueltos.length === enCarrera.length) {
    // La hora de la última llegada; si no llegó nadie —todos se retiraron— la
    // de ahora, que es lo único que se sabe.
    const llegadas = enCarrera.map((c) => c.finishedAt).filter((t): t is number => t !== null)
    await cierraEvento(env, ev.id, llegadas.length > 0 ? Math.max(...llegadas) : now, ev.planTotalKm)
    return
  }
  // Una foto sin nadie no sustituye a una con gente: al principio de la carrera
  // todavía no hay trazas, y sería empezar borrando lo del intento anterior.
  const previos = await leeStats(env, ev.id, null)
  if (stats.corredores.every((c) => !c.tracked) && (previos?.corredores.some((c) => c.tracked) ?? false)) {
    await env.DB.prepare('UPDATE events SET stats_at = ? WHERE id = ?').bind(now, ev.id).run()
    return
  }
  await env.DB.prepare('UPDATE events SET stats = ?, stats_at = ? WHERE id = ?')
    .bind(JSON.stringify(stats), now, ev.id).run()
}
