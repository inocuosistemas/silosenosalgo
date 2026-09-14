import { describe, it, expect } from 'vitest'
import { encuadre3D, htmlCorredor3D, htmlPunto3D, type Corredor3D } from '../src/lib/mapa3d'

const corredor = (extra: Partial<Corredor3D> = {}): Corredor3D => ({
  key: 'k', punto: [42.7, -0.5], color: '#22c55e', emoji: '🦊', nombre: 'jie', apagado: false, detalle: 'km 12.0', ...extra,
})

describe('encuadre3D', () => {
  it('manda el recorrido, en [lon, lat] de suroeste a noreste', () => {
    expect(encuadre3D([[42.8, -0.6], [42.7, -0.4]], [[40, 3]])).toEqual({ limites: [[-0.6, 42.7], [-0.4, 42.8]] })
  })

  it('sin recorrido, por las posiciones; con una sola, centrado en ella', () => {
    expect(encuadre3D(null, [[42.75, -0.52]])).toEqual({ centro: [-0.52, 42.75], zoom: 14 })
    expect(encuadre3D([], [[42.7, -0.6], [42.8, -0.4]])).toEqual({ limites: [[-0.6, 42.7], [-0.4, 42.8]] })
  })
})

describe('htmlCorredor3D', () => {
  it('el nombre y el detalle no se cuelan como HTML', () => {
    const html = htmlCorredor3D(corredor({ nombre: '<img src=x onerror=alert(1)>', detalle: '"a" & b' }), true, true)
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img')
    expect(html).toContain('&#34;a&#34; &#38; b')
  })

  it('el rótulo, solo del elegido; el emoji, solo si caben', () => {
    expect(htmlCorredor3D(corredor(), true, false)).not.toContain('jie')
    expect(htmlCorredor3D(corredor(), true, true)).toContain('jie · km 12.0')
    expect(htmlCorredor3D(corredor(), false, false)).not.toContain('🦊')
    expect(htmlCorredor3D(corredor(), true, false)).toContain('🦊')
  })

  it('un color que no es un color no entra en el estilo', () => {
    expect(htmlCorredor3D(corredor({ color: 'red;background:url(x)' }), false, false)).not.toContain('url(x)')
  })

  it('sin señal, a media tinta', () => {
    expect(htmlCorredor3D(corredor({ apagado: true }), true, false)).toContain('opacity:0.5')
  })
})

describe('htmlPunto3D', () => {
  it('con cierre lo dice, y el nombre va escapado', () => {
    expect(htmlPunto3D({ lat: 0, lon: 0, nombre: 'CF<0230>', cierre: '02:30' })).toContain('CF&#60;0230&#62; · cierra 02:30')
    expect(htmlPunto3D({ lat: 0, lon: 0, nombre: 'Meta', cierre: null })).not.toContain('cierra')
  })
})
