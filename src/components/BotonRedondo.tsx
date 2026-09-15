import type { ReactNode } from 'react'

/** Un mando redondo de las vistas 3D: encendido en azul, apagado en pizarra. */
export function BotonRedondo({ etiqueta, activo = false, onClick, children }: {
  etiqueta: string
  activo?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={etiqueta}
      aria-label={etiqueta}
      className={`grid h-11 w-11 place-items-center rounded-full border shadow-lg backdrop-blur active:scale-95 ${
        activo ? 'border-sky-400 bg-sky-500/90 text-white' : 'border-slate-700 bg-slate-900/90 text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
