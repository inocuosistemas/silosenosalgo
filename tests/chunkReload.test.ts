import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * La recuperación del "trozo que ya no existe".
 *
 * Al desplegar cambian los nombres de los ficheros de código, así que una
 * pestaña abierta desde antes pide uno que ya no está y se rompe. La cura es
 * recargar, y todo el cuidado está en no recargar en bucle: eso deja a alguien
 * mirando una pantalla que parpadea sin decirle nunca qué pasa.
 *
 * Se prueba aquí porque es un camino de ERROR: no se ve nunca hasta el día que
 * se ve, y ese día es justo el peor —acabas de desplegar y hay gente mirando el
 * mapa de una carrera—.
 */

let recargas = 0

beforeEach(async () => {
  vi.useFakeTimers()
  recargas = 0
  const almacen = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => { almacen.set(k, v) },
    removeItem: (k: string) => { almacen.delete(k) },
  })
  vi.stubGlobal('window', {
    location: { reload: () => { recargas++ } },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  })
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const carga = async () => (await import('../src/lib/chunkReload')).reloadForChunkError

describe('recuperarse de un despliegue con la pestaña abierta', () => {
  it('la primera vez recarga en el momento', async () => {
    const recarga = await carga()
    expect(recarga()).toBe(true)
    expect(recargas).toBe(1)
  })

  it('la segunda ESPERA antes de recargar', async () => {
    // Es lo único que la hace útil: justo después de desplegar, el borde sigue
    // sirviendo el documento viejo un par de segundos, así que recargar otra vez
    // al instante se trae exactamente lo mismo.
    const recarga = await carga()
    recarga()
    expect(recarga()).toBe(true)
    expect(recargas).toBe(1)              // todavía no
    vi.advanceTimersByTime(2_000)
    expect(recargas).toBe(2)              // ahora sí
  })

  it('a la tercera se rinde y deja ver el error', async () => {
    const recarga = await carga()
    recarga()
    recarga()
    vi.advanceTimersByTime(2_000)
    expect(recarga()).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(recargas).toBe(2)              // ni una más
  })

  it('un fallo mucho después es otro episodio y vuelve a contar de cero', async () => {
    const recarga = await carga()
    recarga()
    recarga()
    vi.advanceTimersByTime(2_000)
    expect(recarga()).toBe(false)
    // Media hora más tarde, otro despliegue: esto no es el mismo problema.
    vi.advanceTimersByTime(31_000)
    expect(recarga()).toBe(true)
  })

  it('sin dónde apuntar (modo privado) recarga igual, sin contar', async () => {
    // Sin `sessionStorage` no se puede llevar la cuenta de una recarga a la
    // siguiente. Se recarga porque es lo que arregla el caso normal; la
    // protección contra el bucle sencillamente no existe ahí, y más vale
    // saberlo que creerse protegido.
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
    })
    vi.resetModules()
    const recarga = await carga()
    expect(recarga()).toBe(true)
    expect(recargas).toBe(1)
  })
})
