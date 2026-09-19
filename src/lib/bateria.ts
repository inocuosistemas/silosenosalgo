/**
 * ¿Le va a durar la batería? A partir del registro de la baliza.
 *
 * El registro trae una entrada cada vez que el porcentaje CAMBIA (ver
 * `functions/api/track/[id]/ping.ts`), así que cada punto es el momento en que
 * bajó un escalón: entre el primero y el último de una misma descarga, lo que se
 * ha gastado y en cuánto tiempo son exactos, sin el ruido de muestrear.
 *
 * Se mide la descarga ACTUAL (desde la última vez que subió: si lo enchufa, lo
 * de antes ya no cuenta) y solo desde la salida: la hora en la línea con la
 * pantalla apagada gasta mucho menos que correr con el GPS encendido, y
 * rebajaría el consumo justo cuando se quiere saber el de verdad.
 */

export interface EstimaBateria {
  /** Lo último que se sabe, 0-100. */
  pct: number
  /** La última lectura fue una SUBIDA: está enchufado. */
  cargando: boolean
  /** Cuánto gasta, en % por hora. Null si aún no hay carrera para medirlo. */
  porHora: number | null
  /** Cuándo llegaría a cero a ese ritmo (epoch ms). Null si no se sabe. */
  agotaMs: number | null
}

/** Cuánto hay que haber medido para que el ritmo signifique algo. Menos es un
 *  escalón de batería, que en un móvil viejo puede ser un salto de golpe. */
export const MEDIDA_MIN_MS = 15 * 60_000
export const BAJADA_MIN = 2

/**
 * @param log `[epoch ms, %]` en orden, uno por cambio.
 * @param desdeMs La salida (o el arranque de la baliza): lo de antes no cuenta.
 * @param vistoMs Su última señal: si lleva mucho sin bajar otro punto, gasta
 *   menos de lo que decía el último tramo, y eso también es un dato.
 */
export function estimaBateria(
  log: [number, number][] | null | undefined,
  desdeMs: number | null,
  vistoMs: number | null = null,
): EstimaBateria | null {
  if (!log || log.length === 0) return null
  const ultima = log[log.length - 1]
  const cargando = log.length >= 2 && ultima[1] > log[log.length - 2][1]
  const base = { pct: ultima[1], cargando, porHora: null, agotaMs: null }
  if (cargando) return base

  // La descarga actual: hacia atrás mientras vaya bajando.
  let k = log.length - 1
  while (k > 0 && log[k - 1][1] >= log[k][1]) k--
  let tramo = log.slice(k)
  // Y desde la salida. Lo que valía al salir es la última lectura de antes.
  if (desdeMs != null) {
    const antes = tramo.filter((e) => e[0] <= desdeMs)
    const despues = tramo.filter((e) => e[0] > desdeMs)
    tramo = antes.length > 0 ? [[desdeMs, antes[antes.length - 1][1]], ...despues] : despues
  }
  if (tramo.length < 2) return base
  const [t0, p0] = tramo[0]
  const [t1, p1] = tramo[tramo.length - 1]
  const bajada = p0 - p1
  if (t1 - t0 < MEDIDA_MIN_MS || bajada < BAJADA_MIN) return base

  let porHora = bajada / ((t1 - t0) / 3_600_000)
  // Si desde la última bajada ha pasado más de lo que tarda en bajar un punto,
  // el ritmo real es menor: a la hora de su última señal aún no había perdido
  // el siguiente.
  if (vistoMs != null && vistoMs > t1) {
    porHora = Math.min(porHora, (bajada + 1) / ((vistoMs - t0) / 3_600_000))
  }
  return { ...base, porHora, agotaMs: t1 + (p1 / porHora) * 3_600_000 }
}
