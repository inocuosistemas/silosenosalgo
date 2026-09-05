import type { RunnerOutcome } from './bets'

/**
 * Cómo acabó la carrera de cada uno, que es lo que puntúa la porra.
 *
 * Es una traducción de tres líneas, y aun así vive aquí y con una prueba
 * detrás, porque la última vez que estuvo suelta dentro de la pantalla se
 * equivocó en lo único que tenía que acertar: LA HORA DE META.
 *
 * Ponía la hora del último aviso de la baliza. Y el último aviso no es la
 * llegada: quien cruza la meta y no apaga el móvil —que es lo normal, se apaga
 * cuando uno se acuerda, en el coche o al día siguiente— sigue emitiendo desde
 * el bar, así que su "hora de meta" avanzaba con el reloj. En el Desafío Urbión
 * cruzó a las 15:45 y a las 17:17 la porra creía que acababa de llegar: los
 * pronósticos, que a las 16:14 fallaban por 11 minutos, fallaban por 77 una
 * hora después, y los puntos de todo el mundo se fueron derritiendo hasta
 * igualarse en cero. Quien había clavado el tiempo dejó de ganar.
 *
 * La hora buena es la que ya tiene calculada la pantalla: la de los resultados
 * congelados si la carrera cerró —la sacó el servidor con la traza entera— y,
 * mientras se corre, la del PRIMER aviso en que se le vio en meta, que se
 * guarda una vez y no se toca. Aquí solo hay que no perderla por el camino.
 */
export interface FilaDeMeta {
  username: string
  /** Ha mandado alguna posición: sin eso no está en la carrera para la porra. */
  emitiendo: boolean
  /** Ha llegado a meta. */
  acabo: boolean
  /** A qué hora llegó (epoch ms). La congelada si la hay; si no, la del primer aviso en meta. */
  metaEn: number | null
  /** Cerró la baliza sin llegar: se retiró, y eso también decide su carrera. */
  retirado: boolean
}

export function resultadosDeCarrera(filas: FilaDeMeta[]): RunnerOutcome[] {
  return filas.map((f) => ({
    username: f.username,
    tracked: f.emitiendo,
    finished: f.acabo,
    finishedAt: f.acabo ? f.metaEn : null,
    // Decidida está tanto la de quien llegó como la de quien lo dejó. Lo que no
    // decide nada es una baliza que nunca mandó una posición: quien la armó
    // para probar y la apagó puede estar corriendo con el móvil en el bolsillo.
    settled: f.acabo || f.retirado,
  }))
}
