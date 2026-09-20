import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { enlaceDeVista, type PestanaEvento, type VistaEvento } from '../lib/vistaEvento'

/**
 * La barra de secciones de un evento: la misma en la parrilla, en tu plan y
 * sobre el mapa, para que todo esté a un toque desde cualquier sitio.
 *
 * Son enlaces de verdad —se pueden abrir en otra pestaña o copiar— pero un
 * toque normal cambia de sección sin recargar la página.
 *
 * En un móvil no caben todas, y una barra cortada al ras parece completa: la
 * última pestaña entera invita a quedarse ahí. Así que el lado por el que
 * quedan secciones lleva una FLECHA, con su difuminado detrás, y pulsarla
 * desplaza la barra. Un difuminado solo no bastaba: caía justo en el hueco
 * entre dos pestañas —fondo sobre fondo— y no se veía nada.
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

  /** Desplaza la barra la mitad de lo que se ve, en el sentido que se pida. */
  const desplaza = (signo: 1 | -1) => {
    const caja = fila.current
    if (!caja) return
    caja.scrollBy({ left: signo * Math.max(120, caja.clientWidth * 0.6), behavior: 'smooth' })
  }

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
      {/* Las flechas: solo del lado por el que queda barra. */}
      {bordes.izq && <Flecha lado="izq" onIr={() => desplaza(-1)} />}
      {bordes.der && <Flecha lado="der" onIr={() => desplaza(1)} />}
    </div>
  )
}

/**
 * La flecha de un borde: dice que la barra sigue y lleva a la siguiente
 * tanda. Con su velo detrás para que las pestañas no se le peguen —van
 * pasando por debajo— y con área de dedo aunque el dibujo sea pequeño.
 */
function Flecha({ lado, onIr }: { lado: 'izq' | 'der'; onIr: () => void }) {
  const der = lado === 'der'
  return (
    <button
      type="button"
      onClick={onIr}
      aria-label={der ? 'Ver más secciones' : 'Volver a las anteriores'}
      className={`absolute inset-y-0 grid w-9 place-items-center ${der ? 'right-0 justify-items-end rounded-r-xl pr-0.5' : 'left-0 justify-items-start rounded-l-xl pl-0.5'}`}
      style={{
        background: `linear-gradient(to ${der ? 'left' : 'right'}, rgb(15 23 42) 45%, rgb(15 23 42 / 0.85) 70%, transparent)`,
      }}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-slate-300 shadow ring-1 ring-slate-600">
        {der ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </span>
    </button>
  )
}
