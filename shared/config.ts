/**
 * Canonical PUBLIC URL of the app. Every shareable link (invite links, "compartir
 * salida" ?s= links, and live-tracking ?t= links) must be built from this — never
 * from the current `window.location.origin` (which could be a *.pages.dev deploy
 * preview) nor a hardcoded pages.dev URL. The native apps mirror this constant.
 */
export const PUBLIC_BASE_URL = 'https://silosenosalgo.themakercrowd.com'

/**
 * De dónde se baja la baliza de Android, SIEMPRE la última publicada.
 *
 * Es un enlace fijo a propósito: apunta a la release más reciente de GitHub, así
 * que se puede pegar en un grupo o dejarlo escrito en una pantalla sin tener que
 * cambiarlo cada vez que se reparte una versión. Lo que hace que funcione es que
 * cada release publica el APK con este nombre exacto, sin versión; el mismo
 * fichero va además con la versión en el nombre, para quien descargue desde la
 * página. Ver CHANGELOG, "Cómo llega cada versión a quien la prueba".
 */
export const ANDROID_APK_URL =
  'https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk'
