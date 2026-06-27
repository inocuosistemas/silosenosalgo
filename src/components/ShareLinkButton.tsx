import { useRef, useState } from 'react'
import type { SharePayloadV1 } from '../lib/sharePayload'
import { createShare, gzipBytes, isShareSupported, MAX_SHARE_BYTES, ShareTransportError, uploadShareImage, type ShareMeta } from '../lib/shareTransport'
import { PUBLIC_BASE_URL } from '../../shared/config'

/**
 * Summary shown in the link preview (WhatsApp/Telegram/…). The date is rendered
 * here, on the sender's device, so it reflects their locale + timezone — the
 * edge has neither. Distance/elevation come straight from the track.
 */
function buildShareMeta(p: SharePayloadV1): ShareMeta {
  const km = p.track.totalDistanceKm
  const kmStr = km >= 100 ? Math.round(km).toString() : km.toFixed(1)
  const gain = Math.round(p.track.elevGainM).toLocaleString('es-ES')
  const when = new Date(p.startTimeISO)
    .toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
  return {
    title: p.track.name?.trim() || 'Salida compartida',
    desc: `${kmStr} km · +${gain} m · ${when}`,
  }
}

interface Props {
  /** Build the snapshot to share from the current app state. */
  getPayload: () => SharePayloadV1
  /**
   * Render the link's preview image (the landscape track card) to a PNG Blob.
   * Optional + best-effort: if absent or it fails, the link still works and the
   * preview falls back to the brand card.
   */
  capturePreview?: () => Promise<Blob | null>
}

type State = 'idle' | 'working' | 'done' | 'error'

function errorMessage(err: unknown): string {
  if (err instanceof ShareTransportError) {
    switch (err.kind) {
      case 'too_large': return 'La ruta es demasiado grande para compartir por enlace. Usa «Descargar GPX».'
      case 'unsupported': return 'Tu navegador no permite compartir enlaces (actualízalo).'
      case 'network': return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.'
      default: return 'No se pudo crear el enlace.'
    }
  }
  return 'No se pudo crear el enlace.'
}

/**
 * Creates a short shareable link for the current outing: gzips the payload,
 * uploads it to the Pages Function, and shows the resulting `/?s=<id>` URL with
 * a copy button. Self-contained — owns its own upload/copy state.
 */
export function ShareLinkButton({ getPayload, capturePreview }: Props) {
  const [state, setState] = useState<State>('idle')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const supported = isShareSupported()

  async function handleCreate() {
    setState('working')
    setError('')
    setCopied(false)
    try {
      const payload = getPayload()
      const json = JSON.stringify(payload)
      const gz = await gzipBytes(json)
      if (gz.byteLength > MAX_SHARE_BYTES) throw new ShareTransportError('too_large')
      const id = await createShare(gz, buildShareMeta(payload))

      // Render + upload the per-link preview image (the track card). Best-effort:
      // a failure leaves the link working with the brand-card preview fallback.
      try {
        const png = await capturePreview?.()
        if (png) await uploadShareImage(id, png)
      } catch { /* preview is a nice-to-have — never block the link for it */ }

      const url = `${PUBLIC_BASE_URL}/?s=${id}`
      setLink(url)
      setState('done')
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch { /* clipboard blocked — user can copy from the field */ }
    } catch (err) {
      setError(errorMessage(err))
      setState('error')
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      inputRef.current?.select()
    }
  }

  if (state === 'done') {
    return (
      <div className="flex items-center gap-1 max-w-[60vw] sm:max-w-sm">
        <input
          ref={inputRef}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
        />
        <button
          onClick={handleCopy}
          className="shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs rounded-lg transition-colors font-medium"
        >
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleCreate}
        disabled={!supported || state === 'working'}
        title={supported ? 'Crear enlace para compartir esta salida' : 'Tu navegador no permite esta función'}
        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors font-medium"
      >
        {state === 'working' ? 'Creando…' : '🔗 Compartir enlace'}
      </button>
      {state === 'error' && (
        <span className="text-rose-400 text-[11px] max-w-[40vw] sm:max-w-xs leading-tight">{error}</span>
      )}
    </div>
  )
}
