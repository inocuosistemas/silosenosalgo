/**
 * Dar a alguien por retirado, y decir DESDE CUÁNDO.
 *
 * Una baliza que sigue encendida no dice si quien la lleva sigue en carrera. En
 * la CanFranc pasaron los tres casos el mismo día: uno se quedó parado hora y
 * media a 2500 m, otro volvió al pueblo de salida en coche y su app lo colocó
 * en meta, y un tercero simplemente perdió cobertura durante horas —y ese NO
 * había abandonado—. Distinguirlos importa: un retirado que sigue contando
 * ensucia la clasificación, y un corredor vivo dado por retirado es mucho peor.
 *
 * La regla de oro es que **el silencio nunca es prueba**. Sin puntos frescos no
 * se sabe nada: quien está sin cobertura sigue corriendo hasta que se demuestre
 * lo contrario. Todo lo que hay aquí exige que la baliza SIGA HABLANDO.
 *
 * Y lo que se busca no es "cuándo nos hemos dado cuenta" sino **cuándo dejó la
 * carrera**: el instante en que se paró, o en que dio la vuelta. Esa es la hora
 * que vale para la clasificación y la que se le enseña a su gente.
 */

/** Una observación de la traza: cuándo y por qué kilómetro. */
export interface Paso {
  t: number
  km: number
}

export type MotivoAbandono = 'fuera-del-entorno' | 'parado' | 'media-vuelta' | 'salto'

export interface Abandono {
  motivo: MotivoAbandono
  /** Cuándo dejó la carrera (no cuándo se detectó). */
  desdeMs: number
  /** El kilómetro donde la dejó: el último que cuenta. */
  km: number
}

export interface DatosAbandono {
  /** La traza reciente, en orden y con su kilómetro. */
  pasos: Paso[]
  /** Ahora, para medir lo que lleva parado. */
  ahoraMs: number
  /** El próximo cierre por delante: kilómetro y hora. Sin cortes por delante se
   *  pasa el de meta, que es el último que hay. */
  corte: { km: number; atMs: number } | null
  /** Su ritmo DEMOSTRADO (min/km) en lo que lleva de carrera. Es el que decide
   *  si el corte sigue a su alcance: el de otro no le sirve de nada. */
  ritmoMinKm: number | null
  /**
   * El cierre de META, que es el último plazo de todos.
   *
   * Se mira aparte del próximo corte porque son preguntas distintas: se puede
   * llegar de sobra al corte de al lado y no tener ya tiempo material de
   * terminar la carrera. Quien lleva dos horas parado suele estar justo ahí.
   */
  meta?: { km: number; atMs: number } | null
  /** A qué distancia del trazado está su última posición (km). Nulo si no se
   *  puede medir. */
  desviadoKm?: number | null
  /** Ya cruzó la meta: entonces no hay abandono que valer. */
  enMeta?: boolean
}

/**
 * A partir de qué distancia del trazado ya no se está corriendo la carrera.
 *
 * Cinco kilómetros. Una carrera de montaña pasa por valles y collados donde el
 * GPS se va, y perderse de verdad son cientos de metros; pero a cinco kilómetros
 * del recorrido no hay error de posición que valga. En la CanFranc la baliza de
 * quien había abandonado siguió emitiendo desde **174 km** y a 107 km/h — en la
 * autovía, camino de casa— y el mapa lo colocaba el primero de la carrera.
 *
 * Generoso a propósito: esto retira gente de una clasificación, y equivocarse
 * hacia el lado de esperar un poco más no le hace daño a nadie.
 */
export const FUERA_KM = 5
/** Qué parte del recorrido hay que llevar hecha para que el ritmo medio sirva
 *  para juzgar si la META es alcanzable. Una décima. */
export const MINIMO_PARA_JUZGAR_META = 0.1
/** Cuánto hay que llevar sin avanzar para que "parado" signifique algo. Menos
 *  que esto es un avituallamiento, una foto o atarse una bota. */
export const PARADO_MIN = 25
/**
 * A qué velocidad se deja de estar parado.
 *
 * En VELOCIDAD y no en metros, y esto costó un fallo: con un umbral de 150 m
 * entre puntos, un corredor a 23 min/km —que en dos minutos hace 87 m— nunca
 * salía de "parado", así que la parada parecía haber empezado horas antes de
 * cuando empezó. Medio km/h separa el GPS bailando sobre una mesa de alguien
 * que camina, por despacio que vaya.
 */
