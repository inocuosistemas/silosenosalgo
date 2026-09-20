import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { enlaceDeVista, type PestanaEvento, type VistaEvento } from '../lib/vistaEvento'

/**
 * La barra de secciones de un evento: la misma en la parrilla, en tu plan y
 * sobre el mapa, para que todo esté a un toque desde cualquier sitio.
 *
 * Son enlaces de verdad —se pueden abrir en otra pestaña o copiar— pero un
 * toque normal cambia de sección sin recargar la página.
 *
 * En un móvil no caben todas, y una barra cortada al ras parece completa: la
 * última pestaña entera invita a quedarse ahí. Por eso el lado por el que
 * sigue habiendo secciones se DIFUMINA —el contenido se apaga contra el borde—
 * y el difuminado desaparece al llegar al final.
 */
export function EventNav({ eventId, pestanas, actual, onIr }: {
  eventId: string
  pestanas: PestanaEvento[]
  actual: VistaEvento
  onIr: (vista: VistaEvento) => void
}) {
  const fila = useRef<HTMLElement>(null)
  /** Si queda barra por ver a cada lado. */
  const [bordes, setBordes] = useState({ izq: false, der: false })

  const mira = useCallback(() => {
    const caja = fila.current
    if (!caja) return
    const resto = caja.scrollWidth - caja.clientWidth - caja.scrollLeft
    setBordes({ izq: caja.scrollLeft > 4, der: resto > 4 })
  }, [])

  // La de turno se trae a la vista, y de paso se miran los bordes.
  useLayoutEffect(() => {
    const caja = fila.current
    const el = caja?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && caja) {
      const izquierda = el.offsetLeft - caja.offsetLeft
      if (izquierda < caja.scrollLeft || izquierda + el.offsetWidth > caja.scrollLeft + caja.clientWidth) {
        caja.scrollLeft = Math.max(0, izquierda - 8)
      }
    }
    mira()
  }, [actual, pestanas, mira])

  // Y cuando cambia el ancho de la pantalla: girar el móvil puede hacer que
  // quepan todas, y entonces el difuminado sobra.
  useEffect(() => {
    const caja = fila.current
    if (!caja || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(mira)
    ro.observe(caja)
    return () => ro.disconnect()
  }, [mira])

  return (
    <div className="relative">
      <nav
        ref={fila}
        aria-label="Secciones del evento"
        onScroll={mira}
        className="flex items-stretch gap-1 overflow-x-auto p-1 scrollbar-fantasma"
      >
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
            className={`flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              // Estiradas solo si caben todas: si no caben, la de al lado
              // tiene que quedar a medias en el borde, que es la pista.
              bordes.der || bordes.izq ? '' : 'grow'
            } ${
              actual === p.vista ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <span aria-hidden>{p.icono}</span>
            {p.texto}
          </a>
        ))}
      </nav>
      {/* Los difuminados, por encima y sin estorbar al dedo. Estrechos y a
          medio gas: lo que tiene que verse es la pestaña siguiente ASOMANDO
          —eso es lo que dice "hay más"—, y un velo ancho y opaco la tapaba
          entera, que es justo lo contrario. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-5 rounded-l-xl bg-gradient-to-r from-slate-900 via-slate-900/50 to-transparent transition-opacity ${
          bordes.izq ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-5 rounded-r-xl bg-gradient-to-l from-slate-900 via-slate-900/50 to-transparent transition-opacity ${
          bordes.der ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}
