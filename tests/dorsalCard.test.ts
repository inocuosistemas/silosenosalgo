import { describe, it, expect, beforeEach } from 'vitest'
import { dibujaDorsal, type DatosDorsal } from '../src/lib/dorsalCard'

/**
 * Que el dorsal que se manda al grupo no se salga del papel.
 *
 * Una tarjeta dibujada a mano tiene un fallo propio que no da error ni se ve
 * al escribirla: un texto colocado con la alineación equivocada, o un nombre
 * más largo de lo previsto, se pinta FUERA del lienzo y desaparece. Ya pasó en
 * la porra —el título "¿Acaba?" heredó una alineación a la derecha y se salió
 * por la izquierda—, y aquella se descubrió mirando una captura.
 *
 * Aquí el lienzo se sustituye por uno de mentira que apunta todo lo que se le
 * pide, y luego se comprueba que cada trazo cae dentro. No dice si es bonito;
 * dice que está entero, que es lo que no se puede ver leyendo el código.
 */

interface Trazo { texto: string; x: number; y: number; align: string; ancho: number }

const trazos: Trazo[] = []
const puntos: { x: number; y: number }[] = []
let ancho = 0, alto = 0

/** Ancho aproximado: lo que mide una tipografía de palo a ojo de calculadora. */
function anchoDe(texto: string, fuente: string): number {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(fuente)?.[1] ?? 16)
  return texto.length * px * 0.6
}

function lienzoDeMentira() {
  const ctx = {
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    scale() {},
    save() {}, restore() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo(x: number, y: number) { puntos.push({ x, y }) },
    lineTo(x: number, y: number) { puntos.push({ x, y }) },
    arc(x: number, y: number, r: number) { puntos.push({ x: x - r, y: y - r }, { x: x + r, y: y + r }) },
    fillRect(x: number, y: number, an: number, al: number) { puntos.push({ x, y }, { x: x + an, y: y + al }) },
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText(t: string) { return { width: anchoDe(t, ctx.font) } },
    fillText(t: string, x: number, y: number) {
      trazos.push({ texto: t, x, y, align: ctx.textAlign, ancho: anchoDe(t, ctx.font) })
    },
  }
  return {
    set width(v: number) { ancho = v },
    set height(v: number) { alto = v },
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,xx',
  }
}

const CARRERA: DatosDorsal = {
  bib: '79',
  nombre: 'JM',
  emoji: '🦍',
  color: 'rose',
  carrera: 'CanFranc CanFranc',
  km: 99,
  desnivelM: 5900,
  salida: Date.UTC(2025, 8, 6, 3, 0),
  cierre: Date.UTC(2025, 8, 7, 18, 0),
  perfil: [...Array(140)].map((_, i) => ({ km: (i * 99) / 139, ele: 1200 + Math.sin(i / 7) * 900 })),
  puntos: [
    { nombre: 'Canfranc Pueblo', km: 3, cierre: '06:30' },
    { nombre: 'Base de Vida de Formigal', km: 49, cierre: '21:30' },
    { nombre: 'Candanchú', km: 90, cierre: '10:00' },
    { nombre: 'Meta', km: 99, cierre: '20:00' },
  ],
  porra: '38h 00m',
}

/** Los límites de cada trazo de texto según con qué alineación se pintó. */
function bordes(t: Trazo): [number, number] {
  if (t.align === 'center') return [t.x - t.ancho / 2, t.x + t.ancho / 2]
  if (t.align === 'right') return [t.x - t.ancho, t.x]
  return [t.x, t.x + t.ancho]
}

function dibuja(d: Partial<DatosDorsal> = {}) {
  trazos.length = 0
  puntos.length = 0
  // @ts-expect-error: el lienzo de mentira solo trae lo que el dibujo usa.
  globalThis.document = { createElement: () => lienzoDeMentira() }
  return dibujaDorsal({ ...CARRERA, ...d })
}

describe('el dorsal que se comparte', () => {
  beforeEach(() => { ancho = 0; alto = 0 })

  it('sale como PNG y a 1080 de ancho, que es lo que traga un chat', () => {
    expect(dibuja()).toMatch(/^data:image\/png/)
    expect(ancho).toBe(1080)
    expect(alto).toBeGreaterThan(1080)          // más alto que ancho: es un dorsal
  })

  it('no se sale del papel ni un texto', () => {
    dibuja()
    const AN = ancho / 2, AL = alto / 2
    for (const t of trazos) {
      const [izq, der] = bordes(t)
      expect.soft(izq, `"${t.texto}" se sale por la izquierda`).toBeGreaterThanOrEqual(-1)
      expect.soft(der, `"${t.texto}" se sale por la derecha`).toBeLessThanOrEqual(AN + 1)
      expect.soft(t.y, `"${t.texto}" se sale por abajo`).toBeLessThanOrEqual(AL)
      expect.soft(t.y, `"${t.texto}" se sale por arriba`).toBeGreaterThan(0)
    }
  })

  it('tampoco el perfil ni los aros', () => {
    dibuja()
    const AN = ancho / 2, AL = alto / 2
    for (const p of puntos) {
      expect.soft(p.x).toBeGreaterThanOrEqual(-1)
      expect.soft(p.x).toBeLessThanOrEqual(AN + 1)
      expect.soft(p.y).toBeGreaterThanOrEqual(-1)
      expect.soft(p.y).toBeLessThanOrEqual(AL + 1)
    }
  })

  it('aguanta un dorsal largo y un nombre largo: se estrechan, no se salen', () => {
    dibuja({ bib: 'A-1284/B', nombre: 'María de las Mercedes Etxebarría' })
    const AN = ancho / 2
    for (const t of trazos) {
      const [izq, der] = bordes(t)
      expect.soft(izq, `"${t.texto}" se sale por la izquierda`).toBeGreaterThanOrEqual(-1)
      expect.soft(der, `"${t.texto}" se sale por la derecha`).toBeLessThanOrEqual(AN + 1)
    }
  })

  it('sin recorrido publicado se queda más corto, no deja un hueco en blanco', () => {
    dibuja()
    const conPerfil = alto
    dibuja({ perfil: [], puntos: [] })
    expect(alto).toBeLessThan(conPerfil)
    // Y lo que no puede faltar nunca: el número.
    expect(trazos.some((t) => t.texto === '79')).toBe(true)
  })

  it('escribe lo que lleva un dorsal: prueba, corredor, cortes y la porra', () => {
    dibuja()
    const todo = trazos.map((t) => t.texto).join(' | ')
    expect(todo).toContain('CANFRANC CANFRANC')
    expect(todo).toContain('JM')
    expect(todo).toContain('99 km')                   // no "99.0 km": es un dorsal
    expect(todo).toContain(`${(5900).toLocaleString('es-ES')} m D+`)
    expect(todo).toContain('cierre 21:30')            // el corte de media carrera
    expect(todo).toContain('LA PORRA: 38h 00m')
    expect(todo).toContain('EMERGENCIAS 112')
  })
})
