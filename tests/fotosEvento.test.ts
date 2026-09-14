import { describe, it, expect } from 'vitest'
import { juntaFotos, paraEnviar, type FotoSinUrl } from '../functions/lib/fotosEvento'

const foto = (id: string, at: number, origen: 'nota' | 'subida' = 'nota'): FotoSinUrl => ({
  id, origen, autorId: 'u1', username: 'JM', at, lat: 42.7, lon: -0.5, km: null, posicion: 'foto', texto: null,
})

describe('juntaFotos', () => {
  it('las vivas, por hora', () => {
    expect(juntaFotos([foto('n_b', 20), foto('s_a', 10, 'subida')], []).map((f) => f.id)).toEqual(['s_a', 'n_b'])
  })

  it('una nota que ya no está en la baliza sale del archivo', () => {
    const r = juntaFotos([foto('n_viva', 30)], [foto('n_viva', 30), foto('n_borrada', 5)])
    expect(r.map((f) => f.id)).toEqual(['n_borrada', 'n_viva'])
  })

  it('si está viva y archivada, manda la viva (puede traer el texto corregido)', () => {
    const viva = { ...foto('n_x', 10), texto: 'Formigal' }
    const archivada = { ...foto('n_x', 10), texto: null }
    expect(juntaFotos([viva], [archivada])).toEqual([viva])
  })
})

describe('paraEnviar', () => {
  it('no manda el id interno del autor, y solo marca borrable cuando lo es', () => {
    const f = paraEnviar(foto('s_a', 10, 'subida'), '/api/events/x/fotos/s_a', false)
    expect(f).not.toHaveProperty('autorId')
    expect(f).not.toHaveProperty('borrable')
    expect(paraEnviar(foto('s_a', 10, 'subida'), '/u', true).borrable).toBe(true)
  })
})
