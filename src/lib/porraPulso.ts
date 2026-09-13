import { durationLabel, type Proyeccion } from '../../shared/bets'
import type { EventBet } from '../../shared/wireTypes'

/**
 * lib/porraPulso.ts — "Cómo está la porra", como DATOS.
 *
 * La misma sección se ve en dos sitios: en la pantalla y en la tarjeta que se
 * manda al grupo. Cada una la calculaba y la pintaba por su cuenta, y la tarjeta
 * se fue quedando atrás sin que nadie lo notara: el kilómetro más rápido y el de
 * abandono salían en la pantalla y no en lo que se compartía.
 *
 * Aquí se calcula UNA vez, y las dos pintan desde este modelo recorriendo la
 * misma lista de secciones. Es el arnés, en tres cierres:
 *
 *   · `SECCIONES_PULSO` es la lista, y cada lado declara su pintor por sección
 *     como `Record<SeccionPulso, …>`: una sección nueva sin pintor en la
 *     pantalla o en la tarjeta NO COMPILA.
 *   · `seccionesVisibles` decide qué secciones salen, para los dos a la vez: no
 *     puede salir una en pantalla y faltar en la tarjeta por una condición
 *     escrita dos veces.
 *   · `tests/porraCompartir.test.ts` pinta las dos con los mismos datos y exige
 *     que digan lo mismo: secciones, títulos, nombres, rangos y lo marcado.
 */

export const SECCIONES_PULSO = ['favorito', 'votos', 'acabar', 'tiempos', 'rapidos', 'abandonos'] as const
export type SeccionPulso = (typeof SECCIONES_PULSO)[number]

/** El título de cada sección: el mismo en la pantalla y en la tarjeta. */
export const TITULOS_PULSO: Record<SeccionPulso, string> = {
  favorito: 'El favorito',
  votos: 'Quién gana',
  acabar: '¿Acaba?',
  tiempos: 'Cuánto tardan',
  rapidos: '⚡ Km más rápido',
  abandonos: 'Dónde lo deja',
}

export interface VotoPulso { name: string; n: number }
export interface AcabaPulso { name: string; si: number; no: number }
export interface TiempoPulso { name: string; mins: number[] }
export interface AbandonoPulso { name: string; kms: number[] }

/** Lo que dijo quien mira —o quien comparte—, para señalarlo. */
export interface MiasPulso {
  /** A quién pone primero. */
  primero: string | null
  acaba: Record<string, boolean>
  /** El tiempo que da a cada uno, en minutos de carrera. */
  tiempo: Record<string, number>
  rapido: string | null
  abandono: Record<string, number>
}

export interface PulsoPorra {
  jugadores: number
  /** A quién ve la gente ganando, si hay uno claro, y cuánto le dan. */
  favorito: { name: string; n: number; mediana: number | null } | null
  votos: VotoPulso[]
  acabar: AcabaPulso[]
  tiempos: TiempoPulso[]
  rapidos: VotoPulso[]
  abandonos: AbandonoPulso[]
  /** A qué minuto de carrera acabaría cada uno al ritmo de ahora. */
  yendoA: Record<string, number>
  /** El tope de la escala de "Cuánto tardan", en minutos. */
  techo: number
  limiteMin: number | null
  mias: MiasPulso | null
}

type Pronostico = Pick<EventBet, 'author' | 'target' | 'kind' | 'value'>

