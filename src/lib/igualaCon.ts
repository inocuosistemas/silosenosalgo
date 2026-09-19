/**
 * "Va con fulano": para quien va en MODO MANUAL y corre junto a alguien con
 * baliza. Su paso se anota con el km y la hora del último fijo PRECISO de ese
 * otro: el GPS de su compañero es la mejor referencia que hay entre control y
 * control.
 */

import type { EventLiveRunner } from '../../shared/wireTypes'
import { kmMasCerca } from './puntosEvento'

/** Error del GPS (m) por debajo del cual un fijo vale como referencia. */
export const PRECISO_M = 30
/** Más lejos del recorrido que esto, no se sabe por dónde va: no se iguala. */
const FUERA_M = 150

export interface Referencia { km: number; at: number; precision: number; metros: number }

/**
 * El km y la hora del último fijo preciso de `r` sobre el recorrido, o por qué
 * no se puede.
 *
 * @param desdeKm hasta dónde se sabe ya que ha llegado quien va en manual (su
 *   último paso anotado): ni su compañero ni él van por detrás de eso, y es
 *   lo que desempata en un circuito, donde la meta está sobre la salida.
 */
export function referenciaDe(
  r: EventLiveRunner,
  pista: { points: { lat: number; lon: number }[]; cumKm: number[] },
  desdeKm: number,
): Referencia | string {
  const puntos: { t: number; lat: number; lon: number; a: number | null }[] = r.tail.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, a: p.a ?? null }))
  if (r.fix) puntos.push({ t: r.fix.fixAt ?? r.fix.updatedAt, lat: r.fix.lat, lon: r.fix.lon, a: r.fix.accuracy })
  const bueno = puntos
    .filter((p) => p.a != null && p.a <= PRECISO_M)
    .sort((a, b) => b.t - a.t)[0]
  if (!bueno) return `${r.username} no tiene ningún fijo preciso reciente (error de ${PRECISO_M} m o menos).`
  // Por dónde dice su propia baliza que va, si lo dice: acota la búsqueda.
  const suyo = r.fix?.trackKm ?? null
  const desde = Math.max(desdeKm - 0.3, suyo != null ? suyo - 3 : -Infinity)
  const hasta = suyo != null ? suyo + 3 : Infinity
  const c = kmMasCerca(pista, bueno.lat, bueno.lon, desde, hasta)
  if (!c || c.metros > FUERA_M) return `El último fijo preciso de ${r.username} está fuera del recorrido.`
  return { km: Math.round(c.km * 100) / 100, at: bueno.t, precision: bueno.a!, metros: c.metros }
}
