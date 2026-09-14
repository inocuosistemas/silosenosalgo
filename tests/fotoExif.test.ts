import { describe, it, expect } from 'vitest'
import { leeExif, aMilisegundos } from '../src/lib/fotoExif'

/**
 * Un JPEG mínimo con su EXIF: SOI, APP1 con un TIFF que lleva GPS y la hora
 * original, y el comienzo de la imagen. Se arma a mano para no depender de
 * ficheros binarios en el repositorio.
 */
function jpegConExif(o: {
  lat: [number, number, number]; latRef: 'N' | 'S'
  lon: [number, number, number]; lonRef: 'E' | 'W'
  fecha?: string; desfase?: string; littleEndian?: boolean
}): ArrayBuffer {
  const le = o.littleEndian ?? false
  const tiff = new DataView(new ArrayBuffer(512))
  const u16 = (p: number, x: number) => tiff.setUint16(p, x, le)
  const u32 = (p: number, x: number) => tiff.setUint32(p, x, le)
  const ascii = (p: number, s: string) => { for (let i = 0; i < s.length; i++) tiff.setUint8(p + i, s.charCodeAt(i)) }

  tiff.setUint8(0, le ? 0x49 : 0x4d); tiff.setUint8(1, le ? 0x49 : 0x4d)
  u16(2, 42); u32(4, 8)
  // IFD0 en 8: dos entradas, puntero al GPS y al EXIF.
  u16(8, 2)
  u16(10, 0x8825); u16(12, 4); u32(14, 1); u32(18, 38)
  u16(22, 0x8769); u16(24, 4); u32(26, 1); u32(30, 200)
  u32(34, 0)
  // IFD del GPS en 38: cuatro entradas.
  u16(38, 4)
  const entrada = (p: number, tag: number, tipo: number, n: number, valor: number) => { u16(p, tag); u16(p + 2, tipo); u32(p + 4, n); u32(p + 8, valor) }
  entrada(40, 0x0001, 2, 2, 0); ascii(48, o.latRef + '\0')
  entrada(52, 0x0002, 5, 3, 100)
  entrada(64, 0x0003, 2, 2, 0); ascii(72, o.lonRef + '\0')
  entrada(76, 0x0004, 5, 3, 124)
  const racional = (p: number, trio: [number, number, number]) => {
    trio.forEach((x, i) => { u32(p + i * 8, Math.round(x * 100)); u32(p + i * 8 + 4, 100) })
  }
  racional(100, o.lat)
  racional(124, o.lon)
  // IFD del EXIF en 200.
  const conDesfase = !!o.desfase
  u16(200, conDesfase ? 2 : 1)
  entrada(202, 0x9003, 2, 20, 240)
  if (conDesfase) entrada(214, 0x9011, 2, 7, 262)
  ascii(240, (o.fecha ?? '2026:09:12 10:15:03') + '\0')
  if (conDesfase) ascii(262, o.desfase + '\0')

  const tiffBytes = new Uint8Array(tiff.buffer, 0, 300)
  const app1 = new Uint8Array(2 + 2 + 6 + tiffBytes.length)
  app1.set([0xff, 0xe1, (app1.length - 2) >> 8, (app1.length - 2) & 0xff])
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4)
  app1.set(tiffBytes, 10)
  const todo = new Uint8Array(2 + app1.length + 4)
  todo.set([0xff, 0xd8])
  todo.set(app1, 2)
  todo.set([0xff, 0xda, 0x00, 0x02], 2 + app1.length)
  return todo.buffer
}

describe('leeExif', () => {
  it('lee la posición: Formigal, en grados, minutos y segundos', () => {
    const d = leeExif(jpegConExif({ lat: [42, 46, 30], latRef: 'N', lon: [0, 21, 36], lonRef: 'W', desfase: '+02:00' }))
    expect(d.lat).toBeCloseTo(42.775, 4)
    expect(d.lon).toBeCloseTo(-0.36, 4)
  })

  it('lee la hora con su desfase, exacta', () => {
    const d = leeExif(jpegConExif({ lat: [42, 46, 30], latRef: 'N', lon: [0, 21, 36], lonRef: 'W', desfase: '+02:00' }))
    expect(d.tomadaEn).toBe(Date.UTC(2026, 8, 12, 8, 15, 3))
  })

  it('igual con el orden de bytes de Intel', () => {
    const d = leeExif(jpegConExif({ lat: [42, 46, 30], latRef: 'N', lon: [0, 21, 36], lonRef: 'W', littleEndian: true }))
    expect(d.lat).toBeCloseTo(42.775, 4)
    expect(d.lon).toBeCloseTo(-0.36, 4)
  })

  it('sur y oeste salen en negativo', () => {
    const d = leeExif(jpegConExif({ lat: [33, 30, 0], latRef: 'S', lon: [70, 40, 0], lonRef: 'W' }))
    expect(d.lat).toBeCloseTo(-33.5, 4)
    expect(d.lon).toBeCloseTo(-70.6667, 3)
  })

  it('sin EXIF, o si no es un JPEG, todo a null y sin romperse', () => {
    expect(leeExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toEqual({ lat: null, lon: null, tomadaEn: null })
    expect(leeExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ lat: null, lon: null, tomadaEn: null })
    expect(leeExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]).buffer)).toEqual({ lat: null, lon: null, tomadaEn: null })
  })
})

describe('aMilisegundos', () => {
  it('sin desfase, hora local', () => {
    expect(aMilisegundos('2026:09:12 10:15:03', null)).toBe(new Date(2026, 8, 12, 10, 15, 3).getTime())
  })
  it('una fecha que no lo es, null', () => {
    expect(aMilisegundos('ayer por la tarde', null)).toBeNull()
  })
})