export function calculaPulso(e: {
  bets: Pronostico[]
  players: number
  runners: { username: string }[]
  startsAt: number | null
  limitMin: number | null
  proyecciones: Pick<Proyeccion, 'username' | 'acabaEn'>[]
  /** Quién mira, para sacar lo suyo. Sin sesión, nadie. */
  me: string | null
}): PulsoPorra {
  const { bets, runners, startsAt } = e

  // Quién gana: cuántos ponen a cada uno el primero.
  const votos = runners.map((r) => ({
    name: r.username,
    n: bets.filter((b) => b.target === r.username && b.kind === 'order' && b.value === '1').length
      + bets.filter((b) => b.kind === 'winner' && b.value === r.username).length,
  })).filter((v) => v.n > 0).sort((a, b) => b.n - a.n)
  const votosDe = (nombre: string) => votos.find((x) => x.name === nombre)?.n ?? 0

  /*
   * El orden de cada lista es el de lo que ESA lista mide. En "¿Acaba?", a quien
   * más gente da por finisher —primero la proporción y luego cuántos opinaron,
   * que tres de tres pesa más que uno de uno—; en "Cuánto tardan", el mejor
   * tiempo primero, que es el orden de una meta. Los votos solo desempatan.
   */
  const acabar = runners.map((r) => {
    const suyas = bets.filter((b) => b.target === r.username && b.kind === 'finish')
    return { name: r.username, si: suyas.filter((b) => b.value === 'si').length, no: suyas.filter((b) => b.value === 'no').length }
  }).filter((a) => a.si + a.no > 0).sort((a, b) => {
    const ra = a.si / (a.si + a.no), rb = b.si / (b.si + b.no)
    return rb - ra || (b.si + b.no) - (a.si + a.no) || b.si - a.si
      || votosDe(b.name) - votosDe(a.name) || a.name.localeCompare(b.name)
  })

  const tiempos = runners.map((r) => ({
    name: r.username,
    mins: bets
      .filter((b) => b.target === r.username && b.kind === 'finish_time')
      .map((b) => (startsAt !== null ? (Number(b.value) - startsAt) / 60_000 : NaN))
      .filter((m) => Number.isFinite(m) && m > 0)
      .sort((a, b) => a - b),
  })).filter((t) => t.mins.length > 0).sort((a, b) => {
    const ma = a.mins[Math.floor(a.mins.length / 2)]
    const mb = b.mins[Math.floor(b.mins.length / 2)]
    return ma - mb || votosDe(b.name) - votosDe(a.name) || a.name.localeCompare(b.name)
  })

  const rapidos = runners.map((r) => ({
    name: r.username,
    n: bets.filter((b) => b.kind === 'fastest_km' && (b.target || b.value) === r.username).length,
  })).filter((v) => v.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))

  const abandonos = runners.map((r) => ({
    name: r.username,
    kms: bets
      .filter((b) => b.target === r.username && b.kind === 'abandon_km')
      .map((b) => Number(b.value))
      .filter((k) => Number.isFinite(k) && k >= 0)
      .sort((a, b) => a - b),
  })).filter((a) => a.kms.length > 0)

  // El titular: un favorito claro, sin empate en cabeza.
  const cabeza = votos[0] && (votos.length === 1 || votos[0].n > votos[1].n) ? votos[0] : null
  const suTiempo = cabeza ? tiempos.find((t) => t.name === cabeza.name) : null
  const favorito = cabeza
    ? { name: cabeza.name, n: cabeza.n, mediana: suTiempo ? suTiempo.mins[Math.floor(suTiempo.mins.length / 2)] : null }
    : null

  const yendoA: Record<string, number> = {}
  if (startsAt !== null) for (const p of e.proyecciones) yendoA[p.username] = (p.acabaEn - startsAt) / 60_000
  const techo = Math.max(
    e.limitMin ?? 0,
    ...tiempos.flatMap((t) => t.mins),
    ...Object.values(yendoA).filter((m) => Number.isFinite(m) && m > 0),
  ) || 1

  const mias = e.me ? misPronosticos(bets.filter((b) => b.author === e.me), startsAt) : null
  return { jugadores: e.players, favorito, votos, acabar, tiempos, rapidos, abandonos, yendoA, techo, limiteMin: e.limitMin, mias }
}

function misPronosticos(mias: Pronostico[], startsAt: number | null): MiasPulso | null {
  if (mias.length === 0) return null
  const acaba: Record<string, boolean> = {}
  const tiempo: Record<string, number> = {}
  const abandono: Record<string, number> = {}
  for (const b of mias) {
    if (b.kind === 'finish') acaba[b.target] = b.value === 'si'
    if (b.kind === 'finish_time' && startsAt !== null) {
      const m = (Number(b.value) - startsAt) / 60_000
      if (Number.isFinite(m) && m > 0) tiempo[b.target] = m
    }
    if (b.kind === 'abandon_km' && Number.isFinite(Number(b.value))) abandono[b.target] = Number(b.value)
  }
  const rapido = mias.find((b) => b.kind === 'fastest_km')
  return {
    primero: mias.find((b) => b.kind === 'order' && b.value === '1')?.target
      ?? mias.find((b) => b.kind === 'winner')?.value ?? null,
    acaba,
    tiempo,
    rapido: rapido ? (rapido.target || rapido.value) : null,
    abandono,
  }
}

