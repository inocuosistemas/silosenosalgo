import { useRef, useState } from 'react'
import type { GpxTrack } from '../lib/gpx'
import { parseGpx } from '../lib/gpx'

interface Props {
  onTrackLoaded: (track: GpxTrack) => void
}

export function GpxUploader({ onTrackLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  /**
   * Un archivo se reconoce por lo que LLEVA DENTRO, no por cómo se llame.
   *
   * Antes se exigía que el nombre acabara en `.gpx`, en minúsculas. Y el Garmin
   * Desktop exporta en MAYÚSCULAS: el recorrido oficial de la CanFranc —un GPX
   * impecable de siete mil puntos— se quedaba fuera con un "el archivo debe ser
   * .gpx" delante de un archivo que era exactamente eso. Lo mismo les pasa a
   * los que llegan como `.xml`, o sin extensión ninguna, según el reloj del que
   * salgan.
   *
   * La extensión ya no pinta nada. Se abre el archivo y se busca su etiqueta
   * raíz `<gpx`, que es lo que declara el formato y lo que ningún renombrado
   * puede falsear en los dos sentidos: un `.gpx` que en realidad es una foto no
   * la tiene, y un `.GPX`, un `.xml` o un archivo sin nombre de familia sí.
   */
  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const texto = String(e.target?.result ?? '')
      // La cabecera: la declaración XML y la raíz caben de sobra en el primer
      // par de kilobytes —el de la CanFranc trae tres mil caracteres de
      // espacios de nombres de Garmin— y así no se recorren siete mil puntos
      // para averiguar de qué va.
      if (!/<gpx[\s>]/i.test(texto.slice(0, 4096))) {
        setError(`"${file.name}" no es un archivo GPX: no lleva una ruta dentro.`)
        return
      }
      try {
        const track = parseGpx(texto)
        setError(null)
        onTrackLoaded(track)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al leer el GPX')
      }
    }
    reader.onerror = () => setError('No se pudo leer el archivo.')
    reader.readAsText(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
        ${dragging ? 'border-sky-400 bg-sky-900/20' : 'border-slate-600 hover:border-sky-500'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,.GPX,application/gpx+xml,application/xml,text/xml"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <div className="text-4xl mb-3">🗺️</div>
      <p className="text-slate-300 font-medium">Arrastra tu archivo GPX aquí</p>
      <p className="text-slate-500 text-sm mt-1">o haz clic para seleccionarlo</p>
      {error && (
        <p className="mt-3 text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</p>
      )}
    </div>
  )
}
