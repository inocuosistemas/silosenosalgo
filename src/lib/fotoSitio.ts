/**
 * Ayudas para decir dónde se hizo una foto que no lo trae.
 */

/** Un punto con nombre del recorrido: avituallamiento, control, cima. */
export interface PuntoDelRecorrido {
  name: string
  km?: number | null
}

/** A cuánto puede estar un punto con nombre para decir "cerca de" él. */
export const CERCA_KM = 1.5

/**
 * El punto con nombre más cercano a un kilómetro, si está a menos de 1,5 km:
 * "km 49,6 · cerca de Formigal" se reconoce, un número suelto no.
 */
export function cercaDe(km: number, puntos: PuntoDelRecorrido[]): { name: string; km: number } | null {
  let mejor: { name: string; km: number } | null = null
  for (const p of puntos) {
    if (p.km == null || !Number.isFinite(p.km)) continue
    if (!mejor || Math.abs(p.km - km) < Math.abs(mejor.km - km)) mejor = { name: p.name, km: p.km }
  }
  return mejor && Math.abs(mejor.km - km) <= CERCA_KM ? mejor : null
}
