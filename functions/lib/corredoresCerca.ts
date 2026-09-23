/**
 * Los corredores que tiene CERCA quien corre, para la tarjeta de la pantalla
 * de bloqueo (la vista de corredores de la Actividad en Directo de la app).
 *
 * No es el mapa del evento: aquí no hacen falta trazas, ni fotos, ni saber
 * quién mira. Solo quién va delante y detrás, a cuántos km, el primero y la
 * posición propia. Suelto del endpoint para poder probarlo.
 */

export interface CorredorEnCarrera {
  userId: string
  nombre: string
  emoji: string | null
  km: number | null
  retirado: boolean
}

export interface CorredorCerca {
  km: number
  emoji: string
  nombre: string
  lider?: true
}

export interface CorredoresCerca {
  /** Cuándo se calculó (epoch ms): la tarjeta lo enseña. */
  actualizado: number
  /** Los que están en carrera: con posición conocida y sin retirarse. */
  total: number
  /** La propia, contando por km; nula sin km propio. */
  posicion: number | null
  corredores: CorredorCerca[]
}

/** Cuánto alrededor se mira: lo que enseña la tarjeta (4 km a cada lado). */
export const RADIO_KM = 4
/** Y cuántos como mucho, además del primero: más no se leen en la tarjeta. */
export const MAXIMO = 6

/**
 * Del km de quien pregunta y de la parrilla, los de alrededor.
 *
 * La posición se cuenta por km: en una salida en masa es la de la carrera.
 * El km propio lo manda la app, que lo tiene más fresco que el servidor (la
 * última tanda de posiciones puede no haber subido todavía); si no llega, se
 * usa el que hay guardado.
 */
export function corredoresCerca(
  parrilla: CorredorEnCarrera[],
  yo: string,
  miKm: number | null,
  ahora: number,
): CorredoresCerca {
  const enCarrera = parrilla.filter((c) => c.km != null && !c.retirado)
  const kmPropio = miKm ?? enCarrera.find((c) => c.userId === yo)?.km ?? null
  const otros = enCarrera
    .filter((c) => c.userId !== yo)
    .sort((a, b) => (b.km as number) - (a.km as number))
  const posicion = kmPropio == null ? null : otros.filter((c) => (c.km as number) > kmPropio).length + 1
  const total = otros.length + (kmPropio == null ? 0 : 1)

  const aca = (c: CorredorEnCarrera): CorredorCerca => ({
    km: Math.round((c.km as number) * 100) / 100,
    emoji: c.emoji || '🏃',
    nombre: c.nombre,
  })

  const salida: CorredorCerca[] = []
  const lider = otros[0]
  const primeroSoyYo = kmPropio != null && lider != null && kmPropio >= (lider.km as number)
  if (lider && !primeroSoyYo) salida.push({ ...aca(lider), lider: true })
  if (kmPropio != null) {
    const cerca = otros
      .filter((c) => c !== lider || primeroSoyYo)
      .filter((c) => Math.abs((c.km as number) - kmPropio) <= RADIO_KM)
      .sort((a, b) => Math.abs((a.km as number) - kmPropio) - Math.abs((b.km as number) - kmPropio))
      .slice(0, MAXIMO)
    salida.push(...cerca.map(aca))
  }
  return { actualizado: ahora, total, posicion, corredores: salida }
}
