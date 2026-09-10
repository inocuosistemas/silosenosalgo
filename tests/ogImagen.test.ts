import { describe, it, expect } from 'vitest'
import { imagenDeEvento, versionTarjeta, type EventoParaImagen } from '../functions/lib/ogImagen'

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
    const img = imagenDeEvento(ORIGEN, evento(), true)
    expect(img.url).toContain('/og/evento-ev123456789012345678ab.png')
    expect(img.width).toBe(1200)
    expect(img.height).toBe(630)
  })

  it('sin tarjeta todavía, el cartel, declarado 3:1 y no 1200×630', () => {
    // Declararlo 1200×630 es lo que hacía que el previsualizador lo recortara
    // a un cuadrado y enseñara media palabra del cartel.
    const img = imagenDeEvento(ORIGEN, evento(), false)
    expect(img.url).toContain('/api/events/ev123456789012345678ab/photo?v=1757000000000')
    expect(img.width / img.height).toBe(3)
  })

  it('sin cartel ni tarjeta, la de la marca, que sí es 1200×630', () => {
    const img = imagenDeEvento(ORIGEN, evento({ photoKey: null, photoAt: null }), false)
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
