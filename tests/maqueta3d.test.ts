import { describe, it, expect } from 'vitest'
import {
  LADO_MOSAICO, aLineal, aligera, alturaEn, cajaDeMaqueta, casasDeLugar, cintaSobreTerreno, colorPorAltura, cordonSobreTerreno, escalaDeMaqueta, exageracionMaqueta,
  mallaDeMaqueta, mosaicosDeRejilla, muestreaAlturas, paradasRgb, proyecta, reduceRejilla, rejillaDeMaqueta, sitioDeFraccion, sitioEnMaqueta,
  sitiosDeArboles, tablaDeColores,
  type Rejilla,
} from '../src/lib/maqueta3d'
import { COLOR_AGUA } from '../src/lib/mapa3d'
import { MASCARA_AGUA, MASCARA_BOSQUE, MASCARA_RIO } from '../shared/maquetaPaquete'

describe('cajaDeMaqueta', () => {
  it('el rectángulo del recorrido con un 8 % de margen por cada lado', () => {
    const c = cajaDeMaqueta([[42.7, -0.6], [42.8, -0.4]])!
    expect(c.s).toBeCloseTo(42.692)
    expect(c.n).toBeCloseTo(42.808)
    expect(c.o).toBeCloseTo(-0.616)
    expect(c.e).toBeCloseTo(-0.384)
  })

  it('un circuito diminuto sale con una isla de un kilómetro, no de diez metros', () => {
    const c = cajaDeMaqueta([[42.7, -0.5], [42.7001, -0.5001]])!
    expect(c.n - c.s).toBeGreaterThanOrEqual(0.01)
    expect(c.e - c.o).toBeGreaterThanOrEqual(0.01)
  })

  it('sin recorrido, nada', () => {
    expect(cajaDeMaqueta([[42.7, -0.5]])).toBeNull()
  })
})

describe('proyecta', () => {
  it('el meridiano cero y el ecuador caen en el centro del mundo', () => {
    const p = proyecta(0, 0, 3)
    expect(p.x).toBeCloseTo(LADO_MOSAICO * 4)
    expect(p.y).toBeCloseTo(LADO_MOSAICO * 4)
  })

  it('hacia el norte la y baja, hacia el este la x sube', () => {
    const a = proyecta(42, -1, 10)
    const b = proyecta(43, 0, 10)
    expect(b.y).toBeLessThan(a.y)
    expect(b.x).toBeGreaterThan(a.x)
  })
})

describe('rejillaDeMaqueta', () => {
  it('coge el zoom más fino en que la caja cabe en el ancho pedido, sin pasar del 12', () => {
    // Unos 20 km de lado: a zoom 12 son ~700 px en el Pirineo.
    const chica = rejillaDeMaqueta({ s: 42.7, o: -0.6, n: 42.88, e: -0.36 })
    expect(chica.z).toBe(12)
    // Unos 80 km: a 12 no cabe, a 10 sí.
    const grande = rejillaDeMaqueta({ s: 42.4, o: -1.0, n: 43.1, e: 0.0 })
    expect(grande.z).toBeLessThan(12)
    expect(Math.max(grande.anchoPx, grande.altoPx)).toBeLessThanOrEqual(768)
  })

  it('los nodos guardan la proporción de la caja y no pasan del tope', () => {
    const r = rejillaDeMaqueta({ s: 42.4, o: -1.0, n: 43.1, e: 0.0 }, 768, 384)
    expect(Math.max(r.cols, r.filas)).toBe(384)
    expect(r.cols / r.filas).toBeCloseTo(r.anchoPx / r.altoPx, 1)
    expect(r.mpp).toBeGreaterThan(10)
  })
})

/** Una rejilla de mentira: un mosaico entero, dos nodos por lado. */
const rejillaSimple = (cols = 2, filas = 2): Rejilla => ({
  z: 4, x0: 256, y0: 512, anchoPx: 256, altoPx: 256, cols, filas, mpp: 100,
})

describe('mosaicosDeRejilla', () => {
  it('una caja dentro de un mosaico pide solo ese; una que pisa el borde, los dos', () => {
    expect(mosaicosDeRejilla({ ...rejillaSimple(), anchoPx: 100, altoPx: 100 })).toEqual([{ z: 4, x: 1, y: 2 }])
    const dos = mosaicosDeRejilla({ ...rejillaSimple(), x0: 450, anchoPx: 100, altoPx: 100 })
    expect(dos).toEqual([{ z: 4, x: 1, y: 2 }, { z: 4, x: 2, y: 2 }])
  })
})

