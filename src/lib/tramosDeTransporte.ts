import type { TrailPoint } from '../../shared/wireTypes'
import { haversineKm } from './liveTrack'

/**
 * Una salida en «Automático» —sin ruta ni evento— partida en TRAMOS por medio
 * de transporte: andando hasta la estación, tren, barco, otra vez andando…
 *
 * Dos fuentes, y la primera manda cuando la hay:
 *  · el SENSOR de movimiento del móvil (`TrailPoint.m`): distingue bien a pie,
 *    corriendo, bici y «en vehículo», que es lo que la velocidad sola confunde
 *    (un coche en un atasco va a paso de persona; una bici, a paso de coche en
 *    ciudad);
 *  · la VELOCIDAD, para los puntos sin sensor (salidas de antes, o móviles sin
 *    él), por tramos enteros y no por puntos sueltos.
 *
 * Lo que el sensor no distingue —coche, tren o barco, los tres «en vehículo»—
 * lo pone el MAPA después (`refinaVehiculos`): sobre el agua es barco, por la
 * vía es tren, lo demás coche.
 *
 * Los cambios de menos de un par de minutos no son cambios: un semáforo, bajar
 * del coche a abrir una verja, el GPS que titubea. Se funden con lo de al lado.
 */

export type Modo = 'parado' | 'pie' | 'correr' | 'bici' | 'vehiculo' | 'coche' | 'tren' | 'barco' | 'avion'

export interface Tramo {
  modo: Modo
  /** Índices del primer y último punto del tramo (inclusive). */
  i0: number
  i1: number
  desde: number
  hasta: number
  km: number
  /** Velocidad media en movimiento (km/h). */
  kmh: number
  /** Si el medio lo ha puesto a mano su dueño (ver `aplicaAjustes`). */
  corregido?: boolean
  /** Si lo decidió el sensor del móvil (y no la velocidad sola). */
  sensor?: boolean
}

export const MODOS: Record<Modo, { emoji: string; nombre: string; color: string }> = {
  parado: { emoji: '⏸', nombre: 'Parado', color: '#94a3b8' },
  pie: { emoji: '🚶', nombre: 'A pie', color: '#22c55e' },
  correr: { emoji: '🏃', nombre: 'Corriendo', color: '#eab308' },
  bici: { emoji: '🚴', nombre: 'En bici', color: '#14b8a6' },
  vehiculo: { emoji: '🚗', nombre: 'En vehículo', color: '#f97316' },
  coche: { emoji: '🚗', nombre: 'En coche', color: '#f97316' },
  tren: { emoji: '🚆', nombre: 'En tren', color: '#a855f7' },
  barco: { emoji: '⛴️', nombre: 'En barco', color: '#0ea5e9' },
  avion: { emoji: '✈️', nombre: 'En avión', color: '#f43f5e' },
}

/** Los que se miden en ritmo (min/km) y no en km/h. */
export const esAPie = (m: Modo) => m === 'pie' || m === 'correr'

/** Más rápido que esto, en cualquier medio, es avión. */
const AVION_KMH = 250
/** Por debajo, parado (o el GPS temblando). */
const PARADO_KMH = 1.5
/** Un tramo que dura menos que esto no es un cambio de medio. */
const TRAMO_MIN_MS = 2 * 60_000
/** Una parada más corta que esto es parte de lo que se iba haciendo
 *  (semáforo, estación, cola del ferry). */
const PARADA_MIN_MS = 5 * 60_000

/** Las bandas de velocidad, las mismas que `inferActivity`. */
function banda(kmh: number): Modo {
  if (kmh > AVION_KMH) return 'avion'
  if (kmh < 8) return 'pie'
  if (kmh < 16) return 'correr'
  if (kmh < 40) return 'bici'
  return 'vehiculo'
}

/** Por velocidad sola, sobre un tramo entero: su percentil 85 —un ciclista
 *  parado en un semáforo sigue siendo ciclista—. */
