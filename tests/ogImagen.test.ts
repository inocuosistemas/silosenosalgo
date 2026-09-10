import { describe, it, expect } from 'vitest'
import {
  imagenDeEvento, versionTarjeta, claveTarjeta, type EventoParaImagen,
} from '../functions/lib/ogImagen'

/**
 * La pastilla que arma WhatsApp al pegar el enlace de una carrera.
 *
 * Quien recibe el enlace en el grupo decide si toca por lo que ve ahí, y lo que
 * veía era el cartel recortado a un cuadrado diminuto: 3:1 anunciado como
 * 1200×630. El tamaño declarado tiene que ser el de la imagen que de verdad se
 * sirve, porque es con lo que el previsualizador decide si pinta la grande.
 */

const ORIGEN = 'https://silosenosalgo.themakercrowd.com'

const evento = (extra: Partial<EventoParaImagen> = {}): EventoParaImagen => ({
  id: 'ev123456789012345678ab',
  photoKey: 'eventphoto:ev123456789012345678ab',
  photoAt: 1_757_000_000_000,
  startsAt: 1_757_700_000_000,
  members: 12,
  ...extra,
})

describe('la imagen que anuncia un evento', () => {
  it('con tarjeta dibujada, esa, y en 1200×630', () => {
    const img = imagenDeEvento(ORIGEN, evento(), 'propia')
    expect(img.url).toContain('/og/evento-ev123456789012345678ab.png')
    expect(img.width).toBe(1200)
    expect(img.height).toBe(630)
  })

  it('cada enlace pide SU tarjeta, que es la que lleva su sello', () => {
    // Los tres se pegan en el mismo grupo: con una sola imagen parecían el
    // mismo enlace repetido hasta que alguien leía el texto.
    const urls = (['parrilla', 'publico', 'invitacion'] as const)
      .map((t) => imagenDeEvento(ORIGEN, evento(), 'propia', t).url)
    expect(new Set(urls).size).toBe(3)
    // La parrilla se queda sin sufijo: es la clave que ya existía y no puede
    // cambiar sin dejar huérfanas las tarjetas ya subidas.
    expect(claveTarjeta('abc', 'parrilla')).toBe('evento-abc')
    expect(claveTarjeta('abc', 'publico')).toBe('evento-abc-p')
  })

  it('sin la suya todavía, la genérica de la parrilla antes que el cartel', () => {
    // Un evento que nadie ha vuelto a abrir desde que se dibujan las tres solo
    // tiene la de la parrilla: el sello no cuadra, pero se sigue viendo la
    // carrera en grande, que es mejor que caer al cartel recortado.
    const img = imagenDeEvento(ORIGEN, evento(), 'generica', 'publico')
    expect(img.url).toContain('/og/evento-ev123456789012345678ab.png')
    expect(img.width).toBe(1200)
  })

  it('sin tarjeta ninguna, el cartel, declarado 3:1 y no 1200×630', () => {
    // Declararlo 1200×630 es lo que hacía que el previsualizador lo recortara
    // a un cuadrado y enseñara media palabra del cartel.
    const img = imagenDeEvento(ORIGEN, evento(), null)
    expect(img.url).toContain('/api/events/ev123456789012345678ab/photo?v=1757000000000')
    expect(img.width / img.height).toBe(3)
  })

  it('sin cartel ni tarjeta, la de la marca, que sí es 1200×630', () => {
    const img = imagenDeEvento(ORIGEN, evento({ photoKey: null, photoAt: null }), null)
    expect(img.url).toBe(`${ORIGEN}/og-live.png`)
    expect(img.width).toBe(1200)
    expect(img.height).toBe(630)
  })

  it('la url de la tarjeta cambia cuando cambia lo que se ve en ella', () => {
    // Se sirve con caché de un año: sin versión, la primera tarjeta subida
    // sería la que vería el grupo para siempre, aunque entre gente o se ponga
    // el cartel después.
    const base = evento()
    expect(versionTarjeta(base)).not.toBe(versionTarjeta({ ...base, members: 13 }))
    expect(versionTarjeta(base)).not.toBe(versionTarjeta({ ...base, photoAt: 1 }))
    expect(versionTarjeta(base)).not.toBe(versionTarjeta({ ...base, startsAt: 1 }))
    expect(versionTarjeta(base)).toBe(versionTarjeta({ ...base }))
  })

  it('un evento sin foto ni hora tiene versión igualmente', () => {
    expect(versionTarjeta(evento({ photoAt: null, startsAt: null, members: 0 }))).toBe('0-0-0')
  })
})
