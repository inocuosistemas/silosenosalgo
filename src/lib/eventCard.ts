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
const FONDO = '#0b1120'

const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const fuente = (px: number, peso = 400) => `${peso} ${px}px ${FUENTE}`

export interface DatosTarjetaEvento {
  nombre: string
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

export function dibujaTarjetaEvento(d: DatosTarjetaEvento): string {
  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO
  lienzo.height = ALTO
  const ctx = lienzo.getContext('2d')!
  ctx.fillStyle = FONDO
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
    velo.addColorStop(0, 'rgba(11,17,32,0.55)')
    velo.addColorStop(0.55, 'rgba(11,17,32,0.82)')
    velo.addColorStop(1, 'rgba(11,17,32,0.97)')
    ctx.fillStyle = velo
    ctx.fillRect(0, 0, ANCHO, ALTO)
  }

  const M = 72
  ctx.textAlign = 'left'

  // ── El sello de arriba: de qué va esto ─────────────────────────────────
  ctx.font = fuente(26, 700)
  ctx.fillStyle = d.terminada ? '#fbbf24' : '#38bdf8'
  ctx.fillText(d.terminada ? '🏁 CARRERA TERMINADA' : '🏁 PARRILLA', M, M + 30)

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
  // imágenes lentas.
  return lienzo.toDataURL('image/jpeg', 0.9)
}

export { cargaImagen }