function porVelocidad(kmhs: number[]): Modo {
  if (kmhs.length === 0) return 'parado'
  const s = [...kmhs].sort((a, b) => a - b)
  return banda(s[Math.min(s.length - 1, Math.floor(s.length * 0.85))])
}

/** Un minuto a cada lado: lo que se mira para decidir un punto sin sensor. */
const VENTANA_MS = 60_000

/** Lo que dice el sensor en un segmento, si lo dice. */
function porSensor(m: TrailPoint['m'], kmh: number): Modo | 'movil' | null {
  if (kmh > AVION_KMH) return 'avion'
  switch (m) {
    case 'v': return 'vehiculo'
    case 'b': return 'bici'
    case 'r': return 'correr'
    // A pie, pero a 30 por hora: el sensor tarda en darse cuenta de que se ha
    // subido a algo.
    case 'w': return kmh > 25 ? 'vehiculo' : 'pie'
    case 'q': return kmh < 3 ? 'parado' : 'movil'
    default: return null
  }
}

interface Crudo { modo: Modo | 'movil'; i0: number; i1: number; ms: number; km: number; kmhs: number[]; sensorMs: number }

export function tramosDeTransporte(trail: TrailPoint[]): Tramo[] {
  if (trail.length < 2) return []

  // 1. Cada segmento, con su etiqueta: la del sensor si lo hay; si no, por la
  //    velocidad del minuto que lo rodea, medida por lo RECORRIDO en ese
  //    minuto (metros entre segundos) y no trocito a trocito. Andando despacio
  //    con el GPS a 15 m, la baliza repite la posición anclada mientras no se
  //    ha movido más que el ruido y luego salta: 0 m, 0 m, 26 m… Trocito a
  //    trocito eso es «parado, parado, 9 km/h»; en el minuto, 3 km/h, que es lo
  //    que se iba. La de velocidad es provisional: al final se decide por el
  //    tramo entero, con estas mismas velocidades del minuto.
  const base: { ms: number; km: number; kmh: number; t: number }[] = []
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i]
    const ms = Math.max(0, b.t - a.t)
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon)
    base.push({ ms, km, kmh: ms > 0 ? km / (ms / 3_600_000) : 0, t: b.t })
  }
  const seg: { modo: Modo | 'movil'; ms: number; km: number; kmh: number; sensor: boolean }[] = []
  let lo = 0, hi = 0, kmVentana = 0, msVentana = 0
  base.forEach((s, k) => {
    // Ventana deslizante [t - 1 min, t + 1 min], con sumas que entran y salen.
    while (hi < base.length && base[hi].t <= s.t + VENTANA_MS) { kmVentana += base[hi].km; msVentana += base[hi].ms; hi++ }
    while (lo < hi && base[lo].t < s.t - VENTANA_MS) { kmVentana -= base[lo].km; msVentana -= base[lo].ms; lo++ }
    const enVentana = msVentana > 0 ? kmVentana / (msVentana / 3_600_000) : s.kmh
    // Un trocito largo (sin señal un rato) lleva su propia media.
    const kmh = s.ms > VENTANA_MS ? s.kmh : enVentana
    const sensor = porSensor(trail[k + 1].m, s.kmh)
    if (sensor) { seg.push({ ...s, kmh, modo: sensor, sensor: true }); return }
    seg.push({ ...s, kmh, modo: kmh < PARADO_KMH ? 'parado' : banda(kmh), sensor: false })
  })

  // 2. En rachas del mismo modo.
  let rachas: Crudo[] = []
  seg.forEach((s, k) => {
    const ult = rachas[rachas.length - 1]
    if (ult && ult.modo === s.modo) {
      ult.i1 = k + 1; ult.ms += s.ms; ult.km += s.km
      if (s.sensor) ult.sensorMs += s.ms
      if (s.kmh >= PARADO_KMH) ult.kmhs.push(s.kmh)
    } else {
      rachas.push({
        modo: s.modo, i0: k, i1: k + 1, ms: s.ms, km: s.km,
        kmhs: s.kmh >= PARADO_KMH ? [s.kmh] : [], sensorMs: s.sensor ? s.ms : 0,
      })
    }
  })

  // 3. Lo que no es un cambio se funde con lo de al lado: primero las paradas
  //    cortas, luego los tramos cortos, siempre el más corto primero y con el
  //    vecino más largo (que es el que se estaba haciendo).
  const corto = (r: Crudo) => r.modo === 'parado' ? r.ms < PARADA_MIN_MS : r.ms < TRAMO_MIN_MS
  const funde = (lista: Crudo[], k: number, con: number) => {
    const a = lista[Math.min(k, con)], b = lista[Math.max(k, con)]
    const destino = lista[con]
    const junto: Crudo = {
      modo: destino.modo, i0: a.i0, i1: b.i1, ms: a.ms + b.ms, km: a.km + b.km,
      kmhs: [...a.kmhs, ...b.kmhs], sensorMs: a.sensorMs + b.sensorMs,
    }
    lista.splice(Math.min(k, con), 2, junto)
  }
  for (;;) {
    let peor = -1
    rachas.forEach((r, k) => {
      if (rachas.length > 1 && corto(r) && (peor < 0 || r.ms < rachas[peor].ms)) peor = k
    })
    if (peor < 0) break
    const izq = peor > 0 ? rachas[peor - 1] : null
    const der = peor < rachas.length - 1 ? rachas[peor + 1] : null
    const con = !der || (izq && izq.ms >= der.ms) ? peor - 1 : peor + 1
    funde(rachas, peor, con)
    // Dos vecinos que han quedado juntos con el mismo modo, uno.
    rachas = rachas.reduce<Crudo[]>((acc, r) => {
      const u = acc[acc.length - 1]
      if (u && u.modo === r.modo) {
        acc[acc.length - 1] = {
          ...u, i1: r.i1, ms: u.ms + r.ms, km: u.km + r.km, kmhs: [...u.kmhs, ...r.kmhs], sensorMs: u.sensorMs + r.sensorMs,
        }
      } else acc.push(r)
      return acc
    }, [])
  }

  // 4. Lo que no decidió el sensor se confirma por la velocidad del tramo
  //    entero; y lo que queda igual de un lado y del otro, junto.
  const tramos: Tramo[] = []
  for (const r of rachas) {
    const sinSensor = r.sensorMs < r.ms / 2
    const modo: Modo = r.modo === 'movil' || (sinSensor && r.modo !== 'parado') ? porVelocidad(r.kmhs) : r.modo
    const movMs = r.kmhs.length ? r.ms : 0
    const t: Tramo = {
      modo, i0: r.i0, i1: r.i1, desde: trail[r.i0].t, hasta: trail[r.i1].t, km: r.km,
      kmh: movMs > 0 ? r.km / (movMs / 3_600_000) : 0, sensor: !sinSensor,
    }
    const u = tramos[tramos.length - 1]
    if (u && u.modo === t.modo) {
      const ms = t.hasta - u.desde
      Object.assign(u, { i1: t.i1, hasta: t.hasta, km: u.km + t.km, kmh: ms > 0 ? (u.km + t.km) / (ms / 3_600_000) : 0 })
    } else tramos.push(t)
  }
  return tramos
}

