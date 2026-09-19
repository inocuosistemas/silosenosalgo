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
 *    15 %. No depende del plan: sale del perfil del recorrido. Es lo que da
 *    las pistas de dificultad de lo que queda.
 * 2. El RITMO QUE LLEVA por unidad de esfuerzo: el de su última hora, o el de
 *    su último tramo entre dos pasos anotados. No la media de toda la
 *    carrera: en la parte alta de Matxicots 26 —técnica, a 2.800 m y con
 *    cinco horas en las piernas— el mismo esfuerzo costaba el doble que al
 *    principio (5,7 → 11,6 min), y con la media el aro de Valen corría por
 *    delante de él. Una primera versión separaba subida y resto con toda la
 *    carrera, y aprendía "el resto" de los primeros kilómetros corribles.
 * 3. SU FORMA: cuánto le cuesta subir frente al resto, aprendido con TODA la
 *    carrera (a Valen subir le cuesta un 82 % más por unidad de esfuerzo; a
 *    Soriano, un 25 %). El ritmo de ahora se traduce con ella al terreno que
 *    viene: si lo último que se sabe de alguien es una subida muy dura, no
 *    se le aplica tal cual a la bajada de después —lo que hacía que el aro de
 *    Valen se quedara por detrás de él—.
 * 4. La DERIVA: ese ritmo sigue empeorando con el esfuerzo que queda (1 % por
 *    unidad). Sin ella la previsión salía optimista siempre.
 *
 * Con pocas lecturas la previsión no es más optimista ni más pesimista: es
 * menos segura, y se equivoca hacia donde fuera lo último que se sabe.
 */

/** Resolución del perfil de esfuerzo, en km. */
const PASO_KM = 0.05
/** Ventana de la pendiente: ±2 pasos, unos 200 m. Menos sería ruido del GPX. */
const VENTANA = 2
/** A partir de qué pendiente cuenta como subida (fracción). */
const SUBIDA = 0.03
/**
 * Cuánto empeora su ritmo por unidad de esfuerzo que queda. Ver la cabecera.
 *
 * 0,6 %: con la traza de Soriano hasta el km 51 (73 previsiones desde ocho
 * puntos de la carrera), 0 salía optimista (−26 min de sesgo), 1 % pesimista
 * (+18) y esto, sin sesgo y ~16 min de error medio. El 1 % se había ajustado
 * con media carrera y se pasaba en las previsiones largas.
 */
export const DERIVA = 0.006
/** Su ritmo "de ahora": el de este rato hacia atrás. */
const VENTANA_MIN = 60
/** Y como poco este esfuerzo, para que un par de lecturas no decidan solas:
 *  si la última hora no llega (o solo hay pasos anotados), se tira más atrás. */
const ESFUERZO_MIN = 1
/** Lo mínimo para ajustar: kilómetros hechos. */
const MIN_KM = 3
/** Para la forma: tramos de al menos esto, y cuánto pesa la media (ancla). */
const TRAMO_KM = 0.5
const ANCLA = 2
/** Una forma fuera de esto no se cree (datos raros): se acota. */
const FORMA_MIN = 0.7
const FORMA_MAX = 2.5

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
  /** Minutos por km de esfuerzo en subida y en el resto: el ritmo que lleva,
   *  repartido según su forma. */
  sube: number
  resto: number
  /** Las paradas previstas en los avituallamientos (ver `lib/avituallamientos`):
   *  se descuentan al medir su ritmo y se suman al prever. */
  paradas?: Parada[]
}

/** Una parada prevista: en qué km y cuántos minutos. */
export interface Parada { km: number; min: number }

/** Los minutos de parada previstos entre dos km (sin incluir el primero). */
function paradaEntre(paradas: Parada[] | undefined, desdeKm: number, hastaKm: number): number {
  if (!paradas) return 0
  let min = 0
  for (const p of paradas) if (p.km > desdeKm + 0.02 && p.km <= hastaKm + 0.02) min += p.min
  return min
}

/**
 * Su forma: cuánto más le cuesta subir que el resto, por unidad de esfuerzo,
 * con toda la carrera. Mínimos cuadrados con un ancla hacia 1 (sin datos, la
 * de Tobler tal cual).
 */
