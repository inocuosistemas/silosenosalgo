/**
 * Cada cuánto promete hablar una baliza — y, por tanto, cuánto silencio es normal.
 *
 * Hasta ahora el mapa daba a todo el mundo los mismos plazos: a los seis
 * minutos sin noticias se apagaba el punto y a los veinte se anunciaba "sin
 * cobertura". Eso vale para una baliza que emite por tiempo, pero no para una
 * que emite POR DISTANCIA, que es el modo de las ultras: ahí no mandar nada es
 * lo que hace un móvil cuando su dueño está parado en un avituallamiento, y
 * anunciarlo como avería es mentir dos veces —ni está sin cobertura, ni le ha
 * pasado nada—.
 *
 * En la CanFranc una baliza en "Ahorro · ultra" mandó 35 posiciones en catorce
 * horas, separadas 501 metros de mediana, y el mapa la daba por perdida a cada
 * rato. Sus lecturas eran impecables: sencillamente no se movía 500 m tan a
 * menudo.
 *
 * La baliza manda su cadencia en el ping —una letra y un número— y con eso se
 * calculan SUS plazos. Y si no la manda (una app vieja), se usan los de antes.
 */

export interface Cadencia {
  /** `tiempo`: manda cada `valor` segundos. `distancia`: cada `valor` metros. */
  modo: 'tiempo' | 'distancia'
  valor: number
}

/** Cómo viaja: `t15` = cada quince segundos, `d500` = cada quinientos metros. */
export function escribeCadencia(c: Cadencia): string {
  return `${c.modo === 'tiempo' ? 't' : 'd'}${Math.round(c.valor)}`
}

export function leeCadencia(s: string | null | undefined): Cadencia | null {
  if (typeof s !== 'string') return null
  const m = /^([td])(\d{1,5})$/.exec(s.trim())
  if (!m) return null
  const valor = Number(m[2])
  if (!Number.isFinite(valor) || valor <= 0) return null
  return { modo: m[1] === 't' ? 'tiempo' : 'distancia', valor }
}

/**
 * A qué velocidad se supone que se mueve alguien que sigue en carrera, para
 * traducir "cada 500 metros" en "cada tantos minutos".
 *
 * Kilómetro y medio por hora: el paso de quien sube un puerto de noche a las
 * doce horas de carrera, que es el más lento que se ve de verdad. Con un ritmo
 * más alegre los plazos saldrían cortos y volveríamos a dar por perdido a quien
 * solo va despacio.
 */
const ARRASTRANDOSE_KMH = 1.5

/** Los plazos de antes, los que valen cuando la baliza no dice nada de sí misma. */
export const CALLADO_POR_DEFECTO_MS = 3 * 60_000
export const PERDIDO_POR_DEFECTO_MS = 20 * 60_000
/** Y un techo, que ni el modo más ahorrador justifica hora y media de silencio. */
const PERDIDO_TOPE_MS = 90 * 60_000

/**
 * Cuánto silencio es normal en esta baliza y cuánto ya es noticia.
 *
 * `callado` es "lleva más de lo suyo sin hablar" —se dice, en gris, para que
 * quien mira no crea que la aplicación está rota— y `perdido` es "esto ya no es
 * su pulso": el punto que se ve es su última posición conocida.
 *
 * Por TIEMPO se toma un múltiplo del intervalo: una lectura se pierde por mil
 * motivos, tres seguidas ya son un hueco. Por DISTANCIA se calcula lo que tarda
 * el más lento en recorrer esa distancia, porque es eso —y no un reloj— lo que
 * dispara la siguiente lectura.
 */
export function plazosDe(c: Cadencia | null): { callado: number; perdido: number } {
  if (!c) return { callado: CALLADO_POR_DEFECTO_MS, perdido: PERDIDO_POR_DEFECTO_MS }
  if (c.modo === 'tiempo') {
    const ms = c.valor * 1000
    return {
      callado: Math.max(3 * ms, CALLADO_POR_DEFECTO_MS),
      perdido: Math.min(Math.max(10 * ms, PERDIDO_POR_DEFECTO_MS), PERDIDO_TOPE_MS),
    }
  }
  // Lo que tarda en hacer esa distancia quien va arrastrándose.
  const ms = (c.valor / 1000 / ARRASTRANDOSE_KMH) * 3_600_000
  return {
    callado: Math.max(ms, CALLADO_POR_DEFECTO_MS),
    perdido: Math.min(Math.max(2 * ms, PERDIDO_POR_DEFECTO_MS), PERDIDO_TOPE_MS),
  }
}

/**
 * Cómo se le cuenta a quien mira que esta baliza lleva un rato sin hablar.
 *
 * Por distancia NO se puede decir "sin cobertura": la baliza puede estar
 * perfectamente y su dueño sentado en una silla. Las dos cosas se ven igual
 * desde aquí, y la frase tiene que decir eso y no otra cosa.
 */
export function silencioTexto(c: Cadencia | null): string {
  if (c?.modo === 'distancia') {
    return c.valor >= 1000
      ? `sin moverse ${(c.valor / 1000).toFixed(1)} km`
      : `sin moverse ${c.valor} m`
  }
  return 'sin cobertura'
}