// ── El mapa: coche, tren o barco ─────────────────────────────────────────────

/** Lo que hay en un punto según el mapa. */
export interface Entorno { agua: boolean; via: boolean; ferry: boolean }

/** Cada cuánto se mira el mapa dentro de un tramo en vehículo, y hasta cuántas veces. */
const CADA_KM = 0.3
const MUESTRAS_MAX = 120

/**
 * Si un tramo se mira en el mapa: los «en vehículo», y los de correr o bici
 * que salieron solo por la velocidad. Sin sensor, un barco a 13 km/h o un
 * tranvía a 20 caen en esas bandas; sobre el agua o por la vía, el mapa lo
 * dice. Con sensor no: el sensor sí distingue correr de ir en algo.
 */
export const pideMapa = (t: Tramo) => t.modo === 'vehiculo' || (!t.sensor && (t.modo === 'correr' || t.modo === 'bici'))

/** Los puntos de un tramo en los que mirar el mapa: repartidos por distancia,
 *  con el índice del punto del trazado al que corresponden. */
export function muestrasDe(trail: TrailPoint[], t: Tramo): { lat: number; lon: number; i: number }[] {
  const paso = Math.max(CADA_KM, t.km / MUESTRAS_MAX)
  const out: { lat: number; lon: number; i: number }[] = []
  let acum = paso
  for (let i = t.i0 + 1; i <= t.i1; i++) {
    acum += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
    if (acum >= paso) { out.push({ lat: trail[i].lat, lon: trail[i].lon, i }); acum = 0 }
  }
  if (out.length === 0) out.push({ lat: trail[t.i1].lat, lon: trail[t.i1].lon, i: t.i1 })
  return out
}

