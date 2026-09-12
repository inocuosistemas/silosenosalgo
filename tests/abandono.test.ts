import { describe, it, expect } from 'vitest'
import { detectaAbandono, PARADO_MIN, type Paso } from '../src/lib/abandono'

/**
 * Dar a alguien por retirado.
 *
 * Los tres casos de aquí pasaron el mismo día en la CanFranc-CanFranc, y el
 * cuarto —el que NO hay que marcar— es el que de verdad da miedo: dar por
 * retirado a alguien que solo está sin cobertura es mandar a su familia un
 * disgusto que no toca. Por eso el silencio nunca cuenta como prueba.
 */

const T0 = Date.parse('2026-09-12T05:00:00Z') // 07:00 peninsular
const min = (n: number) => T0 + n * 60_000

/** Una traza que avanza a ritmo constante, un punto cada dos minutos. */
function avanzando(desdeKm: number, kmPorMin: number, cuantos: number, desdeMin = 0): Paso[] {
  return Array.from({ length: cuantos }, (_, i) => ({
    t: min(desdeMin + i * 2),
    km: desdeKm + i * 2 * kmPorMin,
  }))
}

describe('detectar un abandono', () => {
  it('parado hora y media y el corte ya no le da: abandonó cuando se paró', () => {
    // El caso de Soriano: km 22,1 a 2500 m desde las 07:43, a 23 min/km. Al
    // corte del km 41,3 le faltan 19 km y no hay horas que le lleguen.
    const anduvo = avanzando(21.0, 0.05, 6)               // hasta el km 21,5 a las 07:10
    const quieto: Paso[] = Array.from({ length: 45 }, (_, i) => ({ t: min(12 + i * 2), km: 21.5 }))
    const a = detectaAbandono({
      pasos: [...anduvo, ...quieto],
      ahoraMs: min(102),
      corte: { km: 41.3, atMs: min(300) },
      ritmoMinKm: 23,
    })!
    expect(a.motivo).toBe('parado')
    expect(a.km).toBeCloseTo(21.5, 1)
    // La hora es la del último punto en que AÚN SE MOVÍA —cuando llegó ahí y se
    // quedó—, no la de ahora ni la del primer punto quieto: es el instante en
    // que dejó la carrera, y es el que va a la clasificación.
    expect(a.desdeMs).toBe(min(10))
  })

  it('parado el mismo rato pero con el corte a tiro: no es abandono', () => {
    // En una ultra se duerme y se come. Lo que convierte la parada en retirada
    // no es el reloj, es que ya no llegue.
    const a = detectaAbandono({
      pasos: Array.from({ length: 45 }, (_, i) => ({ t: min(i * 2), km: 22.1 })),
      ahoraMs: min(90),
      corte: { km: 30, atMs: min(600) },   // diez horas para ocho kilómetros
      ritmoMinKm: 23,
    })
    expect(a).toBeNull()
  })

  it('dar media vuelta se detecta, y cuenta desde el punto más lejano', () => {
    const ida = avanzando(30, 0.05, 10)                    // hasta el km 30,9
    const vuelta: Paso[] = [31.0, 30.4, 29.8, 29.2].map((km, i) => ({ t: min(20 + i * 2), km }))
    const a = detectaAbandono({
      pasos: [...ida, ...vuelta],
      ahoraMs: min(28),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 12,
    })!
    expect(a.motivo).toBe('media-vuelta')
    expect(a.km).toBeCloseTo(31.0, 1)
    expect(a.desdeMs).toBe(min(20))
  })

  it('un rodeo corto NO es media vuelta', () => {
    // Volver doscientos metros a por un bastón no es retirarse.
    const a = detectaAbandono({
      pasos: [...avanzando(30, 0.05, 10), { t: min(20), km: 30.8 }, { t: min(22), km: 30.75 }],
      ahoraMs: min(23),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 12,
    })
    expect(a).toBeNull()
  })

  it('un avance que no se hace a pie se marca en el último punto bueno', () => {
    // Coger el coche hasta la salida: catorce kilómetros en seis minutos.
    const a = detectaAbandono({
      pasos: [...avanzando(15, 0.02, 6), { t: min(16), km: 29.2 }, { t: min(18), km: 35 }],
      ahoraMs: min(19),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 20,
    })!
    expect(a.motivo).toBe('salto')
    expect(a.km).toBeCloseTo(15.2, 1)
    expect(a.desdeMs).toBe(min(10))
  })

  it('a cinco kilómetros del recorrido ya no se está corriendo', () => {
    // El caso de Malore: su baliza siguió emitiendo desde 174 km, a 107 km/h y
    // a 341 m de altitud —la autovía, camino de casa— y el mapa lo ponía
    // primero de la carrera.
    const a = detectaAbandono({
      pasos: avanzando(14, 0.05, 8),
      ahoraMs: min(15),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 12,
      desviadoKm: 174,
    })!
    expect(a.motivo).toBe('fuera-del-entorno')
    // Se le deja donde estuvo por última vez corriendo, no donde está el coche.
    expect(a.km).toBeCloseTo(14.7, 1)
  })

  it('perderse unos cientos de metros NO saca a nadie de la carrera', () => {
    // En montaña el GPS se va y uno se despista; el umbral es generoso a
    // propósito, que esto retira gente de una clasificación.
    const a = detectaAbandono({
      pasos: avanzando(14, 0.05, 8),
      ahoraMs: min(15),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 12,
      desviadoKm: 0.8,
    })
    expect(a).toBeNull()
  })

  it('SIN COBERTURA no es abandono, por mucho que dure', () => {
    // El error que no se puede cometer: quien lleva dos horas en una zona de
    // sombra sigue corriendo hasta que se demuestre lo contrario.
    const a = detectaAbandono({
      pasos: avanzando(22, 0.02, 6),
      ahoraMs: min(10 + PARADO_MIN * 4),   // horas sin un punto nuevo
      corte: { km: 41.3, atMs: min(60) },
      ritmoMinKm: 23,
    })
    expect(a).toBeNull()
  })

  it('quien ya está en meta nunca abandona, aunque lleve horas quieto', () => {
    const a = detectaAbandono({
      pasos: Array.from({ length: 45 }, (_, i) => ({ t: min(i * 2), km: 99.5 })),
      ahoraMs: min(90),
      corte: null,
      ritmoMinKm: 23,
      enMeta: true,
    })
    expect(a).toBeNull()
  })

  it('sin ritmo demostrado no se juzga: no hay con qué comparar', () => {
    const a = detectaAbandono({
      pasos: Array.from({ length: 45 }, (_, i) => ({ t: min(i * 2), km: 22.1 })),
      ahoraMs: min(90),
      corte: { km: 41.3, atMs: min(100) },
      ritmoMinKm: null,
    })
    expect(a).toBeNull()
  })

  it('si vuelve a andar deja de estar retirado', () => {
    // La regla no guarda memoria a propósito: se recalcula con lo que hay, así
    // que el que se levanta y sigue vuelve a la carrera él solo.
    const quieto: Paso[] = Array.from({ length: 30 }, (_, i) => ({ t: min(i * 2), km: 22.1 }))
    const sigue = avanzando(22.1, 0.04, 6, 60)
    const a = detectaAbandono({
      pasos: [...quieto, ...sigue],
      ahoraMs: min(72),
      corte: { km: 41.3, atMs: min(600) },
      ritmoMinKm: 23,
    })
    expect(a).toBeNull()
  })
})
