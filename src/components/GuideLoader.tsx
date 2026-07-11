import { useRef, useState } from 'react'
import { guideErrorMessage, openGuidePackage, type BrowserGuide } from '../lib/guidePackage'

export function GuideLoader({ onLoad }: { onLoad: (guide: BrowserGuide) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      onLoad(await openGuidePackage(file))
    } catch (err) {
      setError(guideErrorMessage(err))
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept=".slsnsguide,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        title="Abrir una guía guardada en este navegador"
        className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-sky-400 hover:border-sky-700 transition-colors text-xs flex items-center gap-1.5 disabled:opacity-60"
      >
        <span aria-hidden="true">📖</span>
        <span className="hidden sm:inline">{loading ? 'Abriendo…' : 'Cargar guía'}</span>
      </button>
      {error && (
        <div role="alert" className="absolute right-0 top-full z-[2100] mt-2 w-64 rounded-lg border border-red-800 bg-slate-900 p-3 text-xs text-red-300 shadow-xl">
          <div className="flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Cerrar error" className="text-slate-500 hover:text-slate-200">×</button>
          </div>
        </div>
      )}
    </div>
  )
}
