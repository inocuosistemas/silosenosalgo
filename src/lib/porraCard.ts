import { eventColorHex } from '../../shared/eventColors'

/**
 * La porra dibujada en un lienzo, para mandarla al grupo.
 *
 * ── Por qué dibujarla a mano y no fotografiar la pantalla ──────────────
 *
 * Lo normal para esto es una librería que convierte un trozo de página en
 * imagen (`html-to-image` y sus derivados). Aquí se probó y falla justo en lo
 * que importa: la foto del evento sale en blanco. No es un despiste nuestro —
 * está documentado en la propia librería y su apaño oficial es LLAMARLA DOS
 * VECES, porque la primera no llega a tiempo de meter las imágenes. Todas esas
 * librerías hacen lo mismo por dentro: envuelven la página en un SVG y le piden
 * al navegador que lo decodifique, y ahí dentro nada está bajo control: ni
 * cuándo se cargan las imágenes, ni las tipografías, ni si la pestaña está
 * delante —en una que no se ve, el navegador no decodifica y no termina nunca—.
 *
 * Pero esta tarjeta no es "un trozo de página cualquiera": la diseñamos
 * nosotros y sabemos exactamente qué lleva. Dibujarla es entonces la opción
 * sencilla: sale igual siempre, tarda milisegundos, no depende de nadie y se
 * puede comprobar. El precio es escribir las medidas a mano, que para una
 * tarjeta de seis elementos es barato.
 *
 * ── Medidas ───────────────────────────────────────────────────────────
 *
 * Se dibuja en 540 de ancho y se guarda al doble: 1080, que es lo que espera
 * cualquier chat sin recomprimir.
 */

const ANCHO = 540
const ESCALA = 2
const FONDO = '#0b1120'
const TINTA = '#f8fafc'
const TINTA_FLOJA = '#94a3b8'
const TINTA_MUY_FLOJA = '#64748b'

/** Un corredor, tal como sale en la tarjeta. */
export interface FilaPorra {
  nombre: string
  emoji: string | null
  color: string | null
  /** Cuántos dicen que acaba y cuántos que no; null si nadie lo ha dicho. */
  si: number | null
  no: number | null
  /** El tiempo que le dan, ya escrito ("6h 33m – 7h 30m"), o null. */
  tiempo: string | null
}

/** Lo que se pronostica que tarda un corredor: sus tiempos, en minutos. */
export interface FilaTiempo {
  nombre: string
  emoji: string | null
  color: string | null
  /** Cada pronóstico, en minutos de carrera y de menor a mayor. */
  minutos: number[]
  /** El rango ya escrito ("6h 33m – 7h 30m"), que es lo que se lee. */
  rango: string
  /** A qué minuto acabaría al ritmo de AHORA, si la carrera está en marcha. */
  yendoA: number | null
}

export interface DatosPorra {
  evento: string
  jugadores: number
  /** La foto del evento, ya cargada. Sin ella la tarjeta empieza por el título. */
  foto: HTMLImageElement | null
  favorito: { nombre: string; emoji: string | null; color: string | null; votos: number; tiempo: string | null } | null
  filas: FilaPorra[]
  /** "Cuánto tardan", con sus barras. Vacío si nadie ha dicho un tiempo. */
  tiempos: FilaTiempo[]
  /** El tope de la escala en minutos, y el límite de la prueba si lo tiene. */
  techo: number
  limiteMin: number | null
}

const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const fuente = (px: number, peso = 400) => `${peso} ${px}px ${FUENTE}`

/** Un rectángulo con las esquinas redondeadas, relleno y/o con borde. */
function pastilla(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, an: number, al: number, r: number,
  relleno?: string, borde?: string,
) {
  ctx.beginPath()
  // `roundRect` es de todos los navegadores que soporta la aplicación (Safari
  // 16 en adelante), pero si faltara, un rectángulo recto es mejor que nada.
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, an, al, r)
  else ctx.rect(x, y, an, al)
  if (relleno) { ctx.fillStyle = relleno; ctx.fill() }
  if (borde) { ctx.strokeStyle = borde; ctx.lineWidth = 1; ctx.stroke() }
}

/** La marca de un corredor: su aro de color con su emoji dentro. */
function marca(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, tam: number, emoji: string | null, color: string | null,
) {
  const hex = color ? eventColorHex(color) : '#94a3b8'
  const r = tam / 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  ctx.lineWidth = Math.max(2, Math.round(tam / 11))
  ctx.strokeStyle = hex
  ctx.stroke()
  if (emoji) {
    ctx.font = fuente(Math.round(tam * 0.55))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = TINTA
    // Los emojis se apoyan un pelo por debajo del centro óptico.
    ctx.fillText(emoji, cx, cy + tam * 0.03)
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, tam * 0.15, 0, Math.PI * 2)
    ctx.fillStyle = hex
    ctx.fill()
  }
}

/** Texto recortado con puntos suspensivos si no cabe en `max`. */
function recorta(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto
  let corto = texto
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > max) corto = corto.slice(0, -1)
  return `${corto}…`
}

