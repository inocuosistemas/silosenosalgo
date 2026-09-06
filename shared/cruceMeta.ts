/**
 * shared/cruceMeta.ts — el cronómetro de la meta, uno para todos.
 *
 * Vive en `shared` porque lo usan los dos lados y tienen que dar EL MISMO
 * número: los resultados del evento los calcula el servidor con la traza
 * entera, y la vista individual de cada baliza los calcula en el navegador con
 * la suya. Cuando cada uno tenía su cuenta, la misma carrera salía en 7h 15m en
 * la parrilla y en 7:16 h en el visor —veintisiete segundos, que es solo el
 * instante que elige cada método— y quien mira las dos pantallas no tiene forma
 * de saber cuál creerse.
 *
 * La entrada es una SERIE: por cada lectura, su hora, el kilómetro de
 * recorrido en el que cae y los metros que recorrió sobre el suelo desde la
 * anterior. Quien la construye es cosa suya —el servidor proyecta sobre el
 * trazado guardado y el navegador sobre el GPX del plan— pero el cronómetro es
 * este y solo este.
 */

/**
 * El instante de cruzar meta.
 *
 * La meta es una LÍNEA: el kilómetro final del recorrido menos el margen que
 * el trazado guardado permite afinar. Se busca la primera lectura que ya está
 * pasada esa línea —después de haber pasado por la mitad, que en un circuito
 * la meta y la salida son el mismo sitio— y se INTERPOLA con la anterior el
 * momento exacto del cruce.
 *
 * Interpolar es la diferencia entre un cronómetro y una estimación grosera.
 * Antes se devolvía la hora de esa primera lectura pasada del 97%, y con
 * lecturas cada minuto eso son minutos enteros de regalo: en la carrera de
 * referencia, a uno se le cortaba a 161 metros de la meta y llegaba 78
 * segundos después. Y el error era distinto para cada uno, o sea que podía
 * cambiar el ORDEN de llegada, que es lo que de verdad no se puede fallar.
 *
 * El tramo entre las dos lecturas se recorre a velocidad constante: es la
 * mejor información que hay: la velocidad instantánea que declara el GPS de
 * una sola lectura es mucho más ruidosa que el promedio de un tramo.
 */
/**
 * Hasta dónde se fía la extrapolación por velocidad, en metros.
 *
 * Cerca de la línea, la velocidad de hace un minuto sigue valiendo. Lejos ya
 * no: en doscientos metros de trail cabe una cuesta, un avituallamiento o
 * pararse a esperar a alguien, y estirar un ritmo por ahí es inventar.
 */
const EXTRAPOLA_HASTA_M = 150
/** Sobre cuánto rato se mide esa velocidad: bastante para no ir a golpe de una
 *  sola lectura ruidosa, poco para que siga siendo "lo que venía haciendo". */
const VENTANA_MS = 60_000
/** Por debajo de esto ya venía parado, y no hay ritmo que estirar. */
const MINIMA_MS = 0.3

/**
 * A qué velocidad venía justo antes del silencio, en m/s.
 *
 * Sobre metros de SUELO, no de recorrido: al final del trazado los kilómetros
 * se saturan, que es todo el problema que esto viene a resolver.
 */
function velocidadPrevia(serie: [number, number, number][], hasta: number): number | null {
  const fin = serie[hasta]
  if (!fin) return null
  let metros = 0
  let desde = hasta
  while (desde > 0 && fin[0] - serie[desde - 1][0] <= VENTANA_MS) {
    metros += serie[desde][2]
    desde--
  }
  const seg = (fin[0] - serie[desde][0]) / 1000
  if (desde === hasta || seg <= 0 || metros <= 0) return null
  return metros / seg
}

