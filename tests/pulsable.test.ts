import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Controles que se ven pero no se pueden pulsar.
 *
 * Sobre el mapa hay barras que flotan por encima —la cabecera del evento, la
 * del visor— y tienen que dejar pasar el dedo para que se pueda arrastrar el
 * mapa por debajo de sus huecos. Eso se hace apagándoles los eventos del ratón
 * (`pointer-events-none`), con una condición: todo lo que SÍ sea pulsable
 * dentro tiene que volver a encenderlos.
 *
 * Es una regla fácil de romper y silenciosa: el botón se dibuja perfecto, con
 * su borde y su color, y simplemente no responde. No lo caza el compilador, no
 * lo caza mirar la pantalla, y solo se descubre cuando alguien intenta usarlo
 * —en el peor momento, que es el día de la carrera—. Ha pasado ya dos veces:
 * con el "volver a la parrilla" y con el menú de usuario.
 *
 * Así que se comprueba leyendo el código: se busca cada trozo con los eventos
 * apagados y se exige que cada botón o enlace de dentro los reencienda, en él
 * mismo o en alguno de sus contenedores.
 *
 * Lo que esta prueba NO ve: un componente propio metido ahí dentro
 * (`<AuthMenu />`), porque su interior está en otro fichero. Para esos la regla
 * es la contraria y está escrita en el propio componente: que se encienda a sí
 * mismo, y así da igual dónde lo pongan.
 */

const APAGA = 'pointer-events-none'
const ENCIENDE = 'pointer-events-auto'

interface Fallo {
  fichero: string
  linea: number
  etiqueta: string
  texto: string
}

/** El texto de `className`, sea una cadena o una plantilla con condiciones. */
function claseDe(nodo: ts.JsxOpeningLikeElement): string {
  for (const attr of nodo.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'className') continue
    return attr.initializer ? attr.initializer.getText() : ''
  }
  return ''
}

/** ¿Es algo que se pulsa? Un botón, un enlace con destino, o algo con onClick. */
function esPulsable(nodo: ts.JsxOpeningLikeElement): boolean {
  const etiqueta = nodo.tagName.getText()
  const tiene = (n: string) => nodo.attributes.properties.some(
    (a) => ts.isJsxAttribute(a) && a.name.getText() === n,
  )
  if (etiqueta === 'button') return true
  if (etiqueta === 'a' && tiene('href')) return true
  return tiene('onClick') && /^[a-z]/.test(etiqueta)
}

function revisa(fichero: string, codigo: string): Fallo[] {
  const fuente = ts.createSourceFile(fichero, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fallos: Fallo[] = []

  const anda = (nodo: ts.Node, apagado: boolean, encendido: boolean) => {
    let apagadoAqui = apagado
    let encendidoAqui = encendido

    const apertura = ts.isJsxElement(nodo) ? nodo.openingElement
      : ts.isJsxSelfClosingElement(nodo) ? nodo
        : null

    if (apertura) {
      const clase = claseDe(apertura)
      if (clase.includes(APAGA)) { apagadoAqui = true; encendidoAqui = false }
      if (clase.includes(ENCIENDE)) encendidoAqui = true

      if (apagadoAqui && !encendidoAqui && esPulsable(apertura)) {
        const { line } = fuente.getLineAndCharacterOfPosition(apertura.getStart())
        fallos.push({
          fichero,
          linea: line + 1,
          etiqueta: apertura.tagName.getText(),
          texto: apertura.getText().replace(/\s+/g, ' ').slice(0, 90),
        })
      }
    }

    nodo.forEachChild((h) => anda(h, apagadoAqui, encendidoAqui))
  }

  anda(fuente, false, false)
  return fallos
}

/** Todos los .tsx de la aplicación. */
function componentes(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...componentes(p))
    else if (e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('lo que se ve y se pulsa, se pulsa', () => {
  it('ningún botón queda dentro de una zona con los eventos apagados', () => {
    const fallos = componentes('src').flatMap((f) => revisa(f, readFileSync(f, 'utf8')))
    const dilo = fallos.map((f) => `\n  ${f.fichero}:${f.linea} <${f.etiqueta}> ${f.texto}`).join('')
    expect(fallos, `Se ven pero no se pulsan:${dilo}\n`).toEqual([])
  })

  // Y que el detector detecta: si no, un test en verde no dice nada.
  it('caza el caso que ya ha pasado dos veces', () => {
    const roto = `
      export function Cabecera() {
        return (
          <div className="pointer-events-none absolute inset-x-0 top-0">
            <a href="/?e=1" className="rounded-lg border px-2">←</a>
          </div>
        )
      }`
    const fallos = revisa('roto.tsx', roto)
    expect(fallos).toHaveLength(1)
    expect(fallos[0].etiqueta).toBe('a')
  })

  it('se calla cuando el botón sí los reenciende', () => {
    const bien = `
      export function Cabecera() {
        return (
          <div className="pointer-events-none absolute inset-x-0 top-0">
            <a href="/?e=1" className="pointer-events-auto rounded-lg border px-2">←</a>
          </div>
        )
      }`
    expect(revisa('bien.tsx', bien)).toEqual([])
  })

  it('vale con que los reencienda un contenedor de por medio', () => {
    const bien = `
      export function Cabecera() {
        return (
          <div className="pointer-events-none absolute inset-x-0">
            <div className="pointer-events-auto flex gap-2">
              <button onClick={nada}>uno</button>
              <button onClick={nada}>dos</button>
            </div>
          </div>
        )
      }`
    expect(revisa('bien2.tsx', bien)).toEqual([])
  })
})
