import { cargaImagen } from './porraCard'

/**
 * lib/eventCard.ts — la tarjeta que se ve al pegar el enlace de la parrilla.
 *
 * WhatsApp, Telegram y compañía no ejecutan JavaScript: leen el HTML crudo y
 * enseñan lo que diga `og:image`. El enlace de la parrilla —el que se pasa a
 * los que corren— salía con el cartel de la carrera a secas, recortado a lo
 * bruto por el previsualizador, o con la tarjeta de marca, que habla de
 * previsión meteorológica y no dice ni qué carrera es.
 *
 * Aquí se dibuja una de verdad: el cartel de fondo, el nombre, cuándo se sale y
 * cuántos van. Se dibuja EN EL NAVEGADOR y se sube, que es como ya funcionan
 * las tarjetas de las rutas compartidas — en el borde no hay lienzo con el que
 * pintar ni tipografías con las que medir.
 *
 * 1200×630, que es la medida que esperan todos y la que declara el HTML.
 */

const ANCHO = 1200
const ALTO = 630
/**
 * Píxeles reales por unidad de dibujo. Se dibuja en 1200×630 —la medida que
 * espera todo el mundo y la que declara el HTML— sobre un lienzo de 1800×945,
 * así que el texto y el cartel llegan con pixeles de sobra a una pantalla
 * retina en vez de verse blandos. Mismo 1,5× que la tarjeta de una ruta
 * compartida (`ShareCard.capturePreview`), y por lo mismo: a 2× el fichero se
 * pasa del tamaño que los previsualizadores aceptan y se quedan sin imagen.
 */
const ESCALA = 1.5
const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const fuente = (px: number, peso = 400) => `${peso} ${px}px ${FUENTE}`

/**
 * Los tres enlaces de una carrera que se pegan en un chat. Cada uno ofrece una
 * cosa distinta y hasta ahora los tres se anunciaban con la misma imagen: en el
 * grupo parecían el mismo enlace repetido hasta que alguien leía el texto.
 */
export type TipoEnlace = 'parrilla' | 'publico' | 'invitacion'

/** El sello de arriba y el color de la tarjeta: lo que distingue un enlace de
 *  otro DE UN VISTAZO, que es como se miran las vistas previas. */
interface Sello {
  etiqueta: string
  /** Relleno del sello. */
  color: string
  /** Base del velo sobre el cartel (y del fondo liso si no hay cartel). Tiñe
   *  la tarjeta entera, así que los tres se distinguen sin leer nada. */
  velo: [number, number, number]
}

const SELLOS: Record<TipoEnlace, Sello> = {
  // Azul: la parrilla es la casa de quien ya corre la carrera.
  parrilla: { etiqueta: '🏁 PARRILLA', color: '#38bdf8', velo: [11, 17, 32] },
  // Rojo: el enlace público es para MIRAR, y el rojo es el color de seguir algo
  // que está pasando.
  publico: { etiqueta: '📍 SIGUE LA CARRERA', color: '#fb7185', velo: [32, 12, 20] },
  // Verde: te están invitando a entrar, que es lo único de los tres que pide
  // algo de quien lo recibe.
  invitacion: { etiqueta: '🎽 TE APUNTAS', color: '#34d399', velo: [8, 28, 24] },
}

/** Terminada manda sobre el tipo: da igual a qué enlace apuntes, ya se corrió. */
const SELLO_TERMINADA: Sello = {
  etiqueta: '🏁 CARRERA TERMINADA', color: '#fbbf24', velo: [24, 18, 10],
}

/**
 * Las tres tarjetas que hay que dibujar y subir, con el sufijo de su clave.
 * La parrilla se queda SIN sufijo: es la clave que ya existía, y cambiarla
 * dejaría huérfanas las tarjetas subidas hasta ahora. Espejo del `SUFIJO` de
 * `functions/lib/ogImagen.ts`, que es quien las sirve.
 */
export const VARIANTES: readonly { tipo: TipoEnlace; sufijo: string }[] = [
  { tipo: 'parrilla', sufijo: '' },
  { tipo: 'publico', sufijo: '-p' },
  { tipo: 'invitacion', sufijo: '-i' },
]

export interface DatosTarjetaEvento {
  nombre: string
  /** Qué enlace anuncia esta tarjeta. */
  tipo: TipoEnlace
  /** El cartel de la carrera, ya cargado. Sin él, fondo liso de la marca. */
  cartel: HTMLImageElement | null
  /** Cuándo se sale, ya escrito ("sábado, 5 de septiembre · 08:30"). */
  cuando: string | null
  participantes: number
  /** Kilómetros y desnivel, si el evento ya tiene recorrido. */
  km: number | null
  desnivel: number | null
  /** Si la carrera ya terminó: entonces esto es un recuerdo, no una convocatoria. */
  terminada: boolean
}

/** Texto recortado con puntos suspensivos si no cabe. */
function recorta(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto
  let corto = texto
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > max) corto = corto.slice(0, -1)
  return `${corto}…`
}

/** El nombre a dos líneas si hace falta: una carrera puede llamarse muy largo. */
function enDosLineas(ctx: CanvasRenderingContext2D, texto: string, max: number): string[] {
  if (ctx.measureText(texto).width <= max) return [texto]
  const palabras = texto.split(' ')
  let primera = ''
  for (let i = 0; i < palabras.length; i++) {
    const prueba = primera ? `${primera} ${palabras[i]}` : palabras[i]
    if (ctx.measureText(prueba).width > max) break
    primera = prueba
  }
  if (!primera) return [recorta(ctx, texto, max)]
  const resto = texto.slice(primera.length).trim()
  return [primera, recorta(ctx, resto, max)]
}