describe('muestreaAlturas', () => {
  it('interpola entre píxeles y un mosaico que falta es mar', () => {
    // Un mosaico con una rampa: la altura es la columna.
    const rampa = new Float32Array(LADO_MOSAICO * LADO_MOSAICO)
    for (let i = 0; i < rampa.length; i++) rampa[i] = i % LADO_MOSAICO
    const mosaicos = new Map([['4/1/2', rampa]])
    // Nodos en los centros de los píxeles 100, 101 y 102, dentro del mosaico.
    const r: Rejilla = { ...rejillaSimple(3, 2), x0: 256 + 100.5, y0: 512 + 10.5, anchoPx: 2, altoPx: 2 }
    const h = muestreaAlturas(r, mosaicos)
    expect(h[0]).toBeCloseTo(100)
    expect(h[1]).toBeCloseTo(101)
    expect(h[2]).toBeCloseTo(102)
    // Entre dos píxeles, a medias.
    expect(muestreaAlturas({ ...r, x0: 256 + 101 }, mosaicos)[0]).toBeCloseTo(100.5)
    expect(muestreaAlturas(rejillaSimple(), new Map())).toEqual(new Float32Array(4))
  })
})

describe('exageracionMaqueta', () => {
  it('una carrera larga y suave se exagera más que una corta y empinada, entre 1,5 y 3', () => {
    expect(exageracionMaqueta(100_000, 1500)).toBe(3)
    expect(exageracionMaqueta(5_000, 800)).toBe(1.5)
    expect(exageracionMaqueta(30_000, 1800)).toBeCloseTo(2.08, 1)
    expect(exageracionMaqueta(0, 0)).toBe(2)
  })
})

describe('colores', () => {
  it('el mar es del azul de la paleta y por encima de la nieve, blanco', () => {
    const p = paradasRgb({ min: 1000, max: 2000 })
    const agua = colorPorAltura(p, -50)
    expect(agua.map((c) => Math.round(c * 255))).toEqual([0x5b, 0x8a, 0xa6])
    expect(COLOR_AGUA).toBe('#5b8aa6')
    expect(colorPorAltura(p, 9000)).toEqual(p[p.length - 1][1])
  })

  it('entre dos paradas, a medias', () => {
    const p: [number, [number, number, number]][] = [[0, [0, 0, 0]], [100, [1, 1, 1]]]
    expect(colorPorAltura(p, 25)).toEqual([0.25, 0.25, 0.25])
  })

  it('de sRGB a lineal: el blanco y el negro se quedan, el gris medio baja', () => {
    expect(aLineal(1)).toBe(1)
    expect(aLineal(0)).toBe(0)
    expect(aLineal(0.5)).toBeCloseTo(0.214, 2)
  })
})

