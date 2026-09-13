import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PorraPulso } from '../src/components/PorraPulso'
import { pintaPorra, altoPorra, type DatosPorra } from '../src/lib/porraCard'
import {
  calculaPulso, seccionesVisibles, marcasDe, rangoTiempo, rangoKm,
  SECCIONES_PULSO, TITULOS_PULSO, type PulsoPorra, type SeccionPulso,
} from '../src/lib/porraPulso'

/**
 * EL ARNÉS: lo que sale en "Cómo está la porra" sale en lo que se comparte.
 *
 * Se pinta la pantalla de verdad (el componente, a HTML) y la tarjeta de verdad
 * (sobre un lienzo falso que apunta cada texto que se escribe), las dos con los
 * mismos pronósticos, y se exige que digan lo mismo. Si mañana se añade algo a
 * la pantalla y no a la tarjeta, esto falla antes de que se entere el grupo.
 *
 * Los pronósticos cubren TODAS las secciones a propósito: la primera prueba lo
 * comprueba, para que una sección nueva no pase sin probar por no salir aquí.
 */

const H = 3_600_000
const salida = Date.UTC(2026, 9, 3, 3, 30)
const runners = [
  { username: 'Alberto', bib: null, emoji: '🎸', color: 'sky' },
  { username: 'JM', bib: null, emoji: '🦍', color: 'rose' },
  { username: 'Soriano', bib: null, emoji: '🐼', color: 'amber' },
]
const p = (author: string, target: string, kind: string, value: string) =>
  ({ author, target, kind, value, createdAt: 0 }) as never

const bets = [
  p('Alberto', 'Alberto', 'order', '1'), p('Alberto', 'Alberto', 'finish', 'no'),
  p('Alberto', 'JM', 'finish_time', String(salida + 22.5 * H)),
  p('JM', 'Alberto', 'order', '1'), p('JM', 'Alberto', 'finish', 'si'), p('JM', 'Soriano', 'finish', 'no'),
  p('JM', 'Alberto', 'finish_time', String(salida + 21.8 * H)), p('JM', 'Soriano', 'abandon_km', '42'),
  p('JM', 'JM', 'fastest_km', '1'),
  // Quien mira y comparte: sale en todas las secciones.
  p('Tony21', 'JM', 'order', '1'), p('Tony21', 'JM', 'finish', 'si'),
  p('Tony21', 'Alberto', 'finish_time', String(salida + 24.5 * H)),
  p('Tony21', 'Soriano', 'abandon_km', '30.5'), p('Tony21', 'Alberto', 'fastest_km', '1'),
]
const QUIEN = 'Tony21'
const entrada = { bets, players: 3, runners, startsAt: salida, limitMin: 26 * 60, proyecciones: [], me: QUIEN }

/** Un lienzo que no pinta nada y apunta cada texto que se le escribe. */
function lienzoFalso() {
  const textos: string[] = []
  const estado: Record<string | symbol, unknown> = {}
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'fillText') return (t: unknown) => { textos.push(String(t)) }
      if (k === 'measureText') return (t: unknown) => ({ width: String(t).length * 7 })
      if (k in estado) return estado[k]
      return () => ({ addColorStop() {} })
    },
    set(_, k, v) { estado[k] = v; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, textos }
}

function pantalla(): { secciones: string[]; html: string; texto: string } {
  const html = renderToStaticMarkup(createElement(PorraPulso, { ...entrada, eventName: 'UP26 100K', photoUrl: null }))
  const texto = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
  return { secciones: [...html.matchAll(/data-seccion="([a-z]+)"/g)].map((m) => m[1]), html, texto }
}

function tarjeta(pulso: PulsoPorra) {
  const { ctx, textos } = lienzoFalso()
  const datos: DatosPorra = { evento: 'UP26 100K', foto: null, pulso, corredores: runners, autor: QUIEN }
  const hecho = pintaPorra(ctx, datos, { si: '#0284c7', no: '#ea580c' })
  return { ...hecho, textos, alto: altoPorra(datos) }
}

/** Los nombres que tiene que decir cada sección. */
function nombresDe(pulso: PulsoPorra, s: SeccionPulso): string[] {
  switch (s) {
    case 'favorito': return [pulso.favorito!.name]
    case 'votos': return pulso.votos.map((v) => v.name)
    case 'acabar': return pulso.acabar.map((a) => a.name)
    case 'tiempos': return pulso.tiempos.map((t) => t.name)
    case 'rapidos': return pulso.rapidos.map((v) => v.name)
    case 'abandonos': return pulso.abandonos.map((a) => a.name)
  }
}

