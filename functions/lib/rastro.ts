import type { TrailPoint } from '../../shared/wireTypes'

/**
 * Cuánto retraso entre grabar un punto y recibirlo delata que el móvil no tenía
 * señal al grabarlo.
 *
 * Una baliza con cobertura manda en segundos; sin ella guarda las posiciones y
 * las suelta todas juntas al recuperarla. Un minuto deja fuera los retrasos
 * normales —la red lenta, el envío agrupado de una baliza que emite cada 30 s—
 * sin perder los huecos de verdad, que son de muchos minutos.
 */
export const LLEGADA_TARDIA_MS = 60_000

/**
 * El punto tal como se guarda en el rastro de la sesión.
 *
 * Además de la hora del GPS (`t`), la hora a la que llegó al servidor (`r`),
 * pero SOLO cuando llegó tarde: ahí está el dato —ese sitio no tenía
 * cobertura—, y en el resto sería repetir casi la misma hora cientos de veces
 * en un rastro que ya se aclara solo cuando crece. Sin `r`, el punto llegó a
 * tiempo.
 *
 * Es la materia prima del mapa de cobertura por tramos del recorrido: cruzando
 * los puntos tardíos con su kilómetro sale dónde no hay señal, y el primero que
 * pasa lo dibuja para los de detrás.
 */
export function puntoDelRastro(
  f: { t: number; lat: number; lon: number; accuracy: number | null },
  recibidoMs: number,
): TrailPoint {
  const p: TrailPoint = { t: f.t, lat: f.lat, lon: f.lon }
  if (f.accuracy != null) p.a = Math.round(f.accuracy)
  if (recibidoMs - f.t >= LLEGADA_TARDIA_MS) p.r = recibidoMs
  return p
}
