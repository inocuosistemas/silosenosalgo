import type { TrailPoint } from '../../shared/wireTypes'
import { durationLabel } from '../../shared/bets'

/**
 * El guion del vídeo de una salida: qué hora de la salida se ve en cada
 * segundo del vídeo.
 *
 * En un evento el reloj corre parejo, que es lo justo cuando hay varios en
 * carrera. Una salida es otra cosa: mucho rato parado —la cena, el museo— y un
 * reloj parejo tendría el punto quieto medio vídeo. Así que aquí el reloj solo
 * corre con el movimiento, y cada pausa que cuenta algo —con nombre, o larga—
 * se queda un momento en pantalla con su rótulo («🍽️ Cena · 45 min»). Las
 * cortas y sin nombre se saltan sin más.
 *
 * Las fotos, igual: al llegar a la hora de cada una el reloj se para un
 * momento para enseñarla. Si hay demasiadas para el tiempo que hay, se eligen
 * unas cuantas repartidas por la salida.
 */

/** Lo que dura el movimiento entero, como la carrera en el vídeo de un evento. */
export const MOVER_S = 24
/** Lo que se queda en pantalla una pausa, y una foto. */
export const PAUSA_S = 1.4
export const FOTO_S = 2.4
/** Lo más que se alarga el vídeo por pausas y fotos: hasta ~1 min en total. */
export const EXTRA_MAX_S = 30
/** Sin nombre, una pausa se cuenta solo si es al menos así de larga. */
export const PAUSA_LARGA_MS = 20 * 60_000
/** Como mucho tantas pausas con rótulo: el vídeo es del camino. */
const PAUSAS_MAX = 6

export interface PausaGuion {
  desde: number
  hasta: number
  nombre?: string | null
  emoji?: string | null
}

export interface FotoGuion {
  id: string
  /** Cuándo se hizo (epoch ms). */
  en: number
  lat: number
  lon: number
  url: string
}

export type Paso =
  | { tipo: 'mover'; desde: number; hasta: number; s: number }
  | { tipo: 'pausa'; en: number; s: number; texto: string }
  | { tipo: 'foto'; en: number; s: number; foto: FotoGuion }

export interface Guion {
  pasos: Paso[]
  segundos: number
  /** Las fotos que salen, por orden. */
  fotos: FotoGuion[]
}

/** El rótulo de una pausa, o null si no merece uno. */
export function rotuloDePausa(p: PausaGuion): string | null {
  const dura = durationLabel(p.hasta - p.desde)
  const nombre = p.nombre?.trim()
  if (nombre) return `${p.emoji ? `${p.emoji} ` : ''}${nombre} · ${dura}`
  if (p.hasta - p.desde >= PAUSA_LARGA_MS) return `${p.emoji ? `${p.emoji} ` : ''}Parada · ${dura}`
  return null
}

/** `n` de `xs` repartidas por igual, la primera y la última incluidas. */
function repartidas<T>(xs: T[], n: number): T[] {
  if (n <= 0) return []
  if (xs.length <= n) return xs
  if (n === 1) return [xs[Math.floor(xs.length / 2)]]
  return Array.from({ length: n }, (_, k) => xs[Math.round((k * (xs.length - 1)) / (n - 1))])
}

