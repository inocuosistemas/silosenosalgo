import { useEffect, useRef } from 'react'
import { enlaceDeVista, type PestanaEvento, type VistaEvento } from '../lib/vistaEvento'

/**
 * La barra de secciones de un evento: la misma en la parrilla, en tu plan y
 * sobre el mapa, para que todo esté a un toque desde cualquier sitio.
 *
 * Son enlaces de verdad —se pueden abrir en otra pestaña o copiar— pero un
 * toque normal cambia de sección sin recargar la página.
 */
export function EventNav({ eventId, pestanas, actual, onIr }: {
  eventId: string
  pestanas: PestanaEvento[]
  actual: VistaEvento
  onIr: (vista: VistaEvento) => void
}) {
  const fila = useRef<HTMLElement>(null)
  // En un móvil no caben todas: la de turno se trae a la vista.
  useEffect(() => {
    const el = fila.current?.querySelector<HTMLElement>('[aria-current="page"]')
    const caja = fila.current
    if (!el || !caja) return
    const izquierda = el.offsetLeft - caja.offsetLeft
    if (izquierda < caja.scrollLeft || izquierda + el.offsetWidth > caja.scrollLeft + caja.clientWidth) {
      caja.scrollLeft = Math.max(0, izquierda - 8)
    }
  }, [actual])

  return (
    <nav ref={fila} aria-label="Secciones del evento" className="flex items-stretch gap-1 overflow-x-auto p-1 scrollbar-fantasma">
      {pestanas.map((p) => (
        <a
          key={p.vista}
          href={enlaceDeVista(eventId, p.vista)}
          aria-current={actual === p.vista ? 'page' : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault()
            onIr(p.vista)
          }}
          className={`flex shrink-0 grow items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
            actual === p.vista ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
        >
          <span aria-hidden>{p.icono}</span>
          {p.texto}
        </a>
      ))}
    </nav>
  )
}
