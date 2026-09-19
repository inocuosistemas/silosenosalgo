/**
 * Cuánto va a tardar alguien en lo que le queda, mirando el TERRENO que tiene
 * por delante y cómo lo está haciendo él.
 *
 * Lo de antes —lo que al plan le queda × un factor— hereda los defectos del
 * plan: uno en "ritmo fijo" (Matxicots 26: 13:45 min/km para todo) cuenta
 * igual un kilómetro llano que uno con 300 m de subida, y a mitad de carrera,
 * con las cumbres gordas aún por delante, la previsión se quedaba corta por
 * horas. Probado contra la traza de Soriano, prediciendo desde el km 10, 13,
 * 16 y 19 cuándo pasaba por cada control siguiente: 41 min de error medio.
 *
 * Esto hace tres cosas, y con ellas el error baja a 6 min en la misma prueba:
 *
 * 1. El ESFUERZO de cada tramo, con la función de Tobler para ir por monte:
 *    se va más rápido en una bajada suave (−5 %) y cuesta el doble subir un
 *    15 %. No depende del plan: sale del perfil del recorrido.
 * 2. SU ritmo por unidad de esfuerzo, ajustado con lo que lleva hecho, por
 *    separado en subida y en el resto: hay quien sube como un tractor y baja
 *    con miedo, y al revés. Con pocos datos se queda cerca de su media.
 * 3. La FATIGA: el tiempo crece algo más deprisa que el esfuerzo, como en la
 *    fórmula de Riegel. Con exponente 1,1 (en ultras de montaña se ven entre
 *    1,06 y 1,15), sin él la previsión salía optimista siempre.
 */

/** Resolución del perfil de esfuerzo, en km. */
const PASO_KM = 0.05
/** Ventana de la pendiente: ±2 pasos, unos 200 m. Menos sería ruido del GPX. */
const VENTANA = 2
/** A partir de qué pendiente cuenta como subida (fracción). */
const SUBIDA = 0.03
/** El exponente de la fatiga. Ver la cabecera. */
export const ALFA_FATIGA = 1.1
/** Cuánto pesa su media al ajustar: "km de esfuerzo" virtuales a ese ritmo. */
const ANCLA = 2
/** Lo mínimo para ajustar: kilómetros hechos y tramos medidos. */
const MIN_KM = 3
const MIN_TRAMOS = 3
const TRAMO_KM = 0.5

/** Tobler: tiempo relativo a llano según la pendiente (fracción). */
export function costeRelativo(pendiente: number): number {
  return Math.exp(3.5 * Math.abs(pendiente + 0.05)) / Math.exp(3.5 * 0.05)
}

export interface PerfilEsfuerzo {
  /** Esfuerzo acumulado en subida y en el resto, cada `PASO_KM`. */
  sube: Float64Array
  resto: Float64Array
  totalKm: number
}

/** El esfuerzo del recorrido, una vez por recorrido. */
export function perfilDeEsfuerzo(track: { points: { ele: number }[]; cumKm: number[] }): PerfilEsfuerzo | null {
  const { points, cumKm } = track
  if (points.length < 2 || cumKm.length !== points.length) return null
  const totalKm = cumKm[cumKm.length - 1]
  if (!(totalKm > 0)) return null
  const n = Math.floor(totalKm / PASO_KM) + 1
  const ele = new Float64Array(n)
  let j = 1
  for (let i = 0; i < n; i++) {
    const km = i * PASO_KM
    while (j < cumKm.length - 1 && cumKm[j] < km) j++
    const k0 = cumKm[j - 1], k1 = cumKm[j]
    const t = k1 > k0 ? Math.min(1, Math.max(0, (km - k0) / (k1 - k0))) : 0
    ele[i] = points[j - 1].ele + t * (points[j].ele - points[j - 1].ele)
  }
  const pend = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - VENTANA), b = Math.min(n - 1, i + VENTANA)
    pend[i] = b > a ? (ele[b] - ele[a]) / ((b - a) * PASO_KM * 1000) : 0
  }
  const sube = new Float64Array(n), resto = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const p = (pend[i] + pend[i - 1]) / 2
    const e = PASO_KM * costeRelativo(p)
    sube[i] = sube[i - 1] + (p > SUBIDA ? e : 0)
    resto[i] = resto[i - 1] + (p > SUBIDA ? 0 : e)
  }
  return { sube, resto, totalKm }
}

function acumulado(serie: Float64Array, km: number): number {
  const x = Math.max(0, km) / PASO_KM
  const i = Math.min(serie.length - 2, Math.floor(x))
  if (i < 0) return 0
  return serie[i] + Math.min(1, x - i) * (serie[i + 1] - serie[i])
}

