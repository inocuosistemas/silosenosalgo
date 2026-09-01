import { useState, type ReactNode } from 'react'

/**
 * Una sección que se pliega y enseña, cerrada, lo que hay elegido dentro.
 *
 * El resumen del encabezado no es decoración: es lo que permite cerrarla. Una
 * sección plegada que solo dice "Mi marca" obliga a abrirla para saber cuál es,
 * y entonces plegarla no ha ahorrado nada — solo ha escondido información. Con
 * el resumen a la vista, abrir es únicamente para CAMBIAR.
 *
 * Por eso el criterio de si nace abierta es siempre el mismo: abierta cuando
 * queda algo por decidir, cerrada cuando ya está decidido.
 */
export function Plegable({ title, summary, defaultOpen = false, children }: {
  title: string
  /** Qué hay elegido ahora mismo. Se ve con la sección cerrada. */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-[11px] uppercase tracking-wider text-slate-500 shrink-0">{title}</span>
        {!open && summary !== undefined && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-slate-300">{summary}</span>
        )}
        <span className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''} ${open ? 'ml-auto' : ''}`}>›</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}
