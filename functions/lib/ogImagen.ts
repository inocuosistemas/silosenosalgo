/**
 * Qué imagen anuncia un enlace, y de qué tamaño.
 *
 * Los previsualizadores (WhatsApp, Telegram, Twitter…) deciden con `og:image`
 * y con el TAMAÑO declarado si pintan la pastilla grande —imagen ancha arriba,
 * texto debajo— o la miniatura cuadrada de al lado, que es la que sale cuando
 * lo que llega no cuadra: una imagen 3:1 anunciada como 1200×630 se recorta a
 * un cuadrado y el cartel de la carrera aparece partido por la mitad.
 *
 * Vive aparte del middleware para poder probarlo: la decisión —tarjeta, cartel
 * o marca— es la parte que se rompe, y no hace falta un edge para comprobarla.
 */

/** Una imagen de vista previa con lo que hay que declarar de ella. */
export interface ImagenPrevia {
  url: string
  /** Lo que se anuncia en `og:image:width` / `og:image:height`. */
  width: number
  height: number
}

/** La medida que espera todo el mundo: 1,91:1. Las tarjetas se dibujan así. */
export const TARJETA = { width: 1200, height: 630 } as const

/**
 * El cartel de la carrera es 3:1 (lo recorta así `PhotoCropper`). Se declara
 * como lo que es: mentir con 1200×630 es justo lo que hace que el
 * previsualizador recorte a un cuadrado.
 */
export const CARTEL = { width: 1200, height: 400 } as const

export const tarjeta = (url: string): ImagenPrevia => ({ url, ...TARJETA })
export const cartel = (url: string): ImagenPrevia => ({ url, ...CARTEL })

/** Datos del evento que hacen falta para elegir su imagen. */
export interface EventoParaImagen {
  id: string
  photoKey: string | null
  photoAt: number | null
  startsAt: number | null
  members: number
}

/** La clave KV donde vive la tarjeta dibujada de un evento. */
export const claveTarjeta = (id: string): string => `evento-${id}`

/**
 * La versión de la url de la tarjeta.
 *
 * La puerta que sirve estas imágenes las cachea un año —para la de una ruta
 * compartida está bien, no cambia nunca— y la de un evento sí cambia: entra
 * gente, se pone el cartel, se fija la hora. Sin esto, la primera tarjeta que
 * se subiera sería la que vería el grupo para siempre.
 */
export function versionTarjeta(ev: EventoParaImagen): string {
  return `${ev.photoAt ?? 0}-${ev.members}-${ev.startsAt ?? 0}`
}

/**
 * La imagen de un evento, por orden de lo que mejor cuenta la carrera:
 *
 *  1. La TARJETA dibujada (cartel de fondo, nombre, cuándo y cuántos van), que
 *     ya viene 1200×630 y entra en la pastilla grande. La sube quien organiza
 *     desde la parrilla; aquí solo se usa si existe de verdad, porque anunciar
 *     una que no está deja al previsualizador con un 404 y sin imagen ninguna.
 *  2. El CARTEL a secas, declarado 3:1. Enseña de qué carrera se trata aunque
 *     el previsualizador lo recorte.
 *  3. La tarjeta de "en directo" de la marca, que es mejor que nada.
 *
 * @param hayTarjeta ¿Existe la tarjeta dibujada en KV? Lo consulta quien llama.
 */
export function imagenDeEvento(
  origin: string,
  ev: EventoParaImagen,
  hayTarjeta: boolean,
): ImagenPrevia {
  if (hayTarjeta) {
    return tarjeta(`${origin}/og/${claveTarjeta(ev.id)}.png?v=${versionTarjeta(ev)}`)
  }
  if (ev.photoKey) {
    return cartel(`${origin}/api/events/${ev.id}/photo${ev.photoAt ? `?v=${ev.photoAt}` : ''}`)
  }
  return tarjeta(`${origin}/og-live.png`)
}
