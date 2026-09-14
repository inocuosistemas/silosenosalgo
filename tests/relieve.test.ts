import { describe, it, expect } from 'vitest'
import {
  alturasTerrarium, conMarco, mosaicoDeAlturas, metrosPorPixel, sombreado, sombraConMarco, exageracionPara, opacidadRelieve, ZOOM_MAX_ALTURAS,
  type Vecinos,
} from '../src/lib/relieve'

type Altura = (r: number, c: number) => number

/** Un PNG Terrarium de mentira: cada píxel con la altura que diga `altura(fila, col)`. */
function terrarium(lado: number, altura: Altura): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(lado * lado * 4)
  for (let r = 0; r < lado; r++) {
    for (let c = 0; c < lado; c++) {
      const v = altura(r, c) + 32768
      const p = (r * lado + c) * 4
      rgba[p] = Math.floor(v / 256)
      rgba[p + 1] = Math.floor(v) % 256
      rgba[p + 2] = Math.round((v - Math.floor(v)) * 256)
      rgba[p + 3] = 255
    }
  }
  return rgba
}

const alturas = (lado: number, altura: Altura) => alturasTerrarium(terrarium(lado, altura), lado)

function sombrea(lado: number, altura: Altura, vecinos: Partial<Record<keyof Vecinos, Altura>> = {}, mpp = 30) {
  const v: Vecinos = { norte: null, sur: null, este: null, oeste: null }
  for (const k of Object.keys(vecinos) as (keyof Vecinos)[]) v[k] = alturas(lado, vecinos[k]!)
  const salida = new Uint8ClampedArray(lado * lado * 4)
  sombreado(conMarco(alturas(lado, altura), lado, v), lado, mpp, 1, salida)
  return salida
}

describe('alturasTerrarium', () => {
  it('descodifica los tres canales', () => {
    const h = alturas(2, (r, c) => [1234, 0.5, 3404, 100][r * 2 + c])
    expect(Array.from(h)).toEqual([1234, 0.5, 3404, 100])
  })

  it('el fondo del mar cuenta como nivel del mar', () => {
    expect(Array.from(alturas(1, () => -2000))).toEqual([0])
  })
})

describe('mosaicoDeAlturas', () => {
  it('tira del nivel de encima: un mosaico de alturas cubre cuatro del mapa', () => {
    expect(mosaicoDeAlturas(2043, 1509, 12)).toEqual({ x: 1021, y: 754, z: 11, ox: 128, oy: 128, lado: 128 })
    expect(mosaicoDeAlturas(2042, 1508, 12)).toEqual({ x: 1021, y: 754, z: 11, ox: 0, oy: 0, lado: 128 })
  })

  it('más cerca no pide más detalle del que hay: estira el del tope', () => {
    const m = mosaicoDeAlturas(8171, 6035, 14)
    expect(m).toEqual({ x: 2042, y: 1508, z: ZOOM_MAX_ALTURAS, ox: 192, oy: 192, lado: 64 })
  })

  it('en el mundo entero, el mundo entero', () => {
    expect(mosaicoDeAlturas(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0, ox: 0, oy: 0, lado: 256 })
  })
})

describe('metrosPorPixel', () => {
  it('en el ecuador, la circunferencia entre los píxeles del mundo', () => {
    expect(metrosPorPixel(0, 1)).toBeCloseTo(40_075_016.686 * Math.cos(Math.atan(Math.sinh(Math.PI / 2))) / 512, 3)
    expect(metrosPorPixel(0.5 * 2 ** 10 - 0.5, 10)).toBeCloseTo(40_075_016.686 / (256 * 1024), 3)
  })

  it('en el Pirineo, a zoom 12, unos 28 m', () => {
    expect(metrosPorPixel(1508, 12)).toBeGreaterThan(27)
    expect(metrosPorPixel(1508, 12)).toBeLessThan(30)
  })
})

