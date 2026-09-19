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

export type TipoPunto = 'control' | 'liquido' | 'solido' | 'completo' | 'bolsa' | 'meta'

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
