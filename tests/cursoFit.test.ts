import { describe, it, expect } from 'vitest'
import {
  capIndices, courseRecordIndices, dedupeIndices, selectCoursePoints, simplifyIndices, truncateUtf8,
} from '../src/lib/fitCourse'
import type { GpxNamedWaypoint } from '../src/lib/gpx'

/**
 * Qué se le manda al reloj en un curso FIT.
 *
 * Garmin Connect se traga cualquier cosa; el reloj no. Un Fenix 7 se REINICIA
 * al abrir un curso demasiado grande, y el mismo recorrido en GPX va fino
 * porque Connect, al importar un GPX, recorta puntos por su cuenta — el FIG se
 * lo queda tal cual. O sea que el tamaño lo tenemos que arreglar aquí.
 */

/** Puntos en línea recta hacia el norte, separados `metros`. */
function recta(n: number, metros = 10) {
  const paso = metros / 110_540
  return Array.from({ length: n }, (_, i) => ({ lat: 41 + i * paso, lon: 2 }))
}

describe('los puntos de trazado que se mandan', () => {
  it('tira las posiciones repetidas, que dejan tramos de longitud cero', () => {
    // De esos había 1 485 en un fichero real: el rumbo entre dos puntos
    // idénticos no está definido, y ahí es donde se atraganta el reloj.
    const pts = [
      { lat: 41, lon: 2 }, { lat: 41, lon: 2 }, { lat: 41, lon: 2 },
      { lat: 41.001, lon: 2 }, { lat: 41.002, lon: 2 },
    ]
    expect(dedupeIndices(pts)).toEqual([0, 3, 4])
  })

  it('en una recta se queda con las puntas y tira lo de en medio', () => {
    const r = simplifyIndices(recta(500), [...Array(500).keys()], 4)
    expect(r).toEqual([0, 499])
  })

  it('pero una curva de verdad no se pierde', () => {
    // Una escuadra: cien metros al norte y cien al este. El vértice se queda.
    const pts = [
      ...recta(11, 10),
      ...Array.from({ length: 10 }, (_, i) => ({ lat: 41 + 100 / 110_540, lon: 2 + ((i + 1) * 10) / 83_000 })),
    ]
    const r = simplifyIndices(pts, [...Array(pts.length).keys()], 4)
    expect(r[0]).toBe(0)
    expect(r[r.length - 1]).toBe(pts.length - 1)
    expect(r).toContain(10) // el vértice
  })

  it('nunca pasa del tope, y conserva principio y final', () => {
    const r = capIndices([...Array(9000).keys()], 6000)
    expect(r.length).toBe(6000)
    expect(r[0]).toBe(0)
    expect(r[r.length - 1]).toBe(8999)
  })

  it('un recorrido denso sale muy por debajo del límite del reloj', () => {
    // 30 000 puntos cada 5 m —150 km de autopista— es justo el caso que
    // reventaba: antes salían 16 000 puntos, por encima de los ~10 000 que
    // aguanta un Fenix 7.
    const r = courseRecordIndices(recta(30_000, 5))
    expect(r.length).toBeLessThanOrEqual(6000)
    expect(r[r.length - 1]).toBe(29_999)
  })
})

const poi = (name: string, km: number, corte?: string): GpxNamedWaypoint => ({
  lat: 41 + km / 111, lon: 2, ele: null, name,
  distanceKm: km, nearestTrackIndex: Math.round(km),
  cutoffWallClock: corte
    ? { hour: Number(corte.slice(0, 2)), minute: Number(corte.slice(3, 5)) }
    : undefined,
})

describe('los puntos de curso', () => {
  it('un control repetido en el GPX es UN punto, y manda el que lleva corte', () => {
    // El GPX de la organización trae el cierre y su avituallamiento en las
    // mismas coordenadas. En el reloj, duplicarlos gasta cupo y avisa dos
    // veces de lo mismo.
    const r = selectCoursePoints([
      poi('Avituallamiento Villanúa', 24.61),
      poi('Villanúa cierre', 24.61, '23:50'),
      poi('Meta', 60),
    ])
    expect(r.map((w) => w.name)).toEqual(['Villanúa cierre', 'Meta'])
  })

  it('pasado el tope del reloj, los cortes son los que se quedan', () => {
    const cortes = Array.from({ length: 20 }, (_, i) => poi(`corte ${i}`, i * 10 + 5, '10:00'))
    const sueltos = Array.from({ length: 400 }, (_, i) => poi(`suelto ${i}`, i * 0.5))
    const r = selectCoursePoints([...cortes, ...sueltos])
    expect(r.length).toBe(200)
    for (const c of cortes) expect(r).toContain(c)
  })

  it('el nombre se recorta sin partir un carácter por la mitad', () => {
    const bytes = Array.from(new TextEncoder().encode('Villanúa'))  // la ú ocupa dos
    // «Villan» son seis bytes justos, así que a seis se corta limpio...
    expect(new TextDecoder().decode(new Uint8Array(truncateUtf8(bytes, 6)))).toBe('Villan')
    // ...y a siete el corte caería DENTRO de la «ú», así que se retrocede.
    const cortado = new TextDecoder().decode(new Uint8Array(truncateUtf8(bytes, 7)))
    expect(cortado).toBe('Villan')
    expect(new TextDecoder().decode(new Uint8Array(truncateUtf8(bytes, 99)))).toBe('Villanúa')
  })
})
