import type { EventBet } from '../../shared/wireTypes'

/**
 * lib/bets.ts — La Porra: cómo se puntúa lo que dijo cada uno.
 *
 * No se juega dinero. Se juega el orgullo, y por eso no hay cuotas ni momio:
 * los puntos salen de ACERTAR, no de lo que arriesgue nadie. Un sistema con
 * cuotas premiaría apostar contra el favorito, que es justo lo contrario de lo
 * que hace divertida una porra entre conocidos: aquí lo que se discute luego es
 * quién clavó la hora, no quién calculó mejor el riesgo.
 *
 * Las tres apuestas están pensadas para que cualquiera pueda mojarse sin saber
 * nada de la carrera —¿acaba?— y para que quien conoce al corredor tenga
 * ventaja de verdad —la hora de meta al minuto—.
 *
 * Se puntúa en el cliente, no en el servidor: todo lo que hace falta ya viaja
 * en el mapa (dónde está cada uno, si cerró la baliza y cuándo mandó su último
 * aviso), así que el ranking sale igual para todos sin una tabla más que
 * mantener ni un cron que la rellene.
 */

/** Acertar quién cruza meta el primero. Lo más difícil, lo que más da. */
const PTS_WINNER = 30
/** Acertar si acaba o no. Barato: es la apuesta con la que entra todo el mundo. */
const PTS_FINISH = 15
/** La hora de meta: 40 y se va perdiendo 2 por cada minuto de error. */
const PTS_TIME_MAX = 40
const PTS_TIME_PER_MIN = 2
/** Clavarla (±2 min) tiene premio aparte: es la jugada de la tarde. */
const PTS_BULLSEYE = 15
const BULLSEYE_MIN = 2

/** Cómo acabó la carrera de un participante, hasta donde se sabe AHORA. */
export interface RunnerOutcome {
  username: string
  /** Ha llegado a meta. */
  finished: boolean
  /** Su último aviso ya en meta (epoch ms), que es la hora que vale. */
  finishedAt: number | null
  /** Su carrera ya está decidida para la porra: llegó, o cerró la baliza sin llegar. */
  settled: boolean
}

export interface ScoredBet {
  kind: EventBet['kind']
  /** A quién apuntaba. */
  target: string
  /** Lo que dijo, ya en cristiano. */
  said: string
  points: number
  state: 'ok' | 'ko' | 'pending'
  /** Coletilla del resultado ("clavada", "por 4 min", …). */
  note?: string
}

export interface BetScore {
  author: string
  points: number
  hits: number
  pending: number
  bets: ScoredBet[]
}

/** Minutos de diferencia entre dos instantes, redondeados. */
function minutesApart(a: number, b: number): number {
  return Math.round(Math.abs(a - b) / 60_000)
}

export function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/**
 * El ranking de la porra: cada jugador con sus puntos y el detalle.
 *
 * Los pronósticos sin resolver no restan ni suman —ni se adivina por dónde van—
 * y se cuentan aparte: a mitad de carrera un ranking que ya reparte los puntos
 * de quien todavía va por el km 12 sería mentira.
 */
export function scoreBets(bets: EventBet[], outcomes: RunnerOutcome[]): BetScore[] {
  const porNombre = new Map(outcomes.map((o) => [o.username, o]))

  // El ganador de verdad: el primero que cruzó, por hora de llegada.
  let winner: string | null = null
  let winnerAt = Infinity
  for (const o of outcomes) {
    if (o.finished && o.finishedAt !== null && o.finishedAt < winnerAt) {
      winnerAt = o.finishedAt
      winner = o.username
    }
  }
  // Mientras quede alguien en carrera, el primero de ahora puede no serlo.
  const winnerFirme = winner !== null && outcomes.every((o) => o.settled)

  const porJugador = new Map<string, BetScore>()
  const dame = (author: string): BetScore => {
    let s = porJugador.get(author)
    if (!s) { s = { author, points: 0, hits: 0, pending: 0, bets: [] }; porJugador.set(author, s) }
    return s
  }

  for (const b of bets) {
    const s = dame(b.author)
    const scored = scoreOne(b, porNombre, winner, winnerFirme)
    s.bets.push(scored)
    s.points += scored.points
    if (scored.state === 'ok') s.hits++
    if (scored.state === 'pending') s.pending++
  }

  return [...porJugador.values()].sort((a, b) =>
    b.points - a.points || b.hits - a.hits || a.author.localeCompare(b.author))
}

function scoreOne(
  b: EventBet,
  porNombre: Map<string, RunnerOutcome>,
  winner: string | null,
  winnerFirme: boolean,
): ScoredBet {
  if (b.kind === 'winner') {
    const said = b.value
    if (!winnerFirme) return { kind: b.kind, target: '', said, points: 0, state: 'pending' }
    return said === winner
      ? { kind: b.kind, target: '', said, points: PTS_WINNER, state: 'ok', note: 'el primero' }
      : { kind: b.kind, target: '', said, points: 0, state: 'ko', note: winner ? `ganó ${winner}` : 'sin ganador' }
  }

  const o = porNombre.get(b.target)

  if (b.kind === 'finish') {
    const dijoSi = b.value === 'si'
    const said = dijoSi ? 'acaba' : 'no acaba'
    // Llegar a meta se sabe en cuanto llega; NO llegar solo cuando cierra la
    // baliza sin haber llegado, que si no un abandono y un descanso largo se
    // parecerían demasiado.
    if (!o || (!o.finished && !o.settled)) return { kind: b.kind, target: b.target, said, points: 0, state: 'pending' }
    const acabo = o.finished
    return acabo === dijoSi
      ? { kind: b.kind, target: b.target, said, points: PTS_FINISH, state: 'ok' }
      : { kind: b.kind, target: b.target, said, points: 0, state: 'ko' }
  }

  // finish_time
  const at = Number(b.value)
  const said = Number.isFinite(at) ? timeLabel(at) : '—'
  if (!o || !o.finished || o.finishedAt === null) {
    // Quien no acaba no tiene hora que comparar: el pronóstico se cae, pero no
    // resta. Bastante castigo es haberse quedado sin la apuesta gorda.
    if (o?.settled) return { kind: b.kind, target: b.target, said, points: 0, state: 'ko', note: 'no llegó a meta' }
    return { kind: b.kind, target: b.target, said, points: 0, state: 'pending' }
  }
  const err = minutesApart(at, o.finishedAt)
  const base = Math.max(0, PTS_TIME_MAX - err * PTS_TIME_PER_MIN)
  const bull = err <= BULLSEYE_MIN ? PTS_BULLSEYE : 0
  const points = base + bull
  return {
    kind: b.kind,
    target: b.target,
    said,
    points,
    state: points > 0 ? 'ok' : 'ko',
    note: bull ? `¡clavada! ${err} min` : `por ${err} min`,
  }
}

/** El adorno del podio. Sin premios para el último: aquí se viene a pasarlo bien. */
export function betMedal(i: number): string {
  return i === 0 ? '🔮' : i === 1 ? '🥈' : i === 2 ? '🥉' : '·'
}

/** Cómo se llama a quien va primero, que un ranking sin título no es nada. */
export const ORACULO = 'Oráculo Mayor'