export interface RitmoAjustado {
  /** Minutos por km de esfuerzo en subida y en el resto. */
  sube: number
  resto: number
}

/**
 * Su ritmo por unidad de esfuerzo, con lo que lleva hecho: mínimos cuadrados
 * ponderados (lo reciente pesa más) con un ancla hacia su media para que un
 * par de tramos raros no lo descoloquen. Null sin datos suficientes.
 *
 * @param muestras `{km, t}` sobre el recorrido, en orden, desde la salida.
 */
export function ajustaRitmo(perfil: PerfilEsfuerzo, muestras: { km: number; t: number }[], salidaMs: number): RitmoAjustado | null {
  const tramos: { up: number; ot: number; min: number }[] = []
  let a = { km: 0, t: salidaMs }
  for (const s of muestras) {
    if (s.t <= a.t) continue
    if (s.km - a.km < TRAMO_KM) continue
    tramos.push({
      up: acumulado(perfil.sube, s.km) - acumulado(perfil.sube, a.km),
      ot: acumulado(perfil.resto, s.km) - acumulado(perfil.resto, a.km),
      min: (s.t - a.t) / 60_000,
    })
    a = s
  }
  if (a.km < MIN_KM || tramos.length < MIN_TRAMOS) return null
  const sumMin = tramos.reduce((x, s) => x + s.min, 0)
  const sumE = tramos.reduce((x, s) => x + s.up + s.ot, 0)
  if (!(sumE > 0)) return null
  const media = sumMin / sumE
  let suu = ANCLA, soo = ANCLA, suo = 0, sut = ANCLA * media, sot = ANCLA * media
  tramos.forEach((s, i) => {
    const w = 0.4 + 0.6 * (i / Math.max(1, tramos.length - 1))
    suu += w * s.up * s.up; soo += w * s.ot * s.ot; suo += w * s.up * s.ot
    sut += w * s.up * s.min; sot += w * s.ot * s.min
  })
  const det = suu * soo - suo * suo
  if (!(det > 0)) return { sube: media, resto: media }
  const sube = (sut * soo - sot * suo) / det
  const resto = (sot * suu - sut * suo) / det
  // Un ajuste que da ritmos negativos o absurdos no se cree: su media.
  if (!(sube > 0) || !(resto > 0) || sube > media * 4 || resto > media * 4) return { sube: media, resto: media }
  return { sube, resto }
}

/**
 * Cuándo llegará al km `hastaKm`, sabiendo que estaba en `desdeKm` a `desdeMs`.
 *
 * Con fatiga: el tiempo desde la salida crece como el esfuerzo (con SU ritmo en
 * cada terreno) elevado a `ALFA_FATIGA`, anclado en el punto conocido.
 */
export function prediceLlegada(
  perfil: PerfilEsfuerzo, ritmo: RitmoAjustado,
  desdeKm: number, desdeMs: number, hastaKm: number, salidaMs: number,
): number | null {
  const ee = (km: number) => ritmo.sube * acumulado(perfil.sube, km) + ritmo.resto * acumulado(perfil.resto, km)
  const eDesde = ee(desdeKm)
  const tDesde = (desdeMs - salidaMs) / 60_000
  if (!(eDesde > 0) || !(tDesde > 0)) return null
  if (hastaKm <= desdeKm) return desdeMs
  return salidaMs + tDesde * Math.pow(ee(Math.min(hastaKm, perfil.totalKm)) / eDesde, ALFA_FATIGA) * 60_000
}

/**
 * Lo contrario: por qué kilómetro debería ir a `ahoraMs`, sabiendo que estaba
 * en `desdeKm` a `desdeMs`. Para la proyección de quien no da señal (o va en
 * modo manual): el aro avanza despacio en las subidas y deprisa en las
 * bajadas, a SU ritmo en cada terreno.
 */
export function kmEnElMomento(
  perfil: PerfilEsfuerzo, ritmo: RitmoAjustado,
  desdeKm: number, desdeMs: number, ahoraMs: number, salidaMs: number,
): number | null {
  if (ahoraMs <= desdeMs) return desdeKm
  const llegaA = (km: number) => prediceLlegada(perfil, ritmo, desdeKm, desdeMs, km, salidaMs)
  const alFinal = llegaA(perfil.totalKm)
  if (alFinal == null) return null
  if (alFinal <= ahoraMs) return perfil.totalKm
  let lo = desdeKm, hi = perfil.totalKm
  for (let i = 0; i < 40 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2
    const t = llegaA(mid)
    if (t == null) return null
    if (t < ahoraMs) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