describe('escala y malla', () => {
  const r = rejillaSimple(3, 3)
  const alturas = new Float32Array([0, 0, 0, 0, 200, 0, 0, 0, 0])
  const escala = escalaDeMaqueta(r, 0, 2, 0.12)

  it('el lado largo mide 2 y está centrado; la altura sube con la exageración', () => {
    expect(escala.x(r.x0)).toBeCloseTo(-1)
    expect(escala.x(r.x0 + r.anchoPx)).toBeCloseTo(1)
    expect(escala.z(r.y0 + r.altoPx / 2)).toBeCloseTo(0)
    // 200 m a 100 m/px son 2 px; 2 px × (2/256) × 2 de exageración.
    expect(escala.y(200)).toBeCloseTo((2 * 2 * 2) / 256)
    expect(escala.base).toBeCloseTo(-0.12)
  })

  it('la malla tiene la capa de arriba, cuatro paredes y una base, todas cerradas', () => {
    const m = mallaDeMaqueta(r, alturas, escala, { min: 0, max: 200 }, [0.8, 0.7, 0.6])
    const vertices = m.posiciones.length / 3
    expect(vertices).toBe(9 + 2 * (3 + 3 + 3 + 3) + 4)
    // Triángulos: 8 arriba, 4 por pared, 2 en la base.
    expect(m.indices.length / 3).toBe(8 + 4 * 4 + 2)
    // El pico está en el centro y las paredes llegan a la base.
    expect(m.posiciones[4 * 3 + 1]).toBeCloseTo(escala.y(200))
    const ys = Array.from({ length: vertices }, (_, k) => m.posiciones[k * 3 + 1])
    expect(Math.min(...ys)).toBeCloseTo(escala.base)
    // Los índices apuntan a vértices que existen.
    expect(Math.max(...m.indices)).toBeLessThan(vertices)
  })

  it('cada triángulo de arriba mira hacia arriba y los de la base hacia abajo', () => {
    const m = mallaDeMaqueta(r, alturas, escala, { min: 0, max: 200 }, [0.8, 0.7, 0.6])
    const normalY = (t: number) => {
      const [a, b, c] = [m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]]
      const p = (k: number, d: number) => m.posiciones[k * 3 + d]
      const bx = p(b, 0) - p(a, 0), by = p(b, 1) - p(a, 1), bz = p(b, 2) - p(a, 2)
      const cx = p(c, 0) - p(a, 0), cy = p(c, 1) - p(a, 1), cz = p(c, 2) - p(a, 2)
      return bz * cx - bx * cz
    }
    for (let t = 0; t < 8; t++) expect(normalY(t)).toBeGreaterThan(0)
    const total = m.indices.length / 3
    expect(normalY(total - 1)).toBeLessThan(0)
    expect(normalY(total - 2)).toBeLessThan(0)
  })

  it('el color del canto es el mismo en toda la pared', () => {
    const m = mallaDeMaqueta(r, alturas, escala, { min: 0, max: 200 }, [0.5, 0.5, 0.5])
    const primeroPared = 9
    expect(m.colores[primeroPared * 3]).toBeCloseTo(aLineal(0.5))
    expect(m.colores[(m.posiciones.length / 3 - 1) * 3]).toBeCloseTo(aLineal(0.5))
  })
})

describe('alturaEn y sitioEnMaqueta', () => {
  const r = rejillaSimple(3, 3)
  const alturas = new Float32Array([0, 0, 0, 0, 200, 0, 0, 0, 0])
  const escala = escalaDeMaqueta(r, 0, 2)

  it('en un nodo da su altura y entre nodos interpola', () => {
    expect(alturaEn(r, alturas, r.x0 + 128, r.y0 + 128)).toBeCloseTo(200)
    expect(alturaEn(r, alturas, r.x0 + 64, r.y0 + 128)).toBeCloseTo(100)
    expect(alturaEn(r, alturas, r.x0, r.y0)).toBeCloseTo(0)
  })

  it('un punto fuera de la loseta no tiene sitio', () => {
    expect(sitioEnMaqueta(r, alturas, escala, 0, 0)).toBeNull()
    // El mosaico 1,2 del zoom 4 cae en el Ártico canadiense.
    const dentro = sitioEnMaqueta(r, alturas, escala, 78, -150)!
    expect(dentro).not.toBeNull()
    expect(Math.abs(dentro[0])).toBeLessThanOrEqual(1)
    expect(Math.abs(dentro[2])).toBeLessThanOrEqual(1)
  })
})

describe('cordonSobreTerreno', () => {
  const r = rejillaSimple(3, 3)
  const alturas = new Float32Array([0, 0, 0, 0, 200, 0, 0, 0, 0])
  const escala = escalaDeMaqueta(r, 0, 2)
  // De la esquina noroeste del mosaico 1,2 (z 4) a la sureste, en lat/lon.
  const nw: [number, number] = [78.0, -150.0]
  const se: [number, number] = [72.0, -140.0]

  it('mete puntos entre los del GPX y todos pisan el suelo', () => {
    const cordon = cordonSobreTerreno(r, alturas, escala, [nw, se], 8)
    expect(cordon.length).toBeGreaterThan(20)
    for (const [x, y, z] of cordon) {
      const px = x / escala.u + r.x0 + r.anchoPx / 2
      const py = z / escala.u + r.y0 + r.altoPx / 2
      expect(y).toBeCloseTo(escala.y(alturaEn(r, alturas, px, py)))
    }
    // Pasa por el pico del centro: ahí sube.
    expect(Math.max(...cordon.map((p) => p[1]))).toBeGreaterThan(escala.y(100))
  })

  it('lo que queda fuera de la loseta no entra', () => {
    expect(cordonSobreTerreno(r, alturas, escala, [[0, 0], [1, 1]], 8)).toEqual([])
  })
})

