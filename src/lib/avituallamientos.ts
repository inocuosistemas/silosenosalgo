/**
 * Qué es cada punto del recorrido: un control sin más, un avituallamiento
 * (líquido, comida o completo), la bolsa de vida o la meta. Y cuánto se para
 * uno ahí, que es lo que las previsiones tienen que sumar.
 *
 * El tipo se DEFINE: en el planificador al preparar la ruta (o importando
 * puntos), o en el evento, quien organiza, si cambia algo de un año a otro. Lo
 * que dice el texto —"Líquido + sólido", "avituallamiento completo"— o la
 * etiqueta del GPX (`<sym>Water Source</sym>`) solo sirve como SUGERENCIA al
 * cargar la ruta: cada organización lo escribe a su manera, y no puede ser lo
 * que mande.
 */

import type { TipoPunto, PuntosAjustes } from '../../shared/wireTypes'
export type { TipoPunto } from '../../shared/wireTypes'

export const TIPOS_PUNTO: TipoPunto[] = ['control', 'liquido', 'solido', 'completo', 'bolsa', 'meta']

export const TIPO_PUNTO: Record<TipoPunto, { etiqueta: string; corta: string; paradaMin: number }> = {
  control:  { etiqueta: 'Control',                    corta: 'control',    paradaMin: 0 },
  liquido:  { etiqueta: 'Avituallamiento líquido',    corta: 'líquido',    paradaMin: 1 },
  solido:   { etiqueta: 'Avituallamiento de comida',  corta: 'comida',     paradaMin: 3 },
  completo: { etiqueta: 'Avituallamiento completo',   corta: 'completo',   paradaMin: 5 },
  bolsa:    { etiqueta: 'Bolsa de vida',              corta: 'bolsa',      paradaMin: 12 },
  meta:     { etiqueta: 'Meta',                       corta: 'meta',       paradaMin: 0 },
}

export function esTipoPunto(v: unknown): v is TipoPunto {
  return typeof v === 'string' && (TIPOS_PUNTO as string[]).includes(v)
}

/** Sin tildes y en minúsculas, para buscar palabras. */
function plano(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Lo que PARECE que es, por su nombre, su descripción y sus etiquetas GPX. Es
 * una sugerencia: se enseña ya puesta y se cambia si no acierta.
 *
 * @param esUltimo el último punto del recorrido y en su final: la meta.
 */
export function sugiereTipo(
  w: { name?: string; desc?: string; sym?: string; type?: string },
  esUltimo = false,
): TipoPunto {
  const t = plano(`${w.name ?? ''} ${w.desc ?? ''} ${w.type ?? ''}`)
  const sym = plano(w.sym ?? '')
  if (esUltimo || /\bmeta\b|\bfinish\b|\barrivee\b|\bllegada\b/.test(t)) return 'meta'
  if (/bolsa de vida|bolsa|drop ?bag|\bsac\b|life ?base|base de vida/.test(t)) return 'bolsa'
  if (/completo|complet|full/.test(t)) return 'completo'
  const liquido = /liquid|agua|water|bebida|drink|eau|avituallamiento liquido/.test(t) || /water|drinking/.test(sym)
  const solido = /solid|comida|food|sandwich|bocadillo|avituallamiento solido|ravito/.test(t) || /food|restaurant/.test(sym)
  if (liquido && solido) return 'completo'
  if (solido) return 'solido'
  if (liquido) return 'liquido'
  if (/avituallamiento|aid station|ravitaillement|\bavit\b/.test(t)) return 'completo'
  return 'control'
}

/** Lo que es de verdad: lo definido, y si no hay nada definido, la sugerencia. */
export function tipoDe(
  w: { name?: string; desc?: string; sym?: string; type?: string; aid?: TipoPunto; distanceKm?: number },
  totalKm?: number | null,
): TipoPunto {
  if (w.aid) return w.aid
  const esUltimo = totalKm != null && w.distanceKm != null && totalKm - w.distanceKm < 0.2
  return sugiereTipo(w, esUltimo)
}

/** Cuánto se para ahí: lo definido, y si no, lo de su tipo. */
export function paradaDe(
  w: { name?: string; desc?: string; sym?: string; type?: string; aid?: TipoPunto; distanceKm?: number; pauseMin?: number },
  totalKm?: number | null,
): number {
  if (w.pauseMin != null && w.pauseMin >= 0) return w.pauseMin
  return TIPO_PUNTO[tipoDe(w, totalKm)].paradaMin
}

export function esAvituallamiento(t: TipoPunto): boolean {
  return t === 'liquido' || t === 'solido' || t === 'completo' || t === 'bolsa'
}

/** La clave de un punto en los ajustes del evento: su km con 2 decimales. */
export function clavePunto(km: number): string {
  return km.toFixed(2)
}

/**
 * Los puntos del recorrido con lo que quien organiza ha cambiado en el evento
 * (qué es y cuánto se para), que manda sobre lo que trae la ruta.
 */
export function aplicaAjustes<W extends { distanceKm: number; aid?: TipoPunto; pauseMin?: number }>(
  puntos: W[], ajustes: PuntosAjustes | null | undefined,
): W[] {
  if (!ajustes) return puntos
  return puntos.map((w) => {
    const a = ajustes[clavePunto(w.distanceKm)]
    if (!a) return w
    return { ...w, ...(a.aid ? { aid: a.aid } : {}), ...(a.pausa != null ? { pauseMin: a.pausa } : {}) }
  })
}

/**
 * Las paradas previstas del recorrido, en orden: lo que las previsiones
 * tienen que sumar al pasar por cada avituallamiento.
 */
export function paradasDe(
  puntos: { name?: string; desc?: string; sym?: string; type?: string; aid?: TipoPunto; distanceKm: number; pauseMin?: number }[],
  totalKm: number | null,
): { km: number; min: number }[] {
  return puntos
    .map((w) => ({ km: w.distanceKm, min: paradaDe(w, totalKm) }))
    .filter((p) => p.min > 0)
    .sort((a, b) => a.km - b.km)
}

/**
 * Las paradas que SUMAN las previsiones: solo las largas y deliberadas.
 *
 * Probado con la traza de Soriano en Matxicots 26: sumar las paradas cortas por
 * defecto (1-5 min) empeoraba la previsión unos 4 min, porque ya van dentro de
 * su ritmo —para 2-7 min en cada avituallamiento y eso ya está en lo que lleva—.
 * Lo que sí cuenta es lo que no está en su ritmo: una parada que quien organiza
 * ha puesto a propósito (una neutralización de 20 min, la comida caliente) o la
 * bolsa de vida.
 */
export function paradasPrevistas(
  puntos: { name?: string; desc?: string; sym?: string; type?: string; aid?: TipoPunto; distanceKm: number; pauseMin?: number }[],
  totalKm: number | null,
): { km: number; min: number }[] {
  return puntos
    .map((w) => {
      if (w.pauseMin != null && w.pauseMin > 0) return { km: w.distanceKm, min: w.pauseMin }
      if (tipoDe(w, totalKm) === 'bolsa') return { km: w.distanceKm, min: TIPO_PUNTO.bolsa.paradaMin }
      return null
    })
    .filter((p): p is { km: number; min: number } => p !== null)
    .sort((a, b) => a.km - b.km)
}