function formaDe(perfil: PerfilEsfuerzo, muestras: { km: number; t: number }[], salidaMs: number, paradas?: Parada[]): number {
  const tramos: { up: number; ot: number; min: number }[] = []
  let a = { km: 0, t: salidaMs }
  for (const s of muestras) {
    if (s.t <= a.t || s.km - a.km < TRAMO_KM) continue
    tramos.push({
      up: acumulado(perfil.sube, s.km) - acumulado(perfil.sube, a.km),
      ot: acumulado(perfil.resto, s.km) - acumulado(perfil.resto, a.km),
      min: Math.max((s.t - a.t) / 120_000, (s.t - a.t) / 60_000 - paradaEntre(paradas, a.km, s.km)),
    })
    a = s
  }
  const sumE = tramos.reduce((x, t) => x + t.up + t.ot, 0)
  if (tramos.length < 2 || !(sumE > 0)) return 1
  const media = tramos.reduce((x, t) => x + t.min, 0) / sumE
  let suu = ANCLA, soo = ANCLA, suo = 0, sut = ANCLA * media, sot = ANCLA * media
  for (const t of tramos) {
    suu += t.up * t.up; soo += t.ot * t.ot; suo += t.up * t.ot
    sut += t.up * t.min; sot += t.ot * t.min
  }
  const det = suu * soo - suo * suo
  if (!(det > 0)) return 1
  const sube = (sut * soo - sot * suo) / det
  const resto = (sot * suu - sut * suo) / det
  if (!(sube > 0) || !(resto > 0)) return 1
  return Math.max(FORMA_MIN, Math.min(FORMA_MAX, sube / resto))
}

/**
 * El ritmo que lleva, por unidad de esfuerzo: el de su última hora (o su
 * último tramo entre dos pasos). Null sin datos suficientes.
 *
 * @param muestras `{km, t}` sobre el recorrido, en orden, desde la salida.
 */
export function ajustaRitmo(
  perfil: PerfilEsfuerzo, muestras: { km: number; t: number }[], salidaMs: number,
  /** Las paradas previstas: su tiempo no es ritmo, y se descuenta. */
  paradas?: Parada[],
): RitmoAjustado | null {
  const validas = muestras.filter((s) => s.t > salidaMs)
  if (validas.length === 0) return null
  const ultima = validas[validas.length - 1]
  if (ultima.km < MIN_KM) return null
  const esfuerzo = (km: number) => acumulado(perfil.sube, km) + acumulado(perfil.resto, km)
  const eUltima = esfuerzo(ultima.km)
  // Hacia atrás: la última hora, y si no llega al esfuerzo mínimo, más atrás.
  let desde: { km: number; t: number } = { km: 0, t: salidaMs }
  for (let i = validas.length - 2; i >= -1; i--) {
    const s = i >= 0 ? validas[i] : { km: 0, t: salidaMs }
    desde = s
    const dentroDeLaHora = ultima.t - s.t <= VENTANA_MIN * 60_000
    if (!dentroDeLaHora && eUltima - esfuerzo(s.km) >= ESFUERZO_MIN) break
  }
  // Lo parado en los avituallamientos no es ritmo: se descuenta (como mucho la
  // mitad del rato, por si el corredor no paró lo previsto).
  const brutoMin = (ultima.t - desde.t) / 60_000
  const dMin = Math.max(brutoMin / 2, brutoMin - paradaEntre(paradas, desde.km, ultima.km))
  const upR = acumulado(perfil.sube, ultima.km) - acumulado(perfil.sube, desde.km)
  const otR = acumulado(perfil.resto, ultima.km) - acumulado(perfil.resto, desde.km)
  const q = formaDe(perfil, validas, salidaMs, paradas)
  // El ritmo de ahora, en "resto": lo reciente, descontando su forma.
  const pesoReciente = q * upR + otR
  if (!(pesoReciente > 0) || !(dMin > 0)) return null
  const resto = dMin / pesoReciente
  return { sube: resto * q, resto, paradas }
}

/**
 * Cuándo llegará al km `hastaKm`, sabiendo que estaba en `desdeKm` a `desdeMs`:
 * el esfuerzo que queda hasta allí, al ritmo que lleva, con la deriva.
 */
export function prediceLlegada(
  perfil: PerfilEsfuerzo, ritmo: RitmoAjustado,
  desdeKm: number, desdeMs: number, hastaKm: number, _salidaMs: number,
): number | null {
  if (hastaKm <= desdeKm) return desdeMs
  const hasta = Math.min(hastaKm, perfil.totalKm)
  const up = acumulado(perfil.sube, hasta) - acumulado(perfil.sube, desdeKm)
  const ot = acumulado(perfil.resto, hasta) - acumulado(perfil.resto, desdeKm)
  const dE = up + ot
  if (!(dE >= 0)) return null
  const minutos = (ritmo.sube * up + ritmo.resto * ot) * (1 + (DERIVA * dE) / 2)
    // Y lo que se para en los avituallamientos de por medio.
    + paradaEntre(ritmo.paradas, desdeKm, hasta)
  return desdeMs + minutos * 60_000
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