describe('tablaDeColores', () => {
  it('las puntas de la tabla son las de la paleta, ya en lineal', () => {
    const p = paradasRgb({ min: 1000, max: 2000 })
    const t = tablaDeColores(p, 500, 3000, 64)
    const primero = colorPorAltura(p, 500).map(aLineal)
    const ultimo = colorPorAltura(p, 3000).map(aLineal)
    expect([t[0], t[1], t[2]].map((c) => +c.toFixed(5))).toEqual(primero.map((c) => +c.toFixed(5)))
    expect([t[63 * 3], t[63 * 3 + 1], t[63 * 3 + 2]].map((c) => +c.toFixed(5))).toEqual(ultimo.map((c) => +c.toFixed(5)))
  })
})

describe('cintaSobreTerreno', () => {
  const r = rejillaSimple(3, 3)
  const alturas = new Float32Array([0, 0, 0, 0, 200, 0, 0, 0, 0])
  const escala = escalaDeMaqueta(r, 0, 2)

  it('dos vértices por punto, a la anchura pedida, cada uno pegado a su suelo', () => {
    const puntos: [number, number, number][] = [[-0.5, 0, 0], [0, 0, 0], [0.5, 0, 0]]
    const cinta = cintaSobreTerreno(r, alturas, escala, puntos, 0.1, 0.01)
    expect(cinta.posiciones.length).toBe(3 * 2 * 3)
    expect(cinta.indices.length).toBe(2 * 6)
    // Los dos lados del primer punto, a 0,1 uno del otro, cruzados al rumbo (que va por X).
    expect(cinta.posiciones[2]).toBeCloseTo(0.05)
    expect(cinta.posiciones[5]).toBeCloseTo(-0.05)
    // En el centro pasa por el pico: los dos lados suben, y llevan el alza.
    const alturaCentro = escala.y(alturaEn(r, alturas, escala.px(0), escala.py(0.05))) + 0.01
    expect(cinta.posiciones[2 * 2 * 3 + 1 - 3]).toBeCloseTo(alturaCentro)
    expect(Math.max(...cinta.indices)).toBe(5)
  })

  it('la vuelta de píxeles a unidades es la inversa', () => {
    expect(escala.px(escala.x(300))).toBeCloseTo(300)
    expect(escala.py(escala.z(600))).toBeCloseTo(600)
  })
})

describe('máscara en la malla', () => {
  const r = rejillaSimple(3, 3)
  const alturas = new Float32Array([500, 500, 500, 500, 500, 500, 500, 500, 500])
  const escala = escalaDeMaqueta(r, 500, 2)

  it('el agua va del azul del mar y el bosque, más oscuro que el suelo', () => {
    const mascara = new Uint8Array([0, MASCARA_AGUA, MASCARA_BOSQUE, 0, MASCARA_RIO, 0, 0, 0, 0])
    const m = mallaDeMaqueta(r, alturas, escala, { min: 400, max: 600 }, [0.8, 0.7, 0.6], mascara)
    const color = (n: number) => [m.colores[n * 3], m.colores[n * 3 + 1], m.colores[n * 3 + 2]]
    const agua = [0x5b, 0x8a, 0xa6].map((c) => aLineal(c / 255))
    expect(color(1).map((c) => +c.toFixed(4))).toEqual(agua.map((c) => +c.toFixed(4)))
    expect(color(4)).toEqual(color(1))
    const suelo = color(0)
    const bosque = color(2)
    expect(bosque[0] + bosque[1] + bosque[2]).toBeLessThan(suelo[0] + suelo[1] + suelo[2])
    expect(bosque).not.toEqual(suelo)
  })
})

