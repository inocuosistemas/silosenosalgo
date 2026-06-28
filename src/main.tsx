import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reloadOnceForChunkError } from './lib/chunkReload'
import { AuthProvider } from './lib/AuthContext'
import { TOKEN_RE } from '../shared/validate'

// After a deploy the hashed chunk names change; a tab opened on the previous
// build fails to fetch its (now-missing) chunks — and since `App` is lazy, that
// happens right at startup. Vite fires `vite:preloadError` in that case. Reload
// once to pick up the new build instead of showing the error screen. If the
// reload is on cooldown (already retried), let it propagate to the ErrorBoundary.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForChunkError()) e.preventDefault()
})

// Code-split: the public live-tracking viewer (?t=<token>) is a lean page that
// must not pull in the full planning App, and vice-versa.
const App = lazy(() => import('./App'))
const LiveViewer = lazy(() => import('./components/LiveViewer'))

const trackToken = new URLSearchParams(window.location.search).get('t')
const isViewer = !!trackToken && TOKEN_RE.test(trackToken)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#020617' }} />}>
        {isViewer ? (
          <LiveViewer token={trackToken!} />
        ) : (
          <AuthProvider>
            <App />
          </AuthProvider>
        )}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
