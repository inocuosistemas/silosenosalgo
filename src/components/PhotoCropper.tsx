import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Encuadre de una foto: arrastrar para mover, pellizcar o rueda para acercar.
 *
 * El marco enseña EXACTAMENTE lo que se va a ver después — misma proporción que
 * el sitio donde acabará la imagen—, así que no hay sorpresas: lo que se
 * previsualiza aquí es lo que queda. Un cartel de carrera suele ser una foto
 * vertical del móvil o una imagen con el nombre abajo, y sin encuadre la tira
 * apaisada corta justo lo que importa.
 *
 * El recorte se aplica AL GUARDAR: lo que se sube es ya la región elegida, no
 * la foto entera más unas coordenadas. Así todo lo que la pinta después —el
 * lobby, el listado, y lo que venga— la enseña igual sin tener que saber nada
 * del encuadre. El precio es que para reencuadrar hay que volver a elegir la
 * foto, que es justo lo que se hace de todas formas cuando no gusta cómo quedó.
 */

/** Tamaño de salida: sobra para una cabecera a pantalla completa en móvil y
 *  pesa poco (el tope de KV para la foto son 1,5 MB). */
const OUT_W = 1200
const ZOOM_MAX = 4

export function PhotoCropper({
  file, aspect, title = 'Encuadrar la foto', onCancel, onDone,
}: {
  file: File
  /** Ancho/alto del marco. 3 = tira apaisada de cabecera. */
  aspect: number
  title?: string
  onCancel: () => void
  onDone: (jpeg: Blob) => void
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  // La URL del blob se crea UNA vez y se revoca al salir: creándola en el
  // render se generaría una por cada arrastre, y el navegador las retiene
  // hasta que se cierra la pestaña.
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameW, setFrameW] = useState(0)
  // Punteros vivos: uno = arrastrar, dos = pellizcar. Se guardan en una ref
  // porque cambian en cada `pointermove` y no deben provocar re-render.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; zoom: number } | null>(null)
  const dragFrom = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    let dead = false
    let created: ImageBitmap | null = null
    void (async () => {
      try {
        const bmp = await createImageBitmap(file)
        if (dead) { bmp.close(); return }
        created = bmp
        setBitmap(bmp)
      } catch {
        setError('No se pudo leer la imagen.')
      }
    })()
    return () => { dead = true; created?.close() }
  }, [file])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setFrameW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bitmap])

  const frameH = frameW / aspect
  // Escala mínima: la que hace que la imagen CUBRA el marco. Por debajo se
  // verían franjas vacías, y una franja vacía en un cartel no es un encuadre,
  // es un error.
  const baseScale = bitmap && frameW ? Math.max(frameW / bitmap.width, frameH / bitmap.height) : 1
  const eff = baseScale * zoom
  const dw = bitmap ? bitmap.width * eff : 0
  const dh = bitmap ? bitmap.height * eff : 0
  const maxX = Math.max(0, (dw - frameW) / 2)
  const maxY = Math.max(0, (dh - frameH) / 2)

  /** Nunca se sale de la imagen: el desplazamiento se recorta a lo que queda. */
  const clamp = useCallback((o: { x: number; y: number }) => ({
    x: Math.max(-maxX, Math.min(maxX, o.x)),
    y: Math.max(-maxY, Math.min(maxY, o.y)),
  }), [maxX, maxY])

  // Al cambiar el zoom, lo que estaba centrado puede quedar fuera de rango.
  useEffect(() => { setOffset((o) => clamp(o)) }, [clamp])

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      dragFrom.current = null
    } else {
      dragFrom.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (gesture.current.dist > 0) {
        const next = gesture.current.zoom * (dist / gesture.current.dist)
        setZoom(Math.max(1, Math.min(ZOOM_MAX, next)))
      }
      return
    }
    const from = dragFrom.current
    if (!from) return
    setOffset(clamp({ x: from.ox + (e.clientX - from.x), y: from.oy + (e.clientY - from.y) }))
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) gesture.current = null
    if (pointers.current.size === 0) dragFrom.current = null
  }

  async function save() {
    if (!bitmap || !frameW) return
    setBusy(true)
    try {
      // La región visible del marco, llevada a coordenadas de la imagen
      // original: se recorta de ahí, no de la versión mostrada, para no perder
      // resolución por el camino.
      const sx = ((dw - frameW) / 2 - offset.x) / eff
      const sy = ((dh - frameH) / 2 - offset.y) / eff
      const sw = frameW / eff
      const sh = frameH / eff
      const canvas = document.createElement('canvas')
      canvas.width = OUT_W
      canvas.height = Math.round(OUT_W / aspect)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('sin canvas')
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
      if (!blob) throw new Error('sin blob')
      onDone(blob)
    } catch {
      setError('No se pudo preparar la imagen.')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[2200] overflow-y-auto bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold">{title}</h2>
            <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
          </div>

          <div
            ref={frameRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(e) => setZoom((z) => Math.max(1, Math.min(ZOOM_MAX, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))}
            style={{ aspectRatio: String(aspect), touchAction: 'none' }}
            className="relative w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950 cursor-grab active:cursor-grabbing select-none"
          >
            {bitmap && src && frameW > 0 && (
              <img
                src={src}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  width: dw, height: dh,
                  left: '50%', top: '50%',
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  maxWidth: 'none',
                }}
              />
            )}
            {!bitmap && !error && (
              <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">Cargando imagen…</div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">Zoom</span>
            <input
              type="range" min={1} max={ZOOM_MAX} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-sky-500"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Arrastra para mover y pellizca (o usa la rueda) para acercar. Se guardará justo lo que se ve en el marco.
          </p>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void save()}
              disabled={!bitmap || busy}
              className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
            >
              {busy ? 'Guardando…' : 'Usar este encuadre'}
            </button>
            <button onClick={onCancel} disabled={busy} className="px-3 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
