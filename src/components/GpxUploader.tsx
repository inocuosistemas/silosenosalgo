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

  function handleFile(file: File) {
    if (!file.name.endsWith('.gpx')) {
      setError('El archivo debe ser .gpx')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const track = parseGpx(e.target!.result as string)
        setError(null)
        onTrackLoaded(track)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al leer el GPX')
      }
    }
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
        accept=".gpx"
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
