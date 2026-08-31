import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reloadOnceForChunkError } from './lib/chunkReload'
import { AuthProvider } from './lib/AuthContext'
import { TOKEN_RE, INVITE_RE } from '../shared/validate'

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
// El lobby de un evento es otra pantalla lean: no arrastra el planificador
// entero, igual que el visor.
const EventLobby = lazy(() => import('./components/EventLobby'))
const EventJoin = lazy(() => import('./components/EventJoin'))
// El mapa del evento arrastra Leaflet, así que va aparte del lobby: quien solo
// entra a elegir color no tiene por qué descargarse un mapa entero.
const EventLiveMap = lazy(() => import('./components/EventLiveMap'))

const params = new URLSearchParams(window.location.search)
const trackToken = params.get('t')
const isViewer = !!trackToken && TOKEN_RE.test(trackToken)
const eventId = params.get('e')
const isEvent = !isViewer && !!eventId && TOKEN_RE.test(eventId)
const joinCode = params.get('evento')
const isJoin = !isViewer && !isEvent && !!joinCode && INVITE_RE.test(joinCode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#020617' }} />}>
        {isViewer ? (
          <LiveViewer token={trackToken!} />
        ) : isEvent ? (
          // Con sesión, porque un evento es de sus participantes: el lobby
          // necesita saber quién mira para decirle cuál es su color.
          <AuthProvider>
            {params.get('mapa') ? <EventLiveMap id={eventId!} /> : <EventLobby id={eventId!} />}
          </AuthProvider>
        ) : isJoin ? (
          <AuthProvider>
            <EventJoin code={joinCode!} />
          </AuthProvider>
        ) : (
          <AuthProvider>
            <App />
          </AuthProvider>
        )}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