describe('reduceRejilla', () => {
  it('con menos nodos guarda la caja, interpola alturas y copia la máscara', () => {
    const r: Rejilla = { ...rejillaSimple(5, 5) }
    const alturas = new Float32Array(25).map((_, n) => (n % 5) * 100)
    const mascara = new Uint8Array(25).map((_, n) => (n % 5 === 4 ? MASCARA_BOSQUE : 0))
    const red = reduceRejilla(r, alturas, mascara, 3)
    expect(red.rejilla.cols).toBe(3)
    expect(red.rejilla.filas).toBe(3)
    expect(red.rejilla.anchoPx).toBe(r.anchoPx)
    expect(Array.from(red.alturas.slice(0, 3))).toEqual([0, 200, 400])
    expect(Array.from(red.mascara.slice(0, 3))).toEqual([0, 0, MASCARA_BOSQUE])
    expect(reduceRejilla(r, alturas, mascara, 5).rejilla).toBe(r)
  })
})

describe('sitiosDeArboles', () => {
  const r = rejillaSimple(8, 8)
  const alturas = new Float32Array(64).fill(1000)
  const escala = escalaDeMaqueta(r, 1000, 2)

  it('solo en el bosque, como mucho uno por celda, y siempre los mismos', () => {
    const mascara = new Uint8Array(64)
    for (let n = 0; n < 32; n++) mascara[n] = MASCARA_BOSQUE
    const a = sitiosDeArboles(r, alturas, mascara, escala, 2, 100, 1)
    expect(a.length % 4).toBe(0)
    // 4 filas de bosque en celdas de 2 → 2 filas de celdas × 4 = 8 como mucho.
    expect(a.length / 4).toBeLessThanOrEqual(8)
    expect(a.length / 4).toBeGreaterThan(0)
    for (let k = 0; k < a.length; k += 4) {
      expect(a[k + 2]).toBeLessThan(0) // las filas de arriba son el norte: Z negativa
      expect(a[k + 1]).toBeCloseTo(escala.y(1000))
      expect(a[k + 3]).toBeGreaterThanOrEqual(0.7)
      expect(a[k + 3]).toBeLessThanOrEqual(1.3)
    }
    expect(sitiosDeArboles(r, alturas, mascara, escala, 2, 100, 1)).toEqual(a)
  })

  it('sin bosque no hay árboles, y el tope manda', () => {
    expect(sitiosDeArboles(r, alturas, new Uint8Array(64), escala, 2, 100).length).toBe(0)
    const todo = new Uint8Array(64).fill(MASCARA_BOSQUE)
    expect(sitiosDeArboles(r, alturas, todo, escala, 1, 5, 1).length).toBe(20)
  })
})

describe('casasDeLugar', () => {
  const r = rejillaSimple(9, 9)
  const alturas = new Float32Array(81).fill(700)
  const escala = escalaDeMaqueta(r, 700, 2)

  it('las casas caen alrededor del punto, en el suelo, y siempre en el mismo sitio', () => {
    const lugar = { n: 'Villanúa', c: 'village' as const, u: 0.5, v: 0.5 }
    const casas = casasDeLugar(r, alturas, new Uint8Array(81), escala, lugar, 5, 0.1)
    expect(casas.length).toBe(5 * 5)
    const [cx, , cz] = sitioDeFraccion(r, alturas, escala, 0.5, 0.5)
    for (let k = 0; k < casas.length; k += 5) {
      expect(Math.hypot(casas[k] - cx, casas[k + 2] - cz)).toBeLessThanOrEqual(0.1 + 1e-9)
      expect(casas[k + 1]).toBeCloseTo(escala.y(700))
      expect(casas[k + 4]).toBeGreaterThanOrEqual(0.8)
    }
    expect(casasDeLugar(r, alturas, new Uint8Array(81), escala, lugar, 5, 0.1)).toEqual(casas)
  })

  it('en el agua no se construye', () => {
    const agua = new Uint8Array(81).fill(MASCARA_AGUA)
    expect(casasDeLugar(r, alturas, agua, escala, { n: 'X', c: 'town', u: 0.5, v: 0.5 }, 5, 0.1).length).toBe(0)
  })
})

describe('aligera', () => {
  it('deja como mucho n puntos, con el primero y el último', () => {
    const pts = Array.from({ length: 100 }, (_, i) => i)
    const a = aligera(pts, 5)
    expect(a).toEqual([0, 25, 50, 74, 99])
    expect(aligera(pts, 200)).toBe(pts)
  })
})
