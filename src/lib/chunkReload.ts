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
 * Guarded against reload loops: como mucho DOS recargas seguidas —la segunda
 * tras un par de segundos, para dejar pasar la propagación del despliegue— y a
 * la tercera se enseña el error de verdad. Un estado roto de verdad (sin red,
 * un fichero que no existe) no se queda recargando para siempre.
 */

const RELOAD_KEY = 'sln-chunk-reload'
/** Pasado este rato sin fallos, se empieza a contar de cero otra vez. */
const VENTANA_MS = 30_000
/**
 * Cuántas recargas se permiten seguidas, y cuánto se espera antes de cada una.
 *
 * DOS y no una porque el fallo tiene dos causas distintas encadenadas. La
 * primera recarga cubre la normal: la pestaña llevaba abierta desde el
 * despliegue anterior y solo hay que traerse el documento nuevo. Pero justo
 * después de desplegar hay unos segundos en los que el borde de Cloudflare
 * todavía sirve el documento VIEJO, así que esa primera recarga se trae otra
 * vez lo mismo, agota el único intento que había y acaba enseñando el cartel de
 * error a alguien que solo tenía que esperar dos segundos. Medido en
 * producción: pasó al desplegar mientras se miraba el mapa.
 *
 * La segunda espera antes de recargar, que es lo único que la hace útil:
 * recargar inmediatamente volvería a pedir el mismo documento rancio.
 *
 * Y no hay una tercera: si a los dos segundos sigue fallando, ya no es un
 * despliegue reciente y recargar en bucle no arregla nada — mejor el cartel,
 * que al menos dice qué ha pasado y no deja la pantalla parpadeando.
 */
const ESPERAS_MS = [0, 2_000]

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
 * Recarga para traerse el despliegue nuevo. Devuelve true si va a recargar
 * —puede que dentro de un par de segundos, no necesariamente ya— y false si ya
 * se han gastado los intentos, y entonces quien llama enseña el error de
 * verdad.
 */
export function reloadForChunkError(): boolean {
  let intentos = 0
  try {
    const crudo = sessionStorage.getItem(RELOAD_KEY)
    const previo = crudo ? (JSON.parse(crudo) as { n?: number; at?: number }) : null
    // Un fallo muy posterior no es el mismo episodio: se cuenta de cero.
    if (previo && Number.isFinite(previo.at) && Date.now() - previo.at! < VENTANA_MS) {
      intentos = Number(previo.n) || 0
    }
    if (intentos >= ESPERAS_MS.length) return false
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ n: intentos + 1, at: Date.now() }))
  } catch {
    // sessionStorage bloqueado (modo privado de algunos navegadores). Sin
    // dónde apuntar no se puede contar de una recarga a la siguiente, así que
    // aquí NO hay garantía contra el bucle y no se va a fingir que la hay: se
    // recarga, porque es lo que arregla el caso normal —que es el que pasa—, y
    // si el fallo fuera permanente esa pestaña se quedaría reintentando. Es el
    // mismo trato que había antes de contar los intentos.
    window.location.reload()
    return true
  }
  const espera = ESPERAS_MS[intentos]
  if (espera > 0) window.setTimeout(() => window.location.reload(), espera)
  else window.location.reload()
  return true
}