/** Qué secciones salen, en su orden. La misma respuesta para la pantalla y la tarjeta. */
export function seccionesVisibles(p: PulsoPorra): SeccionPulso[] {
  const hay: Record<SeccionPulso, boolean> = {
    favorito: p.favorito !== null,
    // Con un solo nombre votado, "quién gana" ya lo dice el titular.
    votos: p.votos.length > 1,
    acabar: p.acabar.length > 0,
    tiempos: p.tiempos.length > 0,
    rapidos: p.rapidos.length > 0,
    abandonos: p.abandonos.length > 0,
  }
  return SECCIONES_PULSO.filter((s) => hay[s])
}

// ── Los textos, escritos una vez para los dos ────────────────────────────────

export const fmtKm = (k: number) => k.toFixed(Number.isInteger(k) ? 0 : 1)

/** "21h 50m – 24h 35m", o uno solo si solo hay uno. */
export function rangoTiempo(mins: number[]): string {
  const desde = durationLabel(mins[0] * 60_000)
  return mins.length > 1 ? `${desde} – ${durationLabel(mins[mins.length - 1] * 60_000)}` : desde
}

/** "km 30 – 45", o uno solo. */
export function rangoKm(kms: number[]): string {
  return kms.length > 1 ? `km ${fmtKm(kms[0])} – ${fmtKm(kms[kms.length - 1])}` : `km ${fmtKm(kms[0])}`
}

/** "2 de 3 lo ponen primero · le dan 21h 50m". */
export function fraseFavorito(p: PulsoPorra): string {
  const f = p.favorito
  if (!f) return ''
  const cola = f.mediana !== null ? ` · le dan ${durationLabel(f.mediana * 60_000)}` : ''
  return `${f.n} de ${p.jugadores} lo ponen primero${cola}`
}

export interface MarcaPulso {
  seccion: SeccionPulso
  /** El corredor de la fila marcada. */
  name: string
  texto: string
}

/**
 * Lo marcado, ya escrito, a nombre de `quien`.
 *
 * "tú" en la pantalla de quien mira, y SU NOMBRE en la tarjeta que comparte: en
 * un grupo, "tú" sería el que la lee. Solo lo que cae en una sección visible,
 * que una marca en una sección que no sale no la ve nadie.
 */
export function marcasDe(p: PulsoPorra, quien: string): MarcaPulso[] {
  const m = p.mias
  if (!m) return []
  const vis = new Set(seccionesVisibles(p))
  const out: MarcaPulso[] = []
  if (vis.has('votos') && m.primero && p.votos.some((v) => v.name === m.primero)) {
    out.push({ seccion: 'votos', name: m.primero, texto: quien })
  }
  if (vis.has('acabar')) {
    for (const a of p.acabar) {
      if (a.name in m.acaba) out.push({ seccion: 'acabar', name: a.name, texto: `${quien}: ${m.acaba[a.name] ? 'sí' : 'no'}` })
    }
  }
  if (vis.has('tiempos')) {
    for (const t of p.tiempos) {
      if (t.name in m.tiempo) out.push({ seccion: 'tiempos', name: t.name, texto: `${quien} ${durationLabel(m.tiempo[t.name] * 60_000)}` })
    }
  }
  if (vis.has('rapidos') && m.rapido && p.rapidos.some((v) => v.name === m.rapido)) {
    out.push({ seccion: 'rapidos', name: m.rapido, texto: quien })
  }
  if (vis.has('abandonos')) {
    for (const a of p.abandonos) {
      if (a.name in m.abandono) out.push({ seccion: 'abandonos', name: a.name, texto: `${quien} km ${fmtKm(m.abandono[a.name])}` })
    }
  }
  return out
}