export function guionDeSalida(desde: number, hasta: number, pausas: PausaGuion[], fotos: FotoGuion[]): Guion {
  // Las pausas dentro de la salida, por orden y sin solapes.
  const orden = pausas
    .map((p) => ({ ...p, desde: Math.max(desde, p.desde), hasta: Math.min(hasta, p.hasta) }))
    .filter((p) => p.hasta > p.desde)
    .sort((a, b) => a.desde - b.desde)
  const juntas: (PausaGuion & { texto: string | null })[] = []
  for (const p of orden) {
    const ultima = juntas[juntas.length - 1]
    if (ultima && p.desde <= ultima.hasta) {
      ultima.hasta = Math.max(ultima.hasta, p.hasta)
      if (!ultima.nombre && p.nombre) { ultima.nombre = p.nombre; ultima.emoji = p.emoji }
    } else juntas.push({ ...p, texto: null })
  }
  for (const p of juntas) p.texto = rotuloDePausa(p)

  // Qué pausas llevan rótulo: las de nombre primero, luego las más largas.
  const conRotulo = juntas
    .filter((p) => p.texto)
    .sort((a, b) => (b.nombre ? 1 : 0) - (a.nombre ? 1 : 0) || (b.hasta - b.desde) - (a.hasta - a.desde))
    .slice(0, PAUSAS_MAX)
  const rotuladas = new Set(conRotulo)
  const quedan = EXTRA_MAX_S - rotuladas.size * PAUSA_S
  const elegidas = repartidas(
    fotos.filter((f) => f.en >= desde && f.en <= hasta).sort((a, b) => a.en - b.en),
    Math.max(0, Math.floor(quedan / FOTO_S)),
  )

  // El reloj en movimiento: lo que dura la salida sin sus pausas.
  const parado = juntas.reduce((s, p) => s + (p.hasta - p.desde), 0)
  const enMovimiento = Math.max(0, hasta - desde - parado)
  const k = enMovimiento > 0 ? MOVER_S / enMovimiento : 0

  type Cosa = { t: number; pausa?: (typeof juntas)[number]; foto?: FotoGuion }
  const cosas: Cosa[] = [
    ...juntas.map((p): Cosa => ({ t: p.desde, pausa: p })),
    ...elegidas.map((f): Cosa => ({ t: f.en, foto: f })),
  ].sort((a, b) => a.t - b.t || (a.pausa ? -1 : 1))

  const pasos: Paso[] = []
  let cursor = desde
  const mueve = (hastaT: number) => {
    if (hastaT > cursor && k > 0) pasos.push({ tipo: 'mover', desde: cursor, hasta: hastaT, s: (hastaT - cursor) * k })
    cursor = Math.max(cursor, hastaT)
  }
  for (const c of cosas) {
    if (c.t > cursor) mueve(c.t)
    if (c.pausa) {
      if (rotuladas.has(c.pausa) && c.pausa.texto) pasos.push({ tipo: 'pausa', en: c.pausa.desde, s: PAUSA_S, texto: c.pausa.texto })
      cursor = Math.max(cursor, c.pausa.hasta)
    } else if (c.foto) {
      pasos.push({ tipo: 'foto', en: c.foto.en, s: FOTO_S, foto: c.foto })
    }
  }
  mueve(hasta)
  return { pasos, segundos: pasos.reduce((s, p) => s + p.s, 0), fotos: elegidas }
}

export interface MomentoGuion {
  /** La hora de la salida que se ve (epoch ms). */
  instante: number
  rotulo: string | null
  /** La foto en pantalla y por dónde va su aparición (0 → 1). */
  foto: { foto: FotoGuion; fase: number } | null
}

/** Qué se ve en el segundo `s` del guion. */
export function momentoDelGuion(g: Guion, s: number, desde: number): MomentoGuion {
  let resto = Math.max(0, s)
  let ultimo = desde
  for (const p of g.pasos) {
    if (resto <= p.s) {
      const fase = p.s > 0 ? resto / p.s : 1
      if (p.tipo === 'mover') return { instante: p.desde + (p.hasta - p.desde) * fase, rotulo: null, foto: null }
      if (p.tipo === 'pausa') return { instante: p.en, rotulo: p.texto, foto: null }
      return { instante: p.en, rotulo: null, foto: { foto: p.foto, fase } }
    }
    resto -= p.s
    ultimo = p.tipo === 'mover' ? p.hasta : p.en
  }
  return { instante: ultimo, rotulo: null, foto: null }
}

/** Dónde estaba en `instante`, entre sus dos lecturas más cercanas. */
export function posicionEn(trail: TrailPoint[], instante: number): [number, number] | null {
  if (trail.length === 0) return null
  if (instante <= trail[0].t) return [trail[0].lat, trail[0].lon]
  const ultimo = trail[trail.length - 1]
  if (instante >= ultimo.t) return [ultimo.lat, ultimo.lon]
  let lo = 0
  let hi = trail.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (trail[m].t <= instante) lo = m
    else hi = m
  }
  const a = trail[lo]
  const b = trail[hi]
  const f = b.t > a.t ? (instante - a.t) / (b.t - a.t) : 0
  return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]
}
