import faviconRaw from '../../public/favicon.svg?raw'

/**
 * La marca de la app, embebida. En las apps el visor se sirve desde el paquete
 * OTA y una ruta absoluta a `/favicon.svg` no está garantizada ahí; incrustado
 * se ve igual en los tres sitios.
 */
export const LOGO_APP = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`
export const NOMBRE_APP = 'SiLoSeNoSalgo'