/** Una casilla del marcador: el número grande y la palabra debajo. */
function casilla(
  ctx: CanvasRenderingContext2D, x: number, y: number, n: number, etiqueta: string, color: string,
) {
  const AN = 56, AL = 46
  const apagada = n === 0
  ctx.globalAlpha = apagada ? 0.4 : 1
  pastilla(ctx, x, y, AN, AL, 10, `${color}22`, color)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(30, 900)
  ctx.fillStyle = TINTA
  ctx.fillText(String(n), x + AN / 2, y + 31)
  ctx.font = fuente(10, 600)
  ctx.fillStyle = TINTA_FLOJA
  ctx.fillText(etiqueta.toUpperCase(), x + AN / 2, y + 42)
  ctx.globalAlpha = 1
  return AN
}

/**
 * Pinta la tarjeta y devuelve el PNG.
 *
 * Devuelve también el alto usado, que no se sabe hasta el final: depende de
 * cuántos corredores tengan pronósticos.
 */
export function dibujaPorra(datos: DatosPorra, colorSi: string, colorNo: string): string {
  const { evento, jugadores, foto, favorito, filas, tiempos, techo, limiteMin } = datos

  // Primero se calcula el alto, que hay que saberlo antes de crear el lienzo.
  const ALTO_FOTO = foto ? 150 : 0
  const ALTO_FAVORITO = favorito ? 78 : 0
  const ALTO_FILA = 74
  const ALTO_TIEMPO = 52
  // La tarjeta crece hacia abajo lo que haga falta: se calcula el alto y luego
  // se crea el lienzo. Nada se recorta ni se aprieta para caber en una medida
  // fija —una porra de ocho corredores es más larga que una de dos, y ya está—.
  const ALTO_TIEMPOS = tiempos.length > 0 ? 30 + tiempos.length * ALTO_TIEMPO + 22 : 0
  const alto = ALTO_FOTO + 22 + 62 + ALTO_FAVORITO
    + (filas.length > 0 ? 30 + filas.length * ALTO_FILA : 0)
    + ALTO_TIEMPOS + 34

  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = alto * ESCALA
  const ctx = lienzo.getContext('2d')!
  ctx.scale(ESCALA, ESCALA)
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  let y = 0

  // ── La foto, recortada como un "cover": se rellena el hueco y lo que sobra
  //    se va por los lados, en vez de deformar a la gente.
  if (foto) {
    const escala = Math.max(ANCHO / foto.naturalWidth, ALTO_FOTO / foto.naturalHeight)
    const an = foto.naturalWidth * escala
    const al = foto.naturalHeight * escala
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, ANCHO, ALTO_FOTO)
    ctx.clip()
    ctx.drawImage(foto, (ANCHO - an) / 2, (ALTO_FOTO - al) / 2, an, al)
    // Un degradado hacia el fondo para que el título de debajo no arranque de
    // un corte seco.
    const grad = ctx.createLinearGradient(0, ALTO_FOTO * 0.3, 0, ALTO_FOTO)
    grad.addColorStop(0, 'rgba(11,17,32,0)')
    grad.addColorStop(1, FONDO)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, ANCHO, ALTO_FOTO)
    ctx.restore()
    y = ALTO_FOTO
  }

  const M = 22                                   // margen lateral
  y += 20
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(12, 700)
  ctx.fillStyle = '#a78bfa'
  ctx.fillText(`LA PORRA · ${jugadores} ${jugadores === 1 ? 'JUGADOR' : 'JUGADORES'}`, M, y)
  y += 28
  ctx.font = fuente(26, 800)
  ctx.fillStyle = TINTA
  ctx.fillText(recorta(ctx, evento, ANCHO - M * 2), M, y)
  y += 14

  // ── El favorito ────────────────────────────────────────────────────────
  if (favorito) {
    y += 16
    marca(ctx, M + 26, y + 22, 52, favorito.emoji, favorito.color)
    const x = M + 64
    ctx.textAlign = 'left'
    ctx.font = fuente(11, 600)
    ctx.fillStyle = TINTA_MUY_FLOJA
    ctx.fillText('EL FAVORITO', x, y + 10)
    ctx.font = fuente(24, 800)
    ctx.fillStyle = TINTA
    ctx.fillText(recorta(ctx, favorito.nombre, ANCHO - x - M), x, y + 34)
    ctx.font = fuente(13)
    ctx.fillStyle = TINTA_FLOJA
    const cola = favorito.tiempo ? ` · le dan ${favorito.tiempo}` : ''
    ctx.fillText(`${favorito.votos} de ${jugadores} lo ponen primero${cola}`, x, y + 52)
    y += ALTO_FAVORITO
  }

  // ── Los corredores ─────────────────────────────────────────────────────
  if (filas.length > 0) {
    y += 22
    ctx.font = fuente(13, 700)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText('¿Acaba? · ¿en cuánto?', M, y)
    y += 10

    for (const f of filas) {
      const alturaFila = ALTO_FILA - 8
      pastilla(ctx, M, y, ANCHO - M * 2, alturaFila, 12, '#111c33', '#1e293b')
      marca(ctx, M + 12 + 17, y + 26, 34, f.emoji, f.color)

      // El marcador se coloca desde la derecha; el nombre ocupa lo que quede.
      let derecha = ANCHO - M - 12
      if (f.si !== null && f.no !== null) {
        derecha -= 56
        casilla(ctx, derecha, y + 8, f.no, 'no', colorNo)
        derecha -= 18
        ctx.textAlign = 'center'
        ctx.font = fuente(20, 800)
        ctx.fillStyle = '#334155'
        ctx.fillText('–', derecha + 9, y + 36)
        derecha -= 56
        casilla(ctx, derecha, y + 8, f.si, 'sí', colorSi)
      }

      ctx.textAlign = 'left'
      ctx.font = fuente(17, 700)
      ctx.fillStyle = '#f1f5f9'
      ctx.fillText(recorta(ctx, f.nombre, derecha - (M + 58)), M + 58, y + 26)

      if (f.tiempo) {
        ctx.font = fuente(14)
        ctx.fillStyle = TINTA_MUY_FLOJA
        ctx.fillText('tarda ', M + 58, y + 48)
        const ancho = ctx.measureText('tarda ').width
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText(f.tiempo, M + 58 + ancho, y + 48)
      }
      y += ALTO_FILA
    }
  }

  // ── Cuánto tardan ──────────────────────────────────────────────────────
  //
  // La otra mitad de la porra, y la que más se discute: no solo si acaba, sino
  // en cuánto. En la pantalla es una barra por corredor con un punto por
  // pronóstico, y aquí igual — mandar al grupo el marcador de "¿acaba?" sin los
  // tiempos era mandar media porra.
  if (tiempos.length > 0) {
    y += 26
    ctx.textAlign = 'left'
    ctx.font = fuente(13, 700)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText('Cuánto tardan', M, y)
    y += 14

    const X0 = M + 30
    const ANCHO_BARRA = ANCHO - M - X0
    const enCarril = (min: number) => X0 + Math.max(0, Math.min(1, min / techo)) * ANCHO_BARRA

    for (const t of tiempos) {
      marca(ctx, M + 11, y + 10, 22, t.emoji, t.color)
      ctx.textAlign = 'left'
      ctx.font = fuente(14, 700)
      ctx.fillStyle = '#f1f5f9'
      ctx.fillText(recorta(ctx, t.nombre, ANCHO_BARRA - 150), X0, y + 15)
      ctx.textAlign = 'right'
      ctx.font = fuente(13)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(t.rango, ANCHO - M, y + 15)

      // El carril, con las horas en punto muy flojas: sin ellas los puntos
      // flotan y no se sabe si 6h30 está cerca o lejos del límite.
      const yb = y + 30
      pastilla(ctx, X0, yb - 8, ANCHO_BARRA, 16, 4, '#1e293b')
      ctx.fillStyle = '#334155'
      for (let h = 3600; h < techo * 60; h += 3600) {
        const x = enCarril(h / 60)
        ctx.fillRect(Math.round(x), yb - 5, 1, 10)
      }
      // De dónde a dónde va la porra con él: banda corta, consenso; banda
      // larga, nadie tiene ni idea.
      if (t.minutos.length > 1) {
        const a = enCarril(t.minutos[0])
        const b = enCarril(t.minutos[t.minutos.length - 1])
        ctx.globalAlpha = 0.35
        pastilla(ctx, a, yb - 2, Math.max(2, b - a), 4, 2, '#a78bfa')
        ctx.globalAlpha = 1
      }
      for (const m of t.minutos) {
        ctx.beginPath()
        ctx.arc(enCarril(m), yb, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#a78bfa'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = FONDO
        ctx.stroke()
      }
      // Dónde va a acabar DE VERDAD si mantiene el ritmo. En verde y como
      // línea, para que no se confunda con los puntos de la porra.
      if (t.yendoA !== null) {
        ctx.fillStyle = '#34d399'
        ctx.fillRect(Math.round(enCarril(t.yendoA)) - 1, yb - 9, 2, 18)
      }
      y += ALTO_TIEMPO
    }

    // La escala: sin el 0 y el límite, una fila de puntos no dice nada.
    ctx.font = fuente(10)
    ctx.fillStyle = '#475569'
    ctx.textAlign = 'left'
    ctx.fillText('0', X0, y + 2)
    ctx.textAlign = 'right'
    ctx.fillText(limiteMin !== null ? `límite ${etiquetaDuracion(limiteMin)}` : etiquetaDuracion(techo), ANCHO - M, y + 2)
    y += 8
  }

  y += 18
  ctx.font = fuente(11)
  ctx.fillStyle = '#475569'
  ctx.textAlign = 'left'
  ctx.fillText('Ni un euro: se juega el orgullo · silosenosalgo', M, y)

  return lienzo.toDataURL('image/png')
}

/** "8h 00m" para la escala; la tarjeta no depende de nadie más para escribirla. */
function etiquetaDuracion(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

/** Trae una imagen y espera a que esté lista; null si no se pudo. */
export function cargaImagen(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    // Una foto que no abre no puede dejar esperando al que quiere compartir.
    setTimeout(() => resolve(null), 5_000)
    img.src = url
  })
}
