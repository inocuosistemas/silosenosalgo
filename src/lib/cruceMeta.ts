import { crucaMeta } from '../../shared/cruceMeta'
import { haversineKm } from './timing'

/**
 * lib/cruceMeta.ts — la llegada, tal como la ve el navegador.
 *
 * El cronómetro NO está aquí: está en `shared/cruceMeta.ts`, y es el mismo que
 * usa el servidor para los resultados del evento. Aquí solo se prepara lo que
 * necesita —la serie de lecturas con su kilómetro y los metros de suelo entre
 * ellas— y se decide con qué margen se da a alguien por llegado.
 *
 * ── Por qué esto vive fuera de la pantalla ─────────────────────────────────
 *
 * Haber llegado es un hecho del pasado, y esta es la única forma de contarlo
 * que no se deshace. Mirar dónde está AHORA responde a otra pregunta —"¿le
 * queda poco?"— y deja de ser cierta en cuanto el corredor se aleja de la
 * línea, que es lo que hace todo el mundo un minuto después de cruzarla.
 *
 * Esa confusión costó tres fallos el mismo fin de semana, los tres con la misma
 * forma: alguien que había terminado dejaba de constar como terminado.
 *   · La porra puntuaba contra la hora del último aviso de la baliza, que
 *     seguía avanzando desde el bar, y los pronósticos se alejaban solos.
 *   · El mapa del evento pintaba a quien acabó en su última posición conocida,
 *     media hora después de llegar y en otro sitio.
 *   · El visor individual, seis horas después de la meta, decía "seguimiento
 *     finalizado · 40,3 km · fuera de ruta a 1,3 km" y ni una palabra de la
 *     llegada.
 */

/**
 * Cuánto se le perdona al final del recorrido PARA DECIDIR si llegó.
 *
 * Solo decide eso; no toca el crono, que se interpola desde el punto más lejano
 * al que llegó de verdad. La línea de meta rara vez coincide al metro con el
 * último punto del GPX y el GPS tiene lo suyo, así que se da un 1,5% del
 * recorrido con suelo y techo: ni en una ruta corta se queda en nada ni en una
 * de 400 km da por llegado a alguien que está a seis kilómetros.
 *
 * Es más generoso que el que usa el servidor para la clasificación, y a
 * propósito: allí se reparten puestos entre varios y conviene ser estricto;
 * aquí se contesta "¿ha llegado el mío?" y negarle la meta a quien se quedó a
 * doscientos metros porque su GPS dejó de mandar es peor error que el contrario.
 */
export function toleranciaMeta(totalKm: number): number {
  return Math.min(1, Math.max(0.25, totalKm * 0.015))
}

/** Una lectura ya proyectada sobre el recorrido. */
export interface LecturaEnRuta {
  t: number
  km: number
  lat: number
  lon: number
}

/**
 * Cuándo cruzó la meta, o null si no la cruzó.
 *
 * `circuito` cambia la regla: cuando la carrera acaba donde empieza, se exige
 * haber estado antes en la primera mitad. No es un adorno —la primera posición
 * de alguien parado en la línea de salida se engancha igual de bien al final
 * del recorrido que al principio, y sin esa condición quien aún no ha echado a
 * andar aparecería como que ya ha terminado—. En un punto a punto la exigencia
 * sobra y hace daño: a quien se le murió la baliza y la reabrió en el km 20 de
 * 30 se le daría por no llegado aunque cruzara delante de todos.
 */
export function cruceEnTraza(
  lecturas: LecturaEnRuta[],
  totalKm: number,
  circuito = false,
): { t: number; margenMs: number } | null {
  if (!(totalKm > 0) || lecturas.length === 0) return null
  const serie: [number, number, number][] = lecturas.map((p, i) => [
    p.t,
    p.km,
    i > 0 ? haversineKm(lecturas[i - 1], p) * 1000 : 0,
  ])
  const cruce = crucaMeta(serie, totalKm, toleranciaMeta(totalKm), circuito)
  return cruce ? { t: cruce.ms, margenMs: cruce.margenMs } : null
}

/** ¿La carrera acaba donde empieza? Doscientos metros, el mismo umbral que el servidor. */
export function esCircuito(pts: { lat: number; lon: number }[]): boolean {
  if (pts.length < 2) return false
  return haversineKm(pts[0], pts[pts.length - 1]) * 1000 < 200
}
