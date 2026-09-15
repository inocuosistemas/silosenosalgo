import { describe, expect, it } from 'vitest'
import { destinoSeguro } from '../functions/api/auth/entra'

describe('destinoSeguro', () => {
  it('deja pasar las direcciones de esta misma web', () => {
    expect(destinoSeguro('/?e=abc&v=porra')).toBe('/?e=abc&v=porra')
    expect(destinoSeguro('/')).toBe('/')
  })
  it('manda a la portada lo que saldría de la web', () => {
    expect(destinoSeguro('https://otro.com/')).toBe('/')
    expect(destinoSeguro('//otro.com/x')).toBe('/')
    expect(destinoSeguro('/\\otro.com')).toBe('/')
    expect(destinoSeguro(null)).toBe('/')
    expect(destinoSeguro('')).toBe('/')
  })
})