describe('arnés: lo que sale en "Cómo está la porra" sale al compartir', () => {
  const pulso = calculaPulso(entrada)
  const vista = pantalla()
  const card = tarjeta(pulso)

  it('los pronósticos de prueba cubren todas las secciones', () => {
    expect(seccionesVisibles(pulso)).toEqual([...SECCIONES_PULSO])
  })

  it('la tarjeta tiene las mismas secciones que la pantalla, en el mismo orden', () => {
    expect(vista.secciones).toEqual([...SECCIONES_PULSO])
    expect(card.secciones).toEqual(vista.secciones)
  })

  it('cada sección lleva su título y sus corredores en los dos sitios', () => {
    for (const s of SECCIONES_PULSO) {
      const titulo = TITULOS_PULSO[s].toLowerCase()
      expect(vista.texto.toLowerCase(), `título de ${s} en pantalla`).toContain(titulo)
      expect(card.textos.map((t) => t.toLowerCase()), `título de ${s} en la tarjeta`).toContain(titulo)
      for (const nombre of nombresDe(pulso, s)) {
        expect(vista.texto, `${nombre} en ${s}, pantalla`).toContain(nombre)
        expect(card.textos, `${nombre} en ${s}, tarjeta`).toContain(nombre)
      }
    }
  })

  it('los tiempos y los kilómetros se escriben igual', () => {
    for (const t of pulso.tiempos) {
      expect(vista.texto).toContain(rangoTiempo(t.mins))
      expect(card.textos).toContain(rangoTiempo(t.mins))
    }
    for (const a of pulso.abandonos) {
      expect(vista.texto).toContain(rangoKm(a.kms))
      expect(card.textos).toContain(rangoKm(a.kms))
    }
  })

  it('lo marcado en pantalla ("tú") va en la tarjeta a nombre de quien comparte', () => {
    const enPantalla = marcasDe(pulso, 'tú')
    const enTarjeta = marcasDe(pulso, QUIEN)
    // Hay marca en todas las secciones que se pueden marcar.
    expect(new Set(enPantalla.map((m) => m.seccion))).toEqual(new Set(['votos', 'acabar', 'tiempos', 'rapidos', 'abandonos']))
    expect(enTarjeta.map((m) => [m.seccion, m.name])).toEqual(enPantalla.map((m) => [m.seccion, m.name]))
    for (const m of enPantalla) {
      if (m.texto === 'tú') continue
      expect(vista.texto, `marca ${m.texto}`).toContain(m.texto)
    }
    const tuSolos = enPantalla.filter((m) => m.texto === 'tú').length
    expect((vista.html.match(/>tú</g) ?? []).length).toBe(tuSolos)
    for (const m of enTarjeta) expect(card.textos, `marca ${m.texto} en la tarjeta`).toContain(m.texto)
    expect(card.textos.filter((t) => t === QUIEN).length).toBe(enTarjeta.filter((m) => m.texto === QUIEN).length)
  })

  it('compartir SIN mis votos: las mismas secciones que la pantalla y ninguna marca', () => {
    const { ctx, textos } = lienzoFalso()
    const datos: DatosPorra = { evento: 'UP26 100K', foto: null, pulso, corredores: runners, autor: null }
    const hecho = pintaPorra(ctx, datos, { si: '#0284c7', no: '#ea580c' })
    expect(hecho.secciones).toEqual(vista.secciones)
    for (const s of SECCIONES_PULSO) {
      expect(textos.map((t) => t.toLowerCase())).toContain(TITULOS_PULSO[s].toLowerCase())
    }
    for (const m of marcasDe(pulso, QUIEN)) expect(textos).not.toContain(m.texto)
    expect(textos.some((t) => t.includes(QUIEN))).toBe(false)
    expect(hecho.usado).toBeLessThanOrEqual(altoPorra(datos))
  })

  it('la tarjeta cabe en el alto que calcula', () => {
    expect(card.usado).toBeLessThanOrEqual(card.alto)
  })

  it('sin sesión no se marca nada, ni en pantalla ni en la tarjeta', () => {
    const anonimo = calculaPulso({ ...entrada, me: null })
    expect(marcasDe(anonimo, 'tú')).toEqual([])
    const { ctx, textos } = lienzoFalso()
    pintaPorra(ctx, { evento: 'UP26 100K', foto: null, pulso: anonimo, corredores: runners, autor: null }, { si: '#0284c7', no: '#ea580c' })
    expect(textos.some((t) => t.includes(QUIEN))).toBe(false)
  })
})