/**
 * El sello: una pastilla de color con el tipo de enlace dentro.
 *
 * Pastilla rellena y no texto suelto porque una vista previa se mira del tamaño
 * de un sello de correos: un renglón de 26 px en color se pierde sobre el
 * cartel, y una mancha de color no.
 */
function dibujaSello(ctx: CanvasRenderingContext2D, sello: Sello, x: number, y: number): void {
  const ALTO_SELLO = 52
  const LADOS = 22
  ctx.font = fuente(28, 800)
  const ancho = ctx.measureText(sello.etiqueta).width + LADOS * 2
  ctx.fillStyle = sello.color
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, ancho, ALTO_SELLO, ALTO_SELLO / 2)
    ctx.fill()
  } else {
    // Safari viejo: sin esquinas redondas, pero con sello.
    ctx.fillRect(x, y, ancho, ALTO_SELLO)
  }
  // Texto oscuro sobre el color, que es lo que más contrasta a tamaño pequeño.
  ctx.fillStyle = '#0b1120'
  ctx.textBaseline = 'middle'
  ctx.fillText(sello.etiqueta, x + LADOS, y + ALTO_SELLO / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

export function dibujaTarjetaEvento(d: DatosTarjetaEvento): string {
  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = ALTO * ESCALA
  const ctx = lienzo.getContext('2d')!
  // Todo lo que viene debajo dibuja en unidades de 1200×630 y sale a 1800×945.
  ctx.scale(ESCALA, ESCALA)
  const sello = d.terminada ? SELLO_TERMINADA : SELLOS[d.tipo]
  const [vr, vg, vb] = sello.velo
  ctx.fillStyle = `rgb(${vr}, ${vg}, ${vb})`
  ctx.fillRect(0, 0, ANCHO, ALTO)

  // ── El cartel, de fondo y oscurecido ───────────────────────────────────
  //
  // Recortado como un "cover" y apagado con un velo: el cartel de una carrera
  // suele ser blanco y con letras negras, y encima de él no se lee nada. Así se
  // reconoce la carrera de un vistazo y el texto sigue siendo legible.
  if (d.cartel) {
    const escala = Math.max(ANCHO / d.cartel.naturalWidth, ALTO / d.cartel.naturalHeight)
    const an = d.cartel.naturalWidth * escala
    const al = d.cartel.naturalHeight * escala
    ctx.drawImage(d.cartel, (ANCHO - an) / 2, (ALTO - al) / 2, an, al)
    const velo = ctx.createLinearGradient(0, 0, 0, ALTO)
    velo.addColorStop(0, `rgba(${vr},${vg},${vb},0.55)`)
    velo.addColorStop(0.55, `rgba(${vr},${vg},${vb},0.82)`)
    velo.addColorStop(1, `rgba(${vr},${vg},${vb},0.97)`)
    ctx.fillStyle = velo
    ctx.fillRect(0, 0, ANCHO, ALTO)
  }

  const M = 72
  ctx.textAlign = 'left'

  // ── El sello de arriba: QUÉ enlace es este ─────────────────────────────
  dibujaSello(ctx, sello, M, M - 8)

  // ── El nombre, lo más grande de la tarjeta ─────────────────────────────
  ctx.font = fuente(76, 800)
  ctx.fillStyle = '#f8fafc'
  const lineas = enDosLineas(ctx, d.nombre, ANCHO - M * 2)
  let y = lineas.length > 1 ? 300 : 340
  for (const l of lineas) {
    ctx.fillText(l, M, y)
    y += 86
  }

  // ── Cuándo ─────────────────────────────────────────────────────────────
  if (d.cuando) {
    ctx.font = fuente(34)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText(recorta(ctx, d.cuando, ANCHO - M * 2), M, y + 6)
  }

  // ── La tira de abajo: los números y quién lo publica ────────────────────
  const yb = ALTO - M
  ctx.font = fuente(30, 700)
  ctx.fillStyle = '#e2e8f0'
  const trozos: string[] = []
  if (d.km !== null) trozos.push(`${d.km.toFixed(1)} km`)
  if (d.desnivel !== null) trozos.push(`↑${Math.round(d.desnivel).toLocaleString('es-ES')} m`)
  trozos.push(`${d.participantes} ${d.participantes === 1 ? 'participante' : 'participantes'}`)
  ctx.fillText(trozos.join('   ·   '), M, yb)

  ctx.textAlign = 'right'
  ctx.font = fuente(24, 600)
  ctx.fillStyle = '#64748b'
  ctx.fillText('silosenosalgo', ANCHO - M, yb)

  // JPEG y no PNG: la puerta que la sirve declara `image/jpeg` para todas las
  // tarjetas, y un PNG servido como JPEG es pedirle al previsualizador que
  // adivine. Además pesa la cuarta parte, y un crawler impaciente descarta las
  // imágenes lentas. 0,85 y no 0,9 porque ahora el lienzo es 1,5×: el fichero
  // se queda donde estaba y los píxeles son los que suben.
  return lienzo.toDataURL('image/jpeg', 0.85)
}

export { cargaImagen }
