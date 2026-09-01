/**
 * El emoji con el que se identifica cada participante de un evento.
 *
 * Es LIBRE: cualquiera vale, el que a cada uno le haga gracia. Pero libre no
 * quiere decir que valga cualquier texto, y esa distinción es todo el trabajo
 * de este fichero: lo que se acepta tiene que ser UN emoji, no una palabra, no
 * una letra y no una ristra de siete. Un identificador que puede ser "JORGE" ya
 * no es un identificador visual, y en un disco de 24 píxeles no se lee.
 *
 * Dos conceptos distintos, y conviene no mezclarlos:
 *  · el emoji que se GUARDA y se ve, tal cual lo eligió su dueño;
 *  · la clave con la que se COMPARA (`foldEmoji`), que ignora el tono de piel y
 *    el selector de variación. 👍 y 👍🏽 son códigos distintos y el mismo dibujo
 *    a tamaño de mapa: si contaran como dos, dos personas llevarían la misma
 *    marca creyendo cada una que la suya es única.
 *
 * Sin dependencias de runtime: lo importan `functions/` (para validar antes de
 * guardar) y `src/` (para avisar mientras se escribe).
 */

/** Banderas: dos indicadores regionales, 🇪🇸. */
const RE_FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u
/** Teclas: 1️⃣ #️⃣ — dígito (o # / *) + selector + el marco U+20E3. */
const RE_KEYCAP = /^[0-9#*]️?⃣$/
/**
 * Un pictograma, con sus adornos opcionales: selector de variación, tono de
 * piel, y las uniones ZWJ que forman los compuestos (👨‍🚀, 🏳️‍🌈). El ancla `^$`
 * es lo que impide que cuele "🦊 corriendo" o dos emojis pegados.
 */
const RE_PICTO =
  /^\p{Extended_Pictographic}(️|[\u{1F3FB}-\u{1F3FF}])*(‍\p{Extended_Pictographic}(️|[\u{1F3FB}-\u{1F3FF}])*)*$/u

/**
 * Tope de longitud en unidades UTF-16. Un compuesto largo de verdad —👨‍👩‍👧‍👦, la
 * familia de cuatro— son 11; con 24 caben todos los que existen y ninguna
 * cadena que pretenda ser una frase.
 */
export const EMOJI_MAX_UNITS = 24

/** True cuando `x` es exactamente un emoji, con sus adornos. */
export function emojiOk(x: unknown): x is string {
  if (typeof x !== 'string') return false
  const v = x.trim()
  if (!v || v.length > EMOJI_MAX_UNITS) return false
  return RE_FLAG.test(v) || RE_KEYCAP.test(v) || RE_PICTO.test(v)
}

/**
 * La clave para comparar: fuera el selector de variación y el tono de piel.
 *
 * Lo que se guarda para enseñar NO se toca —quien elige 👍🏽 quiere ese y no
 * otro—; esto es solo lo que se mira para decir "ese ya lo lleva alguien".
 */
export function foldEmoji(emoji: string): string {
  return emoji.trim().replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '')
}

/**
 * El repertorio con el que se reparte al entrar (no una limitación: en el lobby
 * se cambia por el que sea).
 *
 * Elegidos por silueta y color distintos entre sí, que es lo único que importa
 * a 24 píxeles sobre un mapa en movimiento: no hay dos perros, ni dos frutas
 * redondas y rojas, ni dos caras amarillas seguidas. Sesenta pasan de largo del
 * tamaño de cualquier evento nuestro, así que al llegar siempre queda uno
 * libre y nadie empieza sin marca.
 */
export const EMOJI_POOL: readonly string[] = [
  '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
  '🦉', '🦅', '🦆', '🐢', '🐬', '🐙', '🦖', '🦄', '🐝', '🦋',
  '🍎', '🍌', '🍉', '🍇', '🍒', '🥑', '🌽', '🍄', '🌵', '🌻',
  '⚽', '🏀', '🎾', '🏈', '🥏', '🎿', '🛹', '🚀', '⛵', '🚂',
  '🎸', '🥁', '🎺', '🎨', '📷', '🔦', '🧭', '⏰', '💡', '🔑',
  '⭐', '🌈', '🔥', '❄️', '🌙', '☂️', '🍀', '🎩', '👑', '🧊',
] as const

/**
 * El primer emoji del repertorio que nadie lleva en este evento.
 *
 * `taken` son claves ya plegadas (`foldEmoji`). Devuelve `null` si no queda
 * ninguno —haría falta un evento de más de sesenta personas donde nadie haya
 * cambiado el suyo—, y entonces se entra sin marca y se elige en el lobby.
 */
export function firstFreeEmoji(taken: readonly string[]): string | null {
  const used = new Set(taken)
  return EMOJI_POOL.find((e) => !used.has(foldEmoji(e))) ?? null
}
