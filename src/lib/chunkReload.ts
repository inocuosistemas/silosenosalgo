/**
 * Recovery for the "stale chunk after deploy" failure.
 *
 * Vite fingerprints every JS chunk (`index-<hash>.js`, `App-<hash>.js`, …) and
 * the app is code-split (`App` and `LiveViewer` are `lazy()`, plus on-demand
 * imports for PDF/share/wind). When a new build is deployed, the hashes change.
 * A browser tab that loaded the PREVIOUS build will, on its next dynamic import,
 * request an old chunk URL that no longer exists. Our SPA fallback
 * (`/* -> /index.html`, 200) then serves HTML for that request, and the browser
 * refuses to execute it as a module:
 *
 *   'text/html' is not a valid JavaScript MIME type.
 *   Failed to fetch dynamically imported module: …
 *
 * The cure is simply to reload: index.html is served `no-cache`, so a reload
 * fetches the fresh document and its new chunk URLs.
 *
 * Guarded against reload loops: we only auto-reload if we haven't already done
 * so in the last few seconds. So a genuinely broken state (offline, a truly
 * missing asset) reloads at most once and then surfaces the error normally.
 */

const RELOAD_KEY = 'sln-chunk-reload-at'
const COOLDOWN_MS = 10_000

/** True when an error looks like a failed dynamic-import / wrong-MIME chunk load. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (!msg) return false
  return (
    msg.includes('is not a valid javascript mime type') ||
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('expected a javascript module script') ||
    msg.includes('failed to load module script') ||
    msg.includes('disallowed mime type')
  )
}

/**
 * Reload once to pick up a fresh deploy. Returns true if a reload was triggered,
 * false if it was suppressed by the cooldown (i.e. we already reloaded recently
 * and it's still failing — let the caller show a real error instead).
 */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage blocked (some private-mode configs) — still try one reload.
  }
  window.location.reload()
  return true
}
