import { describe, it, expect } from 'vitest'
import { MASCARA_AGUA, MASCARA_BOSQUE, codificaPaquete, decodificaPaquete, validaPaquete } from '../shared/maquetaPaquete'

const rejilla = { z: 11, x0: 1000.5, y0: 2000.25, anchoPx: 300, altoPx: 200, cols: 3, filas: 2, mpp: 57.3 }
const alturas = new Float32Array([120.5, 300, 2450.25, 0, 800, 1999])
const mascara = new Uint8Array([0, MASCARA_AGUA, MASCARA_BOSQUE, 0, MASCARA_AGUA | MASCARA_BOSQUE, 0])
const cab = { rejilla, cotas: { min: 100, max: 2500 }, faltan: 0, conMapa: true }

describe('paquete de maqueta', () => {
  it('lo que se codifica se decodifica, con las alturas a menos de 5 cm', () => {
    const bytes = codificaPaquete(cab, alturas, mascara)
    const p = decodificaPaquete(bytes)!
    expect(p).not.toBeNull()
    expect(p.cabecera.v).toBe(1)
    expect(p.cabecera.rejilla).toEqual(rejilla)
    expect(p.cabecera.cotas).toEqual({ min: 100, max: 2500 })
    expect(p.cabecera.alturaMin).toBe(0)
    expect(p.cabecera.alturaMax).toBe(2450.25)
    for (let i = 0; i < alturas.length; i++) expect(Math.abs(p.alturas[i] - alturas[i])).toBeLessThan(0.05)
    expect(Array.from(p.mascara)).toEqual(Array.from(mascara))
  })

  it('pesa lo que tiene que pesar: 3 bytes por nodo más la cabecera', () => {
    const bytes = codificaPaquete(cab, alturas, mascara)
    const largoCabecera = new DataView(bytes.buffer).getUint32(4, true)
    expect(bytes.length).toBe(8 + largoCabecera + 6 * 3)
  })

  it('una loseta llana no divide por cero', () => {
    const p = decodificaPaquete(codificaPaquete(cab, new Float32Array([5, 5, 5, 5, 5, 5]), mascara))!
    expect(Array.from(p.alturas)).toEqual([5, 5, 5, 5, 5, 5])
  })

  it('rechaza lo que no es un paquete', () => {
    const bueno = codificaPaquete(cab, alturas, mascara)
    expect(validaPaquete(new Uint8Array(0))).toBeNull()
    expect(validaPaquete(new TextEncoder().encode('hola que tal'))).toBeNull()
    // Un byte de más o de menos no cuadra con la rejilla.
    expect(validaPaquete(bueno.subarray(0, bueno.length - 1))).toBeNull()
    expect(validaPaquete(new Uint8Array([...bueno, 0]))).toBeNull()
    // Una cabecera con una rejilla disparatada tampoco.
    const raro = codificaPaquete({ ...cab, rejilla: { ...rejilla, z: 40 } }, alturas, mascara)
    expect(validaPaquete(raro)).toBeNull()
    const negativo = codificaPaquete({ ...cab, rejilla: { ...rejilla, mpp: -1 } }, alturas, mascara)
    expect(validaPaquete(negativo)).toBeNull()
  })

  it('no acepta alturas y máscara de distinto tamaño que la rejilla', () => {
    expect(() => codificaPaquete(cab, new Float32Array(5), mascara)).toThrow()
  })
})
