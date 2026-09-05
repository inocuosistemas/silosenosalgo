import { kmAtPlannedMin, plannedMinAtKm, type PlannedCurve } from './ghostPacer'

/**
 * lib/proyeccionFantasma.ts — por dónde DEBERÍA ir quien lleva un rato callado.
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * En el monte hay huecos de cobertura, y en un hueco el punto del corredor se
 * queda clavado. Quien mira desde casa no ve "no hay señal": ve una aplicación
 * que ha dejado de funcionar. Pasó en el Desafío Urbión, donde de 435 minutos
 * de carrera hubo 50 en silencio repartidos en veintiún cortes.
 *
 * ── Qué se dibuja ──────────────────────────────────────────────────────────
 *
 * Un TRAMO, no un punto. Los dos extremos son las dos únicas cosas honestas que
 * se pueden decir de alguien a quien no se oye:
 *
 *   · `desdeKm` — se paró justo cuando lo perdimos. Es su último punto real, y
 *     ese punto NO se mueve nunca del mapa.
 *   · `hastaKm` — siguió a su ritmo. Es la proyección.
 *
 * Está en algún sitio de esa banda. A los dos minutos mide doscientos metros y
 * parece un punto; a los veinte mide dos kilómetros y parece lo que es. La
 * incertidumbre se dibuja sola en vez de esconderse detrás de un punto falso
 * que aparenta la misma precisión que un GPS.
 *
 * ── Lo que esto NO es ──────────────────────────────────────────────────────
 *
 * Un dibujo. No alimenta NI UN NÚMERO: ni previsión de llegada, ni margen al
 * corte, ni kilómetros recorridos, ni resultados, ni porra. Esa frontera es
 * todo el diseño: un número inventado se lee como un hecho y alguien coge el
 * coche con él —por eso el visor individual congela sus cuentas y avisa en
 * grande cuando no hay cobertura, y eso no cambia—. Un fantasma etiquetado
 * sobre un mapa se lee como lo que es.
 *
 * ── Cuándo se calla ────────────────────────────────────────────────────────
 *
 * Se probó contra los veintiún cortes reales de esa carrera: con el ritmo de
 * los últimos quince minutos aplicado sobre el trazado, el error mediano fue de
 * 81 metros y el peor de 503. Y ese peor caso enseña justo dónde está el límite
 * de la idea: eran las 14:13 y estaba PARADO en el avituallamiento del km 30
 * —tres lecturas seguidas en el mismo sitio antes de perderlo— y la proyección
 * lo habría mandado medio kilómetro monte arriba mientras se bebía un vaso de
 * agua. Ninguna proyección puede distinguir "sin señal" de "parado y además sin
 * señal"... salvo que lo último que se supiera de él ya fuera que estaba
 * parado, que es exactamente este caso. Por eso `estabaParado` la apaga.
 *
 * Y se apaga también:
 *   · antes de los tres minutos, que es silencio normal de una baliza que
 *     emite cada tres cuartos de minuto: un fantasma ahí sería ruido;
 *   · pasada la media hora, porque a partir de ahí la proyección habla del
 *     modelo y no del corredor: dibujaría cruzando la meta a quien abandonó;
 *   · EN LA META. La proyección se para en la línea y no la pasa. Que el
 *     fantasma llegue no es llegar: quien decide eso es el GPS, y mientras no
 *     aparezca, lo único cierto es que debería estar entrando.
 */

/** Menos de esto es el pulso normal de la baliza, no un hueco de cobertura. */
export const SILENCIO_MIN_MS = 3 * 60_000
/** Más de esto y la proyección habla del modelo, no del corredor. */
export const SILENCIO_MAX_MS = 30 * 60_000

export interface Fantasma {
  /** Su último punto real: el corredor está entre este kilómetro y el otro. */
  desdeKm: number
  /** Donde estaría si hubiera seguido a su ritmo. */
  hastaKm: number
  /** La proyección topó con la meta y se quedó ahí. */
  enMeta: boolean
  /** Cuánto lleva callado (ms), que es lo que se dice en la etiqueta. */
  silencioMs: number
}

export interface EntradaFantasma {
  /** El kilómetro de su última posición conocida. */
  kmUltimo: number | null
  /** Cuánto hace de esa última posición (ms). */
  silencioMs: number
  totalKm: number | null
  /** Sus últimas lecturas ya decían que no se movía: entonces no se proyecta. */
  estabaParado: boolean
  /** Ya cruzó, o cerró la baliza: no hay nada que proyectar. */
  resuelto: boolean
  /**
   * La curva de ritmos del recorrido, para que la proyección sepa de terreno:
   * el fantasma avanza por ella —despacio en las subidas, rápido en las
   * bajadas— escalada por lo que este corredor lleva hecho de verdad. Es la
   * misma que mueve al corredor virtual del visor.
   */
  curva: PlannedCurve | null
  /** Su tiempo de carrera hasta la última señal (ms), para sacar esa escala. */
  transcurridoMs: number | null
  /** Sin plan, el respaldo: su velocidad reciente sobre el recorrido (km/h). */
  velocidadKmH: number | null
}

export function proyeccionFantasma(e: EntradaFantasma): Fantasma | null {
  const { kmUltimo, silencioMs, totalKm } = e
  if (kmUltimo === null || totalKm === null || totalKm <= 0) return null
  if (e.resuelto || e.estabaParado) return null
  if (silencioMs < SILENCIO_MIN_MS || silencioMs > SILENCIO_MAX_MS) return null
  // Ya estaba en la meta cuando se le perdió: no hay hacia dónde proyectar.
  if (kmUltimo >= totalKm) return null

  const avance = conTerreno(e) ?? conVelocidad(e)
  if (avance === null || avance <= kmUltimo) return null

  const hastaKm = Math.min(totalKm, avance)
  return { desdeKm: kmUltimo, hastaKm, enMeta: hastaKm >= totalKm, silencioMs }
}

/**
 * Con el perfil: se traduce el silencio a "minutos de plan" y se avanza por la
 * curva del recorrido. El factor es lo que este corredor lleva hecho contra lo
 * que decía el plan —1,2 es ir un veinte por ciento más lento— y se le aplica
 * al rato que lleva callado, así que en una subida el fantasma avanza poco y en
 * una bajada mucho, como él.
 */
function conTerreno(e: EntradaFantasma): number | null {
  if (!e.curva || e.transcurridoMs === null || e.transcurridoMs <= 0 || e.kmUltimo === null) return null
  const planHasta = plannedMinAtKm(e.curva, e.kmUltimo)
  if (!Number.isFinite(planHasta) || planHasta <= 0) return null
  const factor = e.transcurridoMs / 60_000 / planHasta
  if (!Number.isFinite(factor) || factor <= 0) return null
  const silencioDePlan = e.silencioMs / 60_000 / factor
  const km = kmAtPlannedMin(e.curva, planHasta + silencioDePlan)
  return Number.isFinite(km) ? km : null
}

/** Sin plan, lo llano: su velocidad reciente por el rato que lleva callado. */
function conVelocidad(e: EntradaFantasma): number | null {
  if (e.kmUltimo === null || e.velocidadKmH === null || e.velocidadKmH <= 0) return null
  return e.kmUltimo + e.velocidadKmH * (e.silencioMs / 3_600_000)
}