export function crucaMeta(
  serie: [number, number, number][], totalKm: number | null, tolKm: number, circuito: boolean,
): { ms: number; margenMs: number } | null {
  if (totalKm === null || serie.length === 0) return null
  // Haber pasado por la mitad solo se exige en un CIRCUITO, que es donde la
  // meta y la salida son el mismo sitio y estar en una es estar en la otra. En
  // un punto a punto la exigencia sobra y hace daño: a quien se le murió la
  // baliza y la reabrió en el kilómetro 20 de 30 se le daría por no llegado
  // aunque cruzara la meta delante de todos.
  const mitad = totalKm * 0.5

  // Lo más lejos que llegó DESPUÉS de pasar por la mitad. Con la proyección
  // afinada sobre el segmento, quien pisa la meta marca el final exacto del
  // recorrido, así que la línea se pone ahí mismo y no un margen antes: el
  // margen solo hace falta para DECIDIR si llegó, no para cronometrarlo. Y
  // quien se quedó a doce metros por donde le dejó su última lectura se
  // cronometra en esos doce metros, que es lo mejor que se sabe de él.
  let hecho = !circuito
  let tope = 0
  for (const [, km] of serie) {
    if (circuito && km <= mitad) hecho = true
    else if (hecho && km > tope) tope = km
  }
  if (!hecho || tope < totalKm - tolKm) return null
  const meta = Math.min(totalKm, tope)

  hecho = !circuito
  for (let i = 0; i < serie.length; i++) {
    const [t, km] = serie[i]
    if (circuito && km <= mitad) { hecho = true; continue }
    if (!hecho || km < meta) continue
    const previo = i > 0 ? serie[i - 1] : null
    // Sin lectura anterior por detrás de la línea no hay nada que interpolar:
    // se cruzó antes de que lo empezáramos a ver. Y sin nada que interpolar
    // tampoco hay margen que declarar: la hora es la de esa lectura.
    if (!previo || previo[1] >= meta || km <= previo[1]) return { ms: t, margenMs: 0 }
    // Cuánto se avanzó entre las dos lecturas. Normalmente lo dice el
    // recorrido, pero al llegar al final el recorrido SE ACABA y la proyección
    // se queda clavada mientras la persona sigue corriendo: quien cruza la meta
    // a diez metros por delante de la línea aparece avanzando esos diez metros
    // y no los treinta que dio. Con esa cuenta corta, el cruce se iba entero a
    // la lectura de después —un minuto entero si la baliza va ahorrando
    // batería—, que es el sesgo que se quería quitar. Cuando pasa, mandan los
    // metros que midió el GPS sobre el suelo.
    // EN LA META, si queda poco, manda la velocidad que traía.
    //
    // Repartir el hueco a velocidad constante da por hecho que siguió al mismo
    // ritmo hasta la lectura siguiente, y esa lectura, después de una meta, es
    // casi siempre alguien DE PIE respirando. Así que el error no es aleatorio:
    // va siempre en la misma dirección, tarde, y del tamaño del silencio.
    //
    // Medido contra el cronometraje oficial del Desafío Urbión, donde la baliza
    // se calló 97 segundos justo al cruzar: a 36 metros de la línea venía a
    // 2,03 m/s y la lectura de después lo cobraba a 0,51, o sea como si esos
    // metros le hubieran costado minuto y medio. La alfombra decía 15:44:22;
    // nosotros 15:45:19. Con su ritmo previo salen 15:44:26, cuatro segundos.
    //
    // Solo cerca de la línea y solo si traía ritmo: más lejos, o si ya venía
    // parado, no hay nada honesto que estirar y manda el reparto de siempre. Y
    // nunca más tarde de la lectura siguiente, que entonces ya sabemos que
    // había cruzado.
    const restanteM = (meta - previo[1]) * 1000
    if (km >= totalKm - 1e-9 && restanteM <= EXTRAPOLA_HASTA_M) {
      const v = velocidadPrevia(serie, i - 1)
      if (v !== null && v >= MINIMA_MS) {
        const ms = previo[0] + (restanteM / v) * 1000
        if (ms > previo[0] && ms <= t) {
          // El margen NO se afina: lo único que se sabe de verdad sigue siendo
          // que cruzó dentro del hueco, y es lo que hace que la hora oficial
          // caiga dentro de lo que declaramos.
          return { ms, margenMs: Math.max(ms - previo[0], t - ms) }
        }
      }
    }
    let avance = km - previo[1]
    const suelo = serie[i][2] / 1000
    if (km >= totalKm - 1e-9 && suelo > avance) avance = suelo
    const ms = previo[0] + ((meta - previo[1]) / avance) * (t - previo[0])
    // Lo único que se sabe de verdad es que cruzó ENTRE las dos lecturas: en
    // el hueco pudo apretar o pudo pararse a atarse la zapatilla, y la
    // interpolación reparte el tramo a velocidad constante porque es la mejor
    // suposición, no porque sea la verdad. El margen es la distancia al
    // extremo más lejano del hueco: garantiza que la hora real está dentro.
    return { ms, margenMs: Math.max(ms - previo[0], t - ms) }
  }
  return null
}