describe('conMarco', () => {
  it('el marco sale del mosaico de al lado cuando está', () => {
    const m = conMarco(alturas(3, () => 10), 3, {
      norte: alturas(3, (r) => 100 + r), sur: alturas(3, (r) => 200 + r),
      oeste: alturas(3, (_, c) => 300 + c), este: alturas(3, (_, c) => 400 + c),
    })
    const fila = (r: number) => Array.from(m.subarray(r * 5, r * 5 + 5))
    expect(fila(0).slice(1, 4)).toEqual([102, 102, 102]) // la última fila del de arriba
    expect(fila(4).slice(1, 4)).toEqual([200, 200, 200]) // la primera del de abajo
    expect(fila(2)).toEqual([302, 10, 10, 10, 400]) // la última columna del oeste, la primera del este
  })

  it('sin vecino, prolonga la curva de dentro', () => {
    const m = conMarco(alturas(3, (_, c) => c * c), 3, { norte: null, sur: null, este: null, oeste: null })
    expect(Array.from(m.subarray(5, 10))).toEqual([1, 0, 1, 4, 9])
  })
})

describe('sombreado', () => {
  const alfas = (rgba: Uint8ClampedArray) => Array.from(rgba.filter((_, i) => i % 4 === 3))
  const colores = (rgba: Uint8ClampedArray) => new Set(Array.from(rgba.filter((_, i) => i % 4 === 0)))

  it('lo llano no se toca', () => {
    expect(new Set(alfas(sombrea(4, () => 850)))).toEqual(new Set([0]))
  })

  it('la ladera que mira al oeste recibe la luz del noroeste: se aclara', () => {
    const s = sombrea(4, (_, c) => c * 30)
    expect(colores(s)).toEqual(new Set([255]))
    expect(Math.min(...alfas(s))).toBeGreaterThan(0)
  })

  it('la que mira al este le da la espalda: se oscurece, y más de lo que se aclara la otra', () => {
    const sombra = sombrea(4, (_, c) => (3 - c) * 30)
    const luz = sombrea(4, (_, c) => c * 30)
    expect(colores(sombra)).toEqual(new Set([0]))
    expect(Math.min(...alfas(sombra))).toBeGreaterThan(Math.max(...alfas(luz)))
  })

  it('el norte y el sur, con las filas hacia abajo: sube hacia el norte, mira al sur, sombra', () => {
    expect(colores(sombrea(4, (r) => (3 - r) * 30))).toEqual(new Set([0]))
    expect(colores(sombrea(4, (r) => r * 30))).toEqual(new Set([255]))
  })

  it('sin tope plano: cuanto más empinada la ladera en sombra, más oscura', () => {
    // Con un tope a secas, en el Pirineo todas las laderas fuertes salían del
    // mismo gris y de cerca se veían manchas lisas con bordes rectos.
    const alfa = (desnivel: number) => sombrea(4, (_, c) => (3 - c) * desnivel)[3]
    expect(alfa(30)).toBeGreaterThan(alfa(15))
    expect(alfa(60)).toBeGreaterThan(alfa(30))
    expect(alfa(120)).toBeGreaterThan(alfa(60))
  })

  it('con el mosaico de al lado, el borde sale exacto: ni rastro de costura', () => {
    // Una ladera con ondas, que ninguna estimación adivina. Tres mosaicos de 6
    // en fila: A (0-5), B (6-11) y M a caballo (3-8), donde el borde de A y B
    // queda dentro.
    const f = (k: number) => 100 + 2 * (12 - k) ** 2 + 15 * Math.sin(k * 1.3)
    const a = (rgba: Uint8ClampedArray, r: number, c: number) => rgba[(r * 6 + c) * 4 + 3]

    const medio = sombrea(6, (_, c) => f(c + 3))
    expect(a(sombrea(6, (_, c) => f(c), { este: (_, c) => f(c + 6) }), 2, 5)).toBe(a(medio, 2, 2))
    expect(a(sombrea(6, (_, c) => f(c + 6), { oeste: (_, c) => f(c) }), 2, 0)).toBe(a(medio, 2, 3))

    const medioNS = sombrea(6, (r) => f(r + 3))
    expect(a(sombrea(6, (r) => f(r), { sur: (r) => f(r + 6) }), 5, 2)).toBe(a(medioNS, 2, 2))
    expect(a(sombrea(6, (r) => f(r + 6), { norte: (r) => f(r) }), 0, 2)).toBe(a(medioNS, 3, 2))

    // Sin el vecino se nota: por eso se espera a que llegue y se repinta.
    expect(a(sombrea(6, (_, c) => f(c)), 2, 5)).not.toBe(a(medio, 2, 2))
  })

  it('sin vecino, en una ladera curva el borde casa con lo de dentro', () => {
    // La misma ladera cóncava entera (12 columnas) y en dos trozos de 6: la
    // columna 5 del entero cae en el borde de los dos.
    const dentro = sombrea(12, (_, c) => 2 * (12 - c) ** 2)
    const izquierda = sombrea(6, (_, c) => 2 * (12 - c) ** 2)
    const derecha = sombrea(6, (_, c) => 2 * (7 - c) ** 2)
    const alfa = (rgba: Uint8ClampedArray, lado: number, c: number) => rgba[(2 * lado + c) * 4 + 3]
    expect(Math.abs(alfa(izquierda, 6, 5) - alfa(dentro, 12, 5))).toBeLessThanOrEqual(1)
    expect(Math.abs(alfa(derecha, 6, 0) - alfa(dentro, 12, 5))).toBeLessThanOrEqual(1)
  })

  it('la misma cuesta, el mismo tono en todo el mosaico', () => {
    expect(new Set(alfas(sombrea(4, (_, c) => (3 - c) * 30))).size).toBe(1)
  })
})

