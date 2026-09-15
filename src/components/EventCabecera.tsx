import type { ReactNode } from 'react'
import { AuthMenu } from './AuthMenu'
import { LOGO_APP, NOMBRE_APP } from '../lib/marcaApp'

/**
 * La cabecera de la casa de un evento, IGUAL en todas sus secciones y en
 * cualquier pantalla: el nombre de la carrera a la izquierda, quién mira a la
 * derecha y las secciones debajo, con el mismo ancho y centrada.
 *
 * Cada sección tenía la suya. En la parrilla el menú de usuario iba a la
 * derecha del nombre; sobre el mapa, en la lista y en la porra iba a la
 * izquierda y sin nombre, con las pestañas a la derecha, y en un ordenador
 * acababan en las dos puntas de la pantalla. Cambiar de pestaña movía los
 * mandos de sitio. Ahora cambia lo de debajo y la cabecera se queda quieta.
 *
 * El logo de la app, a la izquierda, lleva a la portada —el planificador de
 * siempre, sin carrera—: desde un evento no había forma de volver a él.
 *
 * `flotante` es la misma cabecera como tarjeta sobre el mapa, que se quiere
 * entero; en las demás secciones va en una barra fija de lado a lado.
 */
export function EventCabecera({ nombre, nav, detalle = null, pie = null, flotante = false }: {
  nombre: string
  nav: ReactNode
  /** Debajo del nombre: en el mapa, los números de la carrera. */
  detalle?: ReactNode
  /** Debajo de las secciones: en el mapa, a quién se sigue. */
  pie?: ReactNode
  flotante?: boolean
}) {
  return (
    <div className={`pointer-events-auto mx-auto w-full max-w-lg ${
      flotante ? 'rounded-2xl border border-slate-700 bg-slate-950/85 p-2 shadow-lg backdrop-blur' : ''
    }`}>
      <div className="flex min-h-9 items-center gap-2 pl-1">
        <a
          href="/"
          title={`${NOMBRE_APP}: ir al planificador`}
          aria-label={`${NOMBRE_APP}: ir al planificador`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-900/90 hover:border-sky-700"
        >
          <img src={LOGO_APP} alt="" className="h-5 w-5" />
        </a>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">{nombre}</p>
        <AuthMenu />
      </div>
      {detalle}
      <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/90">{nav}</div>
      {pie}
    </div>
  )
}
