/**
 * lib/cruceMeta.ts — cuándo cruzó la meta, según su traza.
 *
 * Haber llegado es un hecho del pasado, y esta es la única forma de contarlo
 * que no se deshace. Mirar dónde está AHORA responde a otra pregunta —"¿le
 * queda poco?"— y deja de ser cierta en cuanto el corredor se aleja de la
 * línea, que es lo que hace todo el mundo un minuto después de cruzarla.
 *
 * Esa confusión ha costado tres fallos el mismo fin de semana, los tres con la
 * misma forma: alguien que había terminado dejaba de constar como terminado.
 *   · La porra puntuaba contra la hora del último aviso de la baliza, que
 *     seguía avanzando desde el bar, y los pronósticos se alejaban solos.
 *   · El mapa del evento pintaba a quien acabó en su última posición conocida,
 *     media hora después de llegar y en otro sitio.
 *   · El visor individual, seis horas después de la meta, decía "seguimiento
 *     finalizado · 40,3 km · fuera de ruta a 1,3 km" y ni una palabra de la
 *     llegada.
 *
 * Lo que demuestra la llegada es el AVANCE: pisar el final del recorrido
 * habiendo estado antes en su primera mitad.
 *
 * Esa segunda condición no es un adorno, y protege de un caso concreto: en un
 * CIRCUITO la meta y la salida son el mismo sitio, así que la primera posición
 * de alguien parado en la línea de salida se puede enganchar igual de bien al
 * final del recorrido que al principio. Sin la condición, quien aún no ha
 * echado a andar aparecería como que ya ha terminado. Exigir que se le haya
 * visto en la primera mitad antes de tocar el final lo descarta, y no estorba a
 * nadie: la proyección solo avanza, así que llegar al final habiendo salido del
 * principio es exactamente lo que pasa cuando se corre la carrera.
 */

/**
 * Cuánto se le perdona al final del recorrido.
 *
 * La línea de meta rara vez coincide al metro con el último punto del GPX, y el
 * GPS tiene lo suyo. Un 1,5% del recorrido, con suelo y techo para que ni en una
 * ruta corta se quede en nada ni en una de 400 km dé por llegado a alguien que
 * está a seis kilómetros.
 */
export function toleranciaMeta(totalKm: number): number {
  return Math.min(1, Math.max(0.25, totalKm * 0.015))
}

/**
 * El primer punto de la traza que cruza la meta, o null si no la cruzó.
 *
 * `puntos` son sus posiciones YA PROYECTADAS sobre el recorrido, en orden. Se
 * devuelve el índice además de la hora porque quien pregunta suele querer
 * también cortar ahí: cruzada la meta se acabó la carrera, y lo que venga
 * después no cuenta ni en la distancia ni en el tiempo.
 */
export function cruceEnTraza(
  puntos: { km: number; t: number }[],
  totalKm: number,
): { t: number; i: number } | null {
  if (!(totalKm > 0) || puntos.length === 0) return null
  const tol = toleranciaMeta(totalKm)
  const mitad = totalKm * 0.5
  /** Se le ha visto en la primera mitad: entonces esto es una carrera y no un
   *  enganche de la salida al final del trazado. */
  let salioDelPrincipio = false
  for (let i = 0; i < puntos.length; i++) {
    const km = puntos[i].km
    if (km <= mitad) salioDelPrincipio = true
    else if (salioDelPrincipio && km >= totalKm - tol) return { t: puntos[i].t, i }
  }
  return null
}
