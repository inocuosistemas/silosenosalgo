/**
 * Lo que comparten el servidor y la web sobre las fotos del evento.
 */

/** Lo más que ocupa una foto subida, ya comprimida en el móvil. El mismo tope que las de las notas. */
export const TOPE_FOTO_BYTES = 1_500_000

/** Lo más largo que puede ser el texto de una foto. */
export const TOPE_TEXTO_FOTO = 200

/** El identificador de una foto del evento: `n_` de una nota de baliza, `s_` subida al evento. */
export const FOTO_ID_RE = /^[ns]_[A-Za-z0-9_-]{10,40}$/
