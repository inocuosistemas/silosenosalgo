import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError, reloadOnceForChunkError } from '../lib/chunkReload'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  /** True while we're auto-reloading after a stale-chunk error (blank, no card). */
  reloading: boolean
}

/**
 * Catches render/lifecycle errors anywhere in the tree and shows a recovery
 * screen instead of unmounting the whole app (which would leave only the dark
 * slate-950 background — the "pantalla en azul"). Error boundaries must be
 * class components; this is the only one in the codebase.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: Error): State {
    // Optimistically blank the screen for a stale-chunk error so the recovery
    // card never flashes before the reload kicks in (see componentDidCatch).
    return { error, reloading: isChunkLoadError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // A chunk failed to load — almost always a tab left open across a deploy.
      // Reload once to fetch the new build; if that's on cooldown (we already
      // retried and it's still failing), reveal the recovery card instead.
      if (!reloadOnceForChunkError()) this.setState({ reloading: false })
      return
    }
    // Keep the stack in the console for debugging; the UI stays friendly.
    console.error('Unhandled error caught by ErrorBoundary:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    // Reload imminent — match the Suspense fallback so there's no scary flash.
    if (this.state.reloading) {
      return <div style={{ minHeight: '100vh', background: '#020617' }} />
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-semibold text-slate-100">Algo ha fallado</h1>
          <p className="text-sm text-slate-400">
            La aplicación encontró un error inesperado. Tus datos guardados no se han
            perdido — vuelve a cargar para continuar.
          </p>
          {this.state.error.message && (
            <pre className="text-left text-xs text-rose-300 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            Recargar la página
          </button>
        </div>
      </div>
    )
  }
}