/** Lo mínimo que tiene que durar un trozo por la vía o por el agua para
 *  contar como tren o barco: menos es una carretera junto a la vía, o un
 *  puente. */
const TREN_MIN_KM = 3
const BARCO_MIN_KM = 2
/** Menos que esto, sea lo que sea, no es un cambio. */
const RETAZO_KM = 1

/** Un trozo del trazado [i0, i1] como tramo, con sus km y su media. */
function trozo(trail: TrailPoint[], modo: Modo, i0: number, i1: number): Tramo {
  let km = 0
  for (let i = i0 + 1; i <= i1; i++) km += haversineKm(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
  const ms = trail[i1].t - trail[i0].t
  return { modo, i0, i1, desde: trail[i0].t, hasta: trail[i1].t, km, kmh: ms > 0 ? km / (ms / 3_600_000) : 0 }
}

/**
 * Los tramos «en vehículo», decididos con el mapa: por donde va sobre el agua
 * (o por una línea de ferry), barco; por la vía, tren; lo demás, coche. Y
 * partidos si hace falta: del tren al coche sin bajarse a andar entre medias
 * (en el trazado) sigue siendo «en vehículo» para el sensor, y solo el mapa
 * lo separa. Un trozo corto por la vía o sobre el agua no cambia nada (ver
 * TREN_MIN_KM y BARCO_MIN_KM). Mientras falte el mapa de algún punto, el
 * tramo se queda «en vehículo».
 */
export function refinaVehiculos(
  trail: TrailPoint[], tramos: Tramo[], entornoDe: (lat: number, lon: number) => Entorno | undefined,
): Tramo[] {
  const out: Tramo[] = []
  for (const t of tramos) {
    if (!pideMapa(t)) { out.push(t); continue }
    const m = muestrasDe(trail, t)
    const e = m.map((p) => entornoDe(p.lat, p.lon))
    if (e.some((x) => !x)) { out.push(t); continue }
    // Cada muestra, con lo que dice el mapa; en rachas, con sus km.
    // La vía primero: sobre el agua Y por la vía es un puente de tren o un
    // túnel bajo el agua (el Marmaray bajo el Bósforo), no un barco.
    const etiqueta = (x: Entorno): Modo => (x.via ? 'tren' : x.agua || x.ferry ? 'barco' : 'coche')
    let rachas: { modo: Modo; k0: number; k1: number; km: number }[] = []
    m.forEach((p, k) => {
      const modo = etiqueta(e[k]!)
      const km = k === 0 ? 0 : haversineKm(m[k - 1].lat, m[k - 1].lon, p.lat, p.lon)
      const u = rachas[rachas.length - 1]
      if (u && u.modo === modo) { u.k1 = k; u.km += km } else rachas.push({ modo, k0: k, k1: k, km })
    })
    const junta = (lista: typeof rachas) => lista.reduce<typeof rachas>((acc, r) => {
      const u = acc[acc.length - 1]
      if (u && u.modo === r.modo) { u.k1 = r.k1; u.km += r.km } else acc.push({ ...r })
      return acc
    }, [])
    // Los retazos de menos de un kilómetro, sean lo que sean, con el vecino
    // más largo: el GPS rozando la orilla o cruzando la vía en un paso a nivel.
    for (;;) {
      let peor = -1
      rachas.forEach((r, k) => { if (rachas.length > 1 && r.km < RETAZO_KM && (peor < 0 || r.km < rachas[peor].km)) peor = k })
      if (peor < 0) break
      const izq = rachas[peor - 1], der = rachas[peor + 1]
      const con = !der || (izq && izq.km >= der.km) ? izq : der
      rachas[peor] = { ...rachas[peor], modo: con.modo }
      rachas = junta(rachas)
    }
    // Luego, los trozos de tren o barco que no llegan a serlo, a coche.
    const corto = (r: { modo: Modo; km: number }) =>
      (r.modo === 'tren' && r.km < TREN_MIN_KM) || (r.modo === 'barco' && r.km < BARCO_MIN_KM)
    rachas = junta(rachas.map((r) => (corto(r) ? { ...r, modo: 'coche' as Modo } : r)))
    // A tramos: cada racha empieza donde acaba la anterior.
    // Lo que no va por el agua ni por la vía: coche si era «en vehículo»; si
    // era correr o bici por la velocidad, se queda como estaba.
    const resto: Modo = t.modo === 'vehiculo' ? 'coche' : t.modo
    rachas.forEach((r, k) => {
      const i0 = k === 0 ? t.i0 : m[r.k0].i - 1
      const i1 = k === rachas.length - 1 ? t.i1 : m[rachas[k + 1].k0].i - 1
      if (i1 > i0) out.push({ ...trozo(trail, r.modo === 'coche' ? resto : r.modo, i0, i1), sensor: t.sensor })
    })
  }
  return out
}

// ── Lo corregido a mano ─────────────────────────────────────────────────────

/**
 * Una corrección de su dueño: «de tal hora a tal hora, iba en tren». Por
 * horas y no por tramo, a propósito: los tramos se recalculan (llega el mapa
 * y parte uno en dos, llegan posiciones nuevas…) y la hora no cambia. Espejo
 * de `AjusteDeTramo` en shared/wireTypes.ts.
 */
export interface AjusteDeTramo { desde: number; hasta: number; modo: Modo }

/** Los medios que se pueden poner a mano («en vehículo» es no saber cuál). */
export const MODOS_A_MANO: Modo[] = ['pie', 'correr', 'bici', 'coche', 'tren', 'barco', 'avion', 'parado']

/**
 * Los tramos con las correcciones puestas. Cada trocito del trazado (entre dos
 * puntos) toma el medio de la corrección que cubre su hora, la última que se
 * hizo si hay varias; y luego se vuelve a juntar en tramos. Por trocitos y no
 * por tramos enteros: así una corrección puede cortar por donde sea, que es lo
 * que hace falta para mover un extremo que la detección puso mal.
 */
export function aplicaAjustes(trail: TrailPoint[], tramos: Tramo[], ajustes: AjusteDeTramo[]): Tramo[] {
  if (ajustes.length === 0 || tramos.length === 0) return tramos
  // El medio y si está corregido de cada trocito i (del punto i-1 al i).
  const modo: Modo[] = []
  const corregido: boolean[] = []
  for (const t of tramos) for (let i = t.i0 + 1; i <= t.i1; i++) { modo[i] = t.modo; corregido[i] = false }
  for (let i = 1; i < trail.length; i++) {
    if (modo[i] === undefined) continue
    const mitad = (trail[i - 1].t + trail[i].t) / 2
    for (const a of ajustes) if (mitad >= a.desde && mitad <= a.hasta) { modo[i] = a.modo; corregido[i] = true }
  }
  const out: Tramo[] = []
  let i0 = -1
  for (let i = 1; i <= trail.length; i++) {
    const cambia = i === trail.length || modo[i] === undefined || (i0 >= 0 && modo[i] !== modo[i0 + 1])
    if (i0 >= 0 && cambia) {
      const t = trozo(trail, modo[i0 + 1], i0, i - 1)
      if (corregido.slice(i0 + 1, i).some(Boolean)) t.corregido = true
      out.push(t)
      i0 = -1
    }
    if (i < trail.length && modo[i] !== undefined && i0 < 0) i0 = i - 1
  }
  return out
}

/** Las correcciones sin nada entre `desde` y `hasta`: lo que caía dentro se
 *  recorta, no se tira (lo de fuera sigue corregido). */
function recorta(ajustes: AjusteDeTramo[], desde: number, hasta: number): AjusteDeTramo[] {
  const out: AjusteDeTramo[] = []
  for (const x of ajustes) {
    if (x.hasta <= desde || x.desde >= hasta) { out.push(x); continue }
    if (x.desde < desde) out.push({ ...x, hasta: desde })
    if (x.hasta > hasta) out.push({ ...x, desde: hasta })
  }
  return out
}

/** «En vehículo» no es un medio que se pueda poner: es no saber cuál. Si se
 *  fija a mano un tramo que aún está así (el mapa no ha llegado), coche. */
const fijo = (m: Modo): Modo => (m === 'vehiculo' ? 'coche' : m)

/** Las correcciones tras poner `modo` al tramo `t` (null: volver a lo detectado). */
export function corrige(ajustes: AjusteDeTramo[], t: Tramo, modo: Modo | null): AjusteDeTramo[] {
  const resto = recorta(ajustes, t.desde, t.hasta)
  return modo === null ? resto : [...resto, { desde: t.desde, hasta: t.hasta, modo: fijo(modo) }]
}

/**
 * Las correcciones tras mover el corte entre el tramo `a` y el siguiente `b`
 * a la hora `t`: `a` llega hasta ahí y `b` empieza ahí, cada uno con su medio.
 * `t` tiene que caer dentro de los dos (ni antes de que empiece `a` ni después
 * de que acabe `b`); si no, no cambia nada.
 */
export function mueveCorte(ajustes: AjusteDeTramo[], a: Tramo, b: Tramo, t: number): AjusteDeTramo[] {
  if (!(t > a.desde && t < b.hasta)) return ajustes
  return [
    ...recorta(ajustes, a.desde, b.hasta),
    { desde: a.desde, hasta: t, modo: fijo(a.modo) },
    { desde: t, hasta: b.hasta, modo: fijo(b.modo) },
  ]
}

/** Hasta dónde se puede mover el corte entre el tramo k y el k+1: índices de
 *  punto, sin dejar a ninguno de los dos sin trazado. */
export function margenDeCorte(tramos: Tramo[], k: number): [number, number] | null {
  const a = tramos[k], b = tramos[k + 1]
  if (!a || !b) return null
  return [a.i0 + 1, b.i1 - 1]
}

/** Los totales por medio: km y tiempo de cada uno, del que más se hizo al que
 *  menos (por tiempo). Lo parado aparte, al final, solo con su tiempo. */
export function totalesPorModo(tramos: Tramo[]): { modo: Modo; km: number; ms: number; tramos: number }[] {
  const por = new Map<Modo, { modo: Modo; km: number; ms: number; tramos: number }>()
  for (const t of tramos) {
    const x = por.get(t.modo) ?? { modo: t.modo, km: 0, ms: 0, tramos: 0 }
    x.km += t.km; x.ms += t.hasta - t.desde; x.tramos++
    por.set(t.modo, x)
  }
  return [...por.values()].sort((a, b) =>
    a.modo === 'parado' ? 1 : b.modo === 'parado' ? -1 : b.ms - a.ms)
}

/** «3,2 km · 45 min» y «1 h 20». */
function duracion(ms: number): string {
  const min = Math.round(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`
}
export function kmYTiempo(modo: Modo, km: number, ms: number): string {
  if (modo === 'parado') return duracion(ms)
  const k = km >= 10 ? Math.round(km).toString() : km.toFixed(1).replace('.', ',')
  return `${k} km · ${duracion(ms)}`
}

/** «🚶 3,2 km · 45 min». */
export function resumenDeTramo(t: Tramo): string {
  return `${MODOS[t.modo].emoji} ${kmYTiempo(t.modo, t.km, t.hasta - t.desde)}`
}
