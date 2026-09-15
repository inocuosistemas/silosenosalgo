import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Share2, X } from 'lucide-react'
import { comparteImagen, type ComoSeFue } from '../lib/compartirImagen'

/**
 * Antes de compartir una imagen, se enseña.
 *
 * Hasta ahora, tocar "compartir" abría directamente el menú del sistema con
 * una imagen que no se había visto: la porra, el dorsal o la maqueta salían a
 * ciegas hacia el grupo. Aquí se ve tal cual va a llegar, y se manda o no.
 *
 * El menú del sistema se abre desde el botón de ESTA vista: `navigator.share`
 * solo funciona en respuesta a un toque, y dibujar la imagen antes —cargar la
 * foto del evento, pintar la tarjeta— se comía ese permiso en algunos móviles.
 *
 * Uso: `const { pide, vistaPrevia } = useVistaPreviaCompartir()`, pintar
 * `{vistaPrevia}` en cualquier sitio del componente (va en un portal, encima
 * de todo) y cambiar `comparteImagen(...)` por `pide(...)`: devuelve lo mismo,
 * y `'cancelada'` si se cierra sin compartir.
 */

interface Pedida {
  url: string
  fichero: string
  titulo: string
  resolve: (fue: ComoSeFue) => void
}

export function useVistaPreviaCompartir() {
  const [pedida, setPedida] = useState<Pedida | null>(null)

  const pide = useCallback(
    (url: string, fichero: string, titulo: string) =>
      new Promise<ComoSeFue>((resolve) => setPedida({ url, fichero, titulo, resolve })),
    [],
  )

  const vistaPrevia = pedida
    ? createPortal(
      <VistaPrevia
        pedida={pedida}
        onTermina={(fue) => {
          pedida.resolve(fue)
          setPedida(null)
        }}
      />,
      document.body,
    )
    : null

  return { pide, vistaPrevia }
}

function VistaPrevia({ pedida, onTermina }: { pedida: Pedida; onTermina: (fue: ComoSeFue) => void }) {
  const [enviando, setEnviando] = useState(false)

  // Escape cancela la vista previa y nada más: el dorsal y la maqueta también
  // se cierran con Escape, y sin cortarlo aquí se iban los dos de golpe.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (!enviando) onTermina('cancelada')
    }
    window.addEventListener('keydown', tecla, { capture: true })
    return () => window.removeEventListener('keydown', tecla, { capture: true })
  }, [enviando, onTermina])

  const comparte = async () => {
    if (enviando) return
    setEnviando(true)
    try {
      onTermina(await comparteImagen(pedida.url, pedida.fichero, pedida.titulo))
    } catch {
      onTermina('cancelada')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de lo que se va a compartir"
      className="fixed inset-0 z-[5000] flex flex-col items-center justify-center gap-3 bg-slate-950/90 px-4 backdrop-blur-sm"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      // Cortado aquí: en React un clic dentro de un portal sube igual por el
      // árbol de componentes, y tocar el fondo cerraba también el dorsal.
      onClick={(e) => {
        e.stopPropagation()
        if (!enviando) onTermina('cancelada')
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Así se va a compartir</p>
      <img
        src={pedida.url}
        alt="La imagen que se va a compartir"
        className="max-h-[70dvh] max-w-full rounded-xl border border-slate-700 object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onTermina('cancelada')}
          disabled={enviando}
          className="flex items-center gap-1.5 rounded-full border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white disabled:opacity-50"
        >
          <X size={15} /> Cancelar
        </button>
        <button
          onClick={comparte}
          disabled={enviando}
          autoFocus
          className="flex items-center gap-1.5 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-sky-400 disabled:opacity-60"
        >
          <Share2 size={15} /> {enviando ? 'Compartiendo…' : 'Compartir'}
        </button>
      </div>
    </div>
  )
}