describe('sombraConMarco', () => {
  // Un sombreado de mentira de 2×2: cada píxel, un gris distinto.
  const gris = (base: number) => new Uint8ClampedArray([0, 1, 2, 3].flatMap((i) => [base + i, base + i, base + i, 255]))
  const px = (m: Uint8ClampedArray, r: number, c: number) => m[(r * 4 + c) * 4]

  it('el marco sale del sombreado de al lado; sin él, repite el propio borde', () => {
    const m = sombraConMarco(gris(10), 2, { norte: gris(20), sur: null, este: gris(40), oeste: null })
    expect([px(m, 0, 1), px(m, 0, 2)]).toEqual([22, 23]) // la última fila del de arriba
    expect([px(m, 3, 1), px(m, 3, 2)]).toEqual([12, 13]) // sin el de abajo, su propia última fila
    expect([px(m, 1, 3), px(m, 2, 3)]).toEqual([40, 42]) // la primera columna del de la derecha
    expect([px(m, 1, 0), px(m, 2, 0)]).toEqual([10, 12]) // sin el de la izquierda, su primera columna
    expect([px(m, 1, 1), px(m, 1, 2), px(m, 2, 1), px(m, 2, 2)]).toEqual([10, 11, 12, 13])
  })
})

describe('opacidadRelieve', () => {
  it('entera hasta el detalle de los datos; se aclara al acercarse, sin irse del todo', () => {
    expect(opacidadRelieve(10)).toBe(1)
    expect(opacidadRelieve(ZOOM_MAX_ALTURAS)).toBe(1)
    expect(opacidadRelieve(14)).toBeLessThan(opacidadRelieve(13))
    expect(opacidadRelieve(19)).toBeGreaterThan(0.5)
  })
})

describe('exageracionPara', () => {
  it('sin exagerar donde hay detalle; cada vez más al alejarse', () => {
    expect(exageracionPara(ZOOM_MAX_ALTURAS)).toBe(1)
    expect(exageracionPara(10)).toBeGreaterThan(exageracionPara(11))
  })
})