export const PARADO_KMH = 0.6
/** Cuánto hay que desandar para que sea media vuelta y no un rodeo. Un
 *  kilómetro no se retrocede por error. */
export const RETROCESO_KM = 1
/** Cuántas veces su propio ritmo hay que sostener para que sea un vehículo.
 *  Tres: nadie triplica su ritmo de ultra a las diez horas de carrera. */
export const SALTO_FACTOR = 3
/** Sobre cuánto tiempo, como poco, se mide un salto; y cuánto hay que avanzar
 *  en él. Por debajo de esto es el GPS bailando, no un coche. */
export const SALTO_VENTANA_MS = 2 * 60_000
export const SALTO_MIN_KM = 0.5
/** Y un suelo, para que a ritmos muy lentos no salte con cualquier cosa. */
export const SALTO_MIN_KMH = 12

/**
 * ¿Ha abandonado? Devuelve el motivo, el kilómetro y desde cuándo, o nulo.
 *
 * El orden importa: primero lo que es un hecho observado (dio la vuelta, fue en
 * coche) y al final lo que es un pronóstico (parado y ya no llega). Así, si
 * coinciden dos, manda el más seguro.
 */
export function detectaAbandono(d: DatosAbandono): Abandono | null {
  const { pasos, ahoraMs, corte, meta, ritmoMinKm, enMeta, desviadoKm } = d
  if (enMeta) return null
  if (pasos.length < 3) return null

  const ultimo = pasos[pasos.length - 1]
  // Sin señal fresca no se juzga a nadie: el silencio no es prueba de nada, y
  // dar por retirado a quien solo está en una zona de sombra es el peor error
  // que puede cometer esto.
  if (ahoraMs - ultimo.t > PARADO_MIN * 60_000) return null

  // El máximo alcanzado y cuándo: es el kilómetro donde se deja la carrera en
  // casi todos los motivos, porque es lo último que se hizo corriendo.
  // ── 0. Fuera del entorno de la carrera ───────────────────────────────────
  // Lo más seguro de todo, y por eso lo primero: se puede discutir si alguien
  // está parado o dando media vuelta, pero no si está a cinco kilómetros del
  // recorrido. Ahí no hay carrera que seguir.
  // ── 1. Media vuelta ──────────────────────────────────────────────────────
  // Se mide contra el máximo alcanzado, no contra el punto anterior: volver
  // sobre tus pasos un kilómetro entero no se hace sin querer.
  let maxKm = pasos[0].km
  let maxEn = pasos[0].t
  for (const p of pasos) {
    if (p.km > maxKm) { maxKm = p.km; maxEn = p.t }
  }
  if (desviadoKm != null && desviadoKm > FUERA_KM) {
    return { motivo: 'fuera-del-entorno', desdeMs: maxEn, km: maxKm }
  }

  if (maxKm - ultimo.km >= RETROCESO_KM) {
    // Y sostenido: que los últimos puntos vengan BAJANDO. Con eso se descarta
    // el punto suelto que la proyección coloca mal en un tramo de ida y vuelta,
    // sin exigir que cada uno esté ya un kilómetro por detrás —cuando da la
    // vuelta, el primero que desanda está a pocos metros—.
    const ultimos = pasos.slice(-3)
    const bajando = ultimos.every((p, i) => i === 0 || p.km <= ultimos[i - 1].km + 0.02)
    if (ultimos.length >= 3 && bajando) {
      return { motivo: 'media-vuelta', desdeMs: maxEn, km: maxKm }
    }
  }

  // ── 2. Vehículo ──────────────────────────────────────────────────────────
  // Un avance que no se puede hacer con las piernas. Se compara con SU ritmo,
  // que es lo que lo distingue de un corredor rápido, y con un suelo para que
  // no salte con un ritmo de paseo.
  if (ritmoMinKm != null && ritmoMinKm > 0) {
    const suyaKmh = 60 / ritmoMinKm
    const techo = Math.max(SALTO_MIN_KMH, suyaKmh * SALTO_FACTOR)
    // De delante hacia atrás y se devuelve el PRIMERO: lo que interesa es dónde
    // dejó de ir a pie, no el último tramo del viaje en coche.
    //
    // Y medido sobre un trecho que signifique algo: con un punto cada quince
    // segundos, el GPS que se va sesenta metros y vuelve da 33 km/h entre dos
    // puntos seguidos. Pasó en Matxicots 26: Soriano "abandonó por avance
    // imposible a pie" corriendo tan normal por el km 11. Un coche, en cambio,
    // hace medio kilómetro en dos minutos sin ningún esfuerzo.
    let j = 0
    for (let i = 1; i < pasos.length; i++) {
      const b = pasos[i]
      // El punto más reciente que quede al menos SALTO_VENTANA_MS por detrás.
      while (j + 1 < i && b.t - pasos[j + 1].t >= SALTO_VENTANA_MS) j++
      const a = pasos[j]
      const horas = (b.t - a.t) / 3_600_000
      if (horas * 3_600_000 < SALTO_VENTANA_MS) continue
      if (b.km - a.km >= SALTO_MIN_KM && (b.km - a.km) / horas > techo) {
        return { motivo: 'salto', desdeMs: a.t, km: a.km }
      }
    }
  }

  // ── 3. Parado y sin opción al corte ──────────────────────────────────────
  // Parado solo no basta: en una ultra se duerme, se come y se cambia de ropa.
  // Lo que lo convierte en abandono es que, aunque se levantara ahora mismo y
  // siguiera al ritmo que llevaba, el corte ya no le da.
  const desde = inicioDeLaParada(pasos)
  if (desde && ahoraMs - desde.t >= PARADO_MIN * 60_000 && ritmoMinKm != null && ritmoMinKm > 0) {
    /** ¿Le da el reloj para llegar ahí, si se levantara ahora y siguiera a su
     *  ritmo? El ritmo que se usa es el suyo MEDIDO, parones incluidos: es lo
     *  que de verdad ha demostrado que puede hacer hoy. */
    const noLlega = (d?: { km: number; atMs: number } | null) => {
      if (!d) return false
      const quedan = d.km - ultimo.km
      const disponibles = (d.atMs - ahoraMs) / 60_000
      return quedan > 0 && disponibles > 0 && quedan * ritmoMinKm > disponibles
    }
    // La meta solo se juzga con carrera hecha. El ritmo medio de los primeros
    // kilómetros no significa nada —una parada de media hora en el km 5 lo
    // dispara— y con él cualquiera parecería incapaz de terminar. A partir de
    // la décima parte del recorrido ya es un ritmo suyo, no una anécdota.
    const metaJuzgable = meta && ultimo.km >= meta.km * MINIMO_PARA_JUZGAR_META
    // El próximo corte O la meta: se puede llegar de sobra al corte de al lado
    // y no tener ya tiempo material de terminar la carrera.
    if (noLlega(corte) || (metaJuzgable && noLlega(meta))) {
      return { motivo: 'parado', desdeMs: desde.t, km: desde.km }
    }
  }

  return null
}

/**
 * Cuándo empezó a estar quieto: el primer punto de la racha final en la que ya
 * no avanza. Es la hora que se enseña —"abandonó a las 07:43"—, no la de
 * cuando lo hemos notado, que puede ser dos horas más tarde.
 */
function inicioDeLaParada(pasos: Paso[]): Paso | null {
  let inicio: Paso | null = null
  for (let i = pasos.length - 1; i > 0; i--) {
    const a = pasos[i - 1], b = pasos[i]
    const horas = (b.t - a.t) / 3_600_000
    const kmh = horas > 0 ? Math.abs(b.km - a.km) / horas : 0
    if (kmh <= PARADO_KMH) inicio = a
    else break
  }
  // Si la racha es toda la traza que tenemos, no se sabe cuándo empezó: hay que
  // decirlo con el primer punto conocido y no inventar una hora anterior.
  return inicio
}

/** Cómo se lee en pantalla. */
export function motivoTexto(m: MotivoAbandono): string {
  return m === 'fuera-del-entorno' ? 'fuera del entorno de la carrera'
    : m === 'parado' ? 'parado sin opción al corte'
    : m === 'media-vuelta' ? 'dio media vuelta'
    : 'avance imposible a pie'
}
