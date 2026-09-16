/**
 * La carrerita de la maqueta: los corredores decorativos que toman la salida y
 * se van estirando por el recorrido, y el reloj acelerado que hace que
 * amanezca y anochezca mientras dan la vuelta.
 *
 * Todo esto es ADORNO, y conviene que quede dicho: no representa a nadie ni
 * cuenta nada de la carrera de verdad. Cuando hay corredores reales en la
 * maqueta, la carrerita se calla y les deja el sitio (ver `EventMaqueta3D`).
 *
 * Aquí no hay nada de three.js a propósito: son cuentas, y así se prueban.
 */

/** Cuántos muñecos corren, y lo que tarda el primero en dar la vuelta entera. */
export const CORREDORES_CARRERITA = 14
export const VUELTA_S = 100

/**
 * Cuántos minutos de carrera pasan por cada segundo de reloj. Con esto y una
 * vuelta de `VUELTA_S`, una carrera entera cabe en un rato de mirarla y da
 * tiempo a que el sol se mueva de verdad: es lo que hace que anochezca.
 */
export const MINUTOS_POR_SEGUNDO = 12

/** Lo que le toca a cada corredor: lo rápido que va y con cuánto retraso sale. */
export interface CorredorCarrerita {
  /** Vueltas por `VUELTA_S`: 1 es el primero, los demás por debajo. */
  velocidad: number
  /** Segundos que tarda en cruzar la línea desde que se da la salida. */
  salidaS: number
}

/**
 * Un azar fijo: la misma maqueta enseña siempre la misma carrerita. Si cada
 * recarga repartiera velocidades distintas, dos capturas de la misma carrera
 * no se parecerían, y es adorno, no una tirada de dados.
 */
function azarFijo(semilla: number): () => number {
  let s = semilla >>> 0 || 1
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/**
 * El reparto de la carrerita. Salen casi juntos —unos segundos de diferencia,
 * como en una salida de verdad, donde la cola tarda en cruzar el arco— y
 * llevan velocidades distintas, que es lo que los va estirando por el
 * recorrido hasta convertir el pelotón en un rosario.
 */
export function repartoCarrerita(n = CORREDORES_CARRERITA, semilla = 20260916): CorredorCarrerita[] {
  const dado = azarFijo(semilla)
  const gente: CorredorCarrerita[] = []
  for (let i = 0; i < n; i++) {
    // El primero va a uno; el último, a poco más de la mitad. Con un pellizco
    // de azar para que no queden repartidos en una escalera perfecta.
    const sitio = n > 1 ? i / (n - 1) : 0
    gente.push({
      velocidad: 1 - sitio * 0.45 - dado() * 0.06,
      salidaS: sitio * 1.6 + dado() * 0.8,
    })
  }
  return gente
}

/**
 * Qué parte del recorrido lleva hecha un corredor a los `segundos` de darse la
 * salida: 0 en la línea y 1 en la meta. Antes de su salida se queda en la
 * línea, y al llegar al final vuelve a empezar, que esto no termina nunca.
 */
export function avanceEn(c: CorredorCarrerita, segundos: number): number {
  const corriendo = segundos - c.salidaS
  if (corriendo <= 0) return 0
  const vueltas = (corriendo * c.velocidad) / VUELTA_S
  return vueltas - Math.floor(vueltas)
}

/** El recorrido tendido sobre el terreno, con la cuenta de lo que mide. */
export interface Carril {
  pts: readonly [number, number, number][]
  /** Distancia acumulada hasta cada punto, en unidades de la maqueta. */
  acum: Float64Array
  largo: number
}

/**
 * Prepara el carril por el que corren. Se mide la distancia acumulada una vez
 * y no en cada fotograma: los puntos del cordón no están a la misma distancia
 * unos de otros, y avanzando por índice los muñecos frenarían en las curvas,
 * que es justo donde el cordón trae los puntos apelotonados.
 *
 * La altura NO cuenta para la distancia: se mide en planta, como un mapa. Si
 * contara, en la maqueta —que lleva el relieve exagerado— las cuestas
 * parecerían larguísimas y los muñecos se arrastrarían por ellas.
 */
export function preparaCarril(cordon: readonly [number, number, number][]): Carril | null {
  if (cordon.length < 2) return null
  const acum = new Float64Array(cordon.length)
  let largo = 0
  for (let i = 1; i < cordon.length; i++) {
    largo += Math.hypot(cordon[i][0] - cordon[i - 1][0], cordon[i][2] - cordon[i - 1][2])
    acum[i] = largo
  }
  if (largo <= 0) return null
  return { pts: cordon, acum, largo }
}

/** Dónde está un corredor y hacia dónde mira. */
export interface SitioEnCarril {
  x: number
  y: number
  z: number
  /** Hacia dónde avanza, como ángulo para girar el muñeco sobre su eje. */
  rumbo: number
}

/**
 * El punto del carril que corresponde al avance `f` (0 en la salida, 1 en la
 * meta), interpolado por distancia, y el rumbo que lleva ahí.
 */
export function puntoDelCarril(carril: Carril, f: number): SitioEnCarril {
  const meta = Math.min(1, Math.max(0, f)) * carril.largo
  // Búsqueda binaria: con un cordón de miles de puntos y catorce muñecos por
  // fotograma, recorrerlo entero se nota.
  let lo = 0
  let hi = carril.acum.length - 1
  while (hi - lo > 1) {
    const medio = (lo + hi) >> 1
    if (carril.acum[medio] <= meta) lo = medio
    else hi = medio
  }
  const a = carril.pts[lo]
  const b = carril.pts[hi]
  const tramo = carril.acum[hi] - carril.acum[lo]
  const t = tramo > 0 ? (meta - carril.acum[lo]) / tramo : 0
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    z: a[2] + (b[2] - a[2]) * t,
    rumbo: Math.atan2(b[0] - a[0], b[2] - a[2]),
  }
}

/**
 * El instante que se está viviendo en la maqueta: se arranca a la hora de
 * salida de la carrera y el reloj corre `MINUTOS_POR_SEGUNDO` veces más
 * rápido. Sin hora de salida no hay nada que simular y se devuelve `null`:
 * quien llame decide qué luz poner entonces.
 */
export function instanteDe(salidaMs: number | null, segundos: number): Date | null {
  if (salidaMs === null || !Number.isFinite(salidaMs)) return null
  return new Date(salidaMs + segundos * MINUTOS_POR_SEGUNDO * 60_000)
}
