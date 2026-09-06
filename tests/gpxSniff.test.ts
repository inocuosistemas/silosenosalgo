import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Reconocer un GPX por su cabecera, no por su nombre.
 *
 * La regla que aplica el cargador: se busca la etiqueta raíz `<gpx` en el
 * primer trozo del archivo. Se prueba aquí, y no a través del componente,
 * porque lo que puede romperse es la expresión: el componente solo la usa.
 */
const esGpx = (texto: string) => /<gpx[\s>]/i.test(texto.slice(0, 4096))

describe('reconocer un GPX', () => {
  it('acepta el recorrido oficial de la CanFranc, que viene en .GPX de Garmin', () => {
    // El archivo de verdad: 3 KB de espacios de nombres antes de la primera
    // coordenada, que es justo lo que obliga a mirar más allá de los primeros
    // cien caracteres.
    const real = readFileSync(new URL('./fixtures/canfranc-cabecera.xml', import.meta.url), 'utf8')
    expect(esGpx(real)).toBe(true)
  })

  it('da igual cómo se escriba la etiqueta', () => {
    expect(esGpx('<?xml version="1.0"?>\n<GPX xmlns="...">')).toBe(true)
    expect(esGpx('<gpx creator="Suunto">')).toBe(true)
  })

  it('no se traga otro XML cualquiera', () => {
    expect(esGpx('<?xml version="1.0"?>\n<kml><Document/></kml>')).toBe(false)
    expect(esGpx('<html><body>hola</body></html>')).toBe(false)
  })

  it('ni una palabra suelta que empiece por gpx', () => {
    // Un texto que hable DE gpx no es un gpx: hace falta la etiqueta.
    expect(esGpx('Adjunto el gpx de la ruta, dime si te vale.')).toBe(false)
    expect(esGpx('<gpxdata:distance>10</gpxdata:distance>')).toBe(false)
  })

  it('ni un archivo binario renombrado a .gpx', () => {
    expect(esGpx('���� JFIF')).toBe(false)
  })
})
