import { eventColorHex } from '../../shared/eventColors'
import {
  seccionesVisibles, marcasDe, rangoTiempo, rangoKm, fraseFavorito, TITULOS_PULSO,
  type PulsoPorra, type SeccionPulso,
} from './porraPulso'

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

// ── "Cómo está la porra", en tarjeta ────────────────────────────────────────
//
// Se pinta desde el MISMO modelo que la pantalla (`lib/porraPulso`) y
// recorriendo las mismas secciones, con un pintor por sección declarado como
// `Record<SeccionPulso, Pintor>`: una sección sin pintor aquí no compila, y
// `tests/porraCompartir.test.ts` comprueba que las dos dicen lo mismo.

export interface DatosPorra {
  evento: string
  /** La foto del evento, ya cargada. Sin ella la tarjeta empieza por el título. */
  foto: HTMLImageElement | null
  pulso: PulsoPorra
  /** Emoji y color de cada corredor, para sus marcas. */
  corredores: { username: string; emoji: string | null; color: string | null }[]
  /** Quién la comparte: lo suyo va marcado con su nombre. */
  autor: string | null
}

interface Colores { si: string; no: string }

interface Pintor {
  /** Lo que ocupa la sección: el alto del lienzo se sabe antes de pintar. */
  alto: (d: DatosPorra) => number
  /** Pinta la sección empezando en `y`, sin salirse de su `alto`. */
  pinta: (ctx: CanvasRenderingContext2D, d: DatosPorra, y: number, c: Colores) => void
}

const M = 22                      // margen lateral
const ALTO_FOTO = 150
const ALTO_PIE = 34
/** El azul de lo marcado, el mismo "tú" de la pantalla. */
const AZUL_MARCA = '#7dd3fc'

const corredorDe = (d: DatosPorra, nombre: string) => d.corredores.find((c) => c.username === nombre)
const marcasTarjeta = (d: DatosPorra) => (d.autor ? marcasDe(d.pulso, d.autor) : [])
const marcaDe = (d: DatosPorra, s: SeccionPulso, nombre: string) =>
  marcasTarjeta(d).find((m) => m.seccion === s && m.name === nombre)?.texto ?? null

function tituloSeccion(ctx: CanvasRenderingContext2D, texto: string, y: number) {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(13, 700)
  ctx.fillStyle = '#e2e8f0'
  ctx.fillText(texto, M, y)
}

/**
 * La barra de un recuento, con la marca de quien comparte DENTRO del carril:
 * al lado le robaba ancho y la barra marcada parecía más corta.
 */
function barra(
  ctx: CanvasRenderingContext2D, x: number, y: number, ancho: number,
  n: number, max: number, color: string, marcaTexto: string | null,
) {
  pastilla(ctx, x, y, ancho, 14, 7, '#1e293b')
  pastilla(ctx, x, y, Math.max(8, (n / max) * ancho), 14, 7, color)
  if (marcaTexto) {
    ctx.font = fuente(10, 800)
    const an = ctx.measureText(marcaTexto).width + 12
    const px = x + ancho - an - 2
    pastilla(ctx, px, y + 1, an, 12, 6, 'rgba(2,6,23,0.8)')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = AZUL_MARCA
    ctx.fillText(marcaTexto, px + an / 2, y + 7.5)
    ctx.textBaseline = 'alphabetic'
  }
}

/** "Quién gana" y "⚡ Km más rápido": una barra por corredor votado. */
function listaDeBarras(
  ctx: CanvasRenderingContext2D, d: DatosPorra, y0: number,
  s: 'votos' | 'rapidos', filas: { name: string; n: number }[], color: string,
) {
  const max = Math.max(1, ...filas.map((v) => v.n))
  let y = y0 + 26
  tituloSeccion(ctx, TITULOS_PULSO[s], y)
  y += 12
  for (const v of filas) {
    const c = corredorDe(d, v.name)
    marca(ctx, M + 11, y + 11, 22, c?.emoji ?? null, c?.color ?? null)
    const x = M + 30
    const anchoNombre = 130
    ctx.textAlign = 'left'
    ctx.font = fuente(14, 700)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillText(recorta(ctx, v.name, anchoNombre), x, y + 16)
    const bx = x + anchoNombre + 10
    barra(ctx, bx, y + 4, ANCHO - M - 26 - bx, v.n, max, color, marcaDe(d, s, v.name))
    ctx.textAlign = 'right'
    ctx.font = fuente(13, 800)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText(String(v.n), ANCHO - M, y + 16)
    y += 30
  }
}

const TARJETA: Record<SeccionPulso, Pintor> = {
  favorito: {
    alto: () => 94,
    pinta: (ctx, d, y0) => {
      const f = d.pulso.favorito!
      const y = y0 + 16
      const c = corredorDe(d, f.name)
      marca(ctx, M + 26, y + 22, 52, c?.emoji ?? null, c?.color ?? null)
      const x = M + 64
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.font = fuente(11, 600)
      ctx.fillStyle = TINTA_MUY_FLOJA
      ctx.fillText(TITULOS_PULSO.favorito.toUpperCase(), x, y + 10)
      ctx.font = fuente(24, 800)
      ctx.fillStyle = TINTA
      ctx.fillText(recorta(ctx, f.name, ANCHO - x - M), x, y + 34)
      ctx.font = fuente(13)
      ctx.fillStyle = TINTA_FLOJA
      ctx.fillText(fraseFavorito(d.pulso), x, y + 52)
    },
  },

  votos: {
    alto: (d) => 38 + d.pulso.votos.length * 30,
    pinta: (ctx, d, y0) => listaDeBarras(ctx, d, y0, 'votos', d.pulso.votos, '#7c3aed'),
  },

  acabar: {
    alto: (d) => 32 + d.pulso.acabar.length * 64,
    pinta: (ctx, d, y0, col) => {
      let y = y0 + 22
      tituloSeccion(ctx, TITULOS_PULSO.acabar, y)
      y += 10
      for (const a of d.pulso.acabar) {
        pastilla(ctx, M, y, ANCHO - M * 2, 58, 12, '#111c33', '#1e293b')
        const c = corredorDe(d, a.name)
        marca(ctx, M + 12 + 17, y + 29, 34, c?.emoji ?? null, c?.color ?? null)
        // El marcador se coloca desde la derecha; el nombre ocupa lo que quede.
        let derecha = ANCHO - M - 12
        derecha -= 56
        casilla(ctx, derecha, y + 6, a.no, 'no', col.no)
        derecha -= 18
        ctx.textAlign = 'center'
        ctx.font = fuente(20, 800)
        ctx.fillStyle = '#334155'
        ctx.fillText('–', derecha + 9, y + 34)
        derecha -= 56
        casilla(ctx, derecha, y + 6, a.si, 'sí', col.si)
        ctx.textAlign = 'left'
        ctx.font = fuente(17, 700)
        ctx.fillStyle = '#f1f5f9'
        ctx.fillText(recorta(ctx, a.name, derecha - (M + 58) - 8), M + 58, y + 26)
        const m = marcaDe(d, 'acabar', a.name)
        if (m) {
          ctx.font = fuente(12, 700)
          ctx.fillStyle = AZUL_MARCA
          ctx.fillText(m, M + 58, y + 45)
        }
        y += 64
      }
    },
  },

  tiempos: {
    alto: (d) => 48 + d.pulso.tiempos.length * 52,
    pinta: (ctx, d, y0) => {
      const p = d.pulso
      let y = y0 + 26
      tituloSeccion(ctx, TITULOS_PULSO.tiempos, y)
      y += 14
      const X0 = M + 30
      const ANCHO_BARRA = ANCHO - M - X0
      const enCarril = (min: number) => X0 + Math.max(0, Math.min(1, min / p.techo)) * ANCHO_BARRA
      for (const t of p.tiempos) {
        const c = corredorDe(d, t.name)
        marca(ctx, M + 11, y + 10, 22, c?.emoji ?? null, c?.color ?? null)
        // De derecha a izquierda: el rango, lo marcado y el nombre en lo que quede.
        const rango = rangoTiempo(t.mins)
        ctx.textAlign = 'right'
        ctx.font = fuente(13)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText(rango, ANCHO - M, y + 15)
        let hasta = ANCHO - M - ctx.measureText(rango).width - 10
        const m = marcaDe(d, 'tiempos', t.name)
        if (m) {
          ctx.font = fuente(12, 700)
          ctx.fillStyle = AZUL_MARCA
          ctx.fillText(m, hasta, y + 15)
          hasta -= ctx.measureText(m).width + 10
        }
        ctx.textAlign = 'left'
        ctx.font = fuente(14, 700)
        ctx.fillStyle = '#f1f5f9'
        ctx.fillText(recorta(ctx, t.name, Math.max(40, hasta - X0)), X0, y + 15)

        // El carril, con las horas en punto muy flojas.
        const yb = y + 30
        pastilla(ctx, X0, yb - 8, ANCHO_BARRA, 16, 4, '#1e293b')
        ctx.fillStyle = '#334155'
        for (let h = 60; h < p.techo; h += 60) ctx.fillRect(Math.round(enCarril(h)), yb - 5, 1, 10)
        if (t.mins.length > 1) {
          const a = enCarril(t.mins[0])
          const b = enCarril(t.mins[t.mins.length - 1])
          ctx.globalAlpha = 0.35
          pastilla(ctx, a, yb - 2, Math.max(2, b - a), 4, 2, '#a78bfa')
          ctx.globalAlpha = 1
        }
        for (const mm of t.mins) {
          ctx.beginPath()
          ctx.arc(enCarril(mm), yb, 5, 0, Math.PI * 2)
          ctx.fillStyle = '#a78bfa'
          ctx.fill()
          ctx.lineWidth = 2
          ctx.strokeStyle = FONDO
          ctx.stroke()
        }
        // El de quien comparte, con su aro: como en la pantalla.
        const suyo = p.mias?.tiempo[t.name]
        if (m && suyo !== undefined) {
          ctx.beginPath()
          ctx.arc(enCarril(suyo), yb, 8.5, 0, Math.PI * 2)
          ctx.lineWidth = 2
          ctx.strokeStyle = AZUL_MARCA
          ctx.stroke()
        }
        // Dónde va a acabar DE VERDAD si mantiene el ritmo.
        const yendo = p.yendoA[t.name]
        if (yendo !== undefined) {
          ctx.fillStyle = '#34d399'
          ctx.fillRect(Math.round(enCarril(yendo)) - 1, yb - 9, 2, 18)
        }
        y += 52
      }
      // La escala: sin el 0 y el límite, una fila de puntos no dice nada.
      ctx.font = fuente(10)
      ctx.fillStyle = '#475569'
      ctx.textAlign = 'left'
      ctx.fillText('0', X0, y + 2)
      ctx.textAlign = 'right'
      ctx.fillText(p.limiteMin !== null ? `límite ${etiquetaDuracion(p.limiteMin)}` : etiquetaDuracion(p.techo), ANCHO - M, y + 2)
    },
  },

  rapidos: {
    alto: (d) => 38 + d.pulso.rapidos.length * 30,
    pinta: (ctx, d, y0) => listaDeBarras(ctx, d, y0, 'rapidos', d.pulso.rapidos, '#f59e0b'),
  },

  abandonos: {
    alto: (d) => 38 + d.pulso.abandonos.length * 28,
    pinta: (ctx, d, y0) => {
      let y = y0 + 26
      tituloSeccion(ctx, TITULOS_PULSO.abandonos, y)
      y += 12
      for (const a of d.pulso.abandonos) {
        const c = corredorDe(d, a.name)
        marca(ctx, M + 11, y + 11, 22, c?.emoji ?? null, c?.color ?? null)
        const rango = rangoKm(a.kms)
        ctx.textAlign = 'right'
        ctx.font = fuente(13)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText(rango, ANCHO - M, y + 16)
        let hasta = ANCHO - M - ctx.measureText(rango).width - 10
        const m = marcaDe(d, 'abandonos', a.name)
        if (m) {
          ctx.font = fuente(12, 700)
          ctx.fillStyle = AZUL_MARCA
          ctx.fillText(m, hasta, y + 16)
          hasta -= ctx.measureText(m).width + 10
        }
        ctx.textAlign = 'left'
        ctx.font = fuente(14, 700)
        ctx.fillStyle = '#f1f5f9'
        ctx.fillText(recorta(ctx, a.name, Math.max(40, hasta - (M + 30))), M + 30, y + 16)
        y += 28
      }
    },
  },
}

function altoCabecera(d: DatosPorra): number {
  return (d.foto ? ALTO_FOTO : 0) + 62 + (marcasTarjeta(d).length > 0 ? 22 : 0)
}

/** El alto que va a ocupar la tarjeta, antes de pintarla. */
export function altoPorra(d: DatosPorra): number {
  return altoCabecera(d)
    + seccionesVisibles(d.pulso).reduce((suma, s) => suma + TARJETA[s].alto(d), 0)
    + ALTO_PIE
}

/**
 * Pinta la tarjeta en un lienzo cualquiera y dice qué secciones pintó y hasta
 * dónde llegó. Va aparte de `dibujaPorra` para poder pintarla sin navegador: es
 * lo que usa el arnés.
 */
export function pintaPorra(
  ctx: CanvasRenderingContext2D, d: DatosPorra, colores: Colores,
): { secciones: SeccionPulso[]; usado: number } {
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, altoPorra(d))
  let y = 0

  // ── La foto, recortada como un "cover": se rellena el hueco y lo que sobra
  //    se va por los lados, en vez de deformar a la gente.
  if (d.foto) {
    const escala = Math.max(ANCHO / d.foto.naturalWidth, ALTO_FOTO / d.foto.naturalHeight)
    const an = d.foto.naturalWidth * escala
    const al = d.foto.naturalHeight * escala
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, ANCHO, ALTO_FOTO)
    ctx.clip()
    ctx.drawImage(d.foto, (ANCHO - an) / 2, (ALTO_FOTO - al) / 2, an, al)
    // Un degradado hacia el fondo para que el título no arranque de un corte seco.
    const grad = ctx.createLinearGradient(0, ALTO_FOTO * 0.3, 0, ALTO_FOTO)
    grad.addColorStop(0, 'rgba(11,17,32,0)')
    grad.addColorStop(1, FONDO)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, ANCHO, ALTO_FOTO)
    ctx.restore()
    y = ALTO_FOTO
  }

  y += 20
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(12, 700)
  ctx.fillStyle = '#a78bfa'
  const j = d.pulso.jugadores
  ctx.fillText(`LA PORRA · ${j} ${j === 1 ? 'JUGADOR' : 'JUGADORES'}`, M, y)
  y += 28
  ctx.font = fuente(26, 800)
  ctx.fillStyle = TINTA
  ctx.fillText(recorta(ctx, d.evento, ANCHO - M * 2), M, y)
  y += 14
  // Si va algo marcado, se dice de quién es: en el grupo nadie sabe quién la mandó.
  if (marcasTarjeta(d).length > 0) {
    y += 16
    ctx.font = fuente(12, 600)
    ctx.fillStyle = AZUL_MARCA
    ctx.fillText(recorta(ctx, `En azul, lo que dijo ${d.autor}`, ANCHO - M * 2), M, y)
    y += 6
  }

  const secciones: SeccionPulso[] = []
  for (const s of seccionesVisibles(d.pulso)) {
    TARJETA[s].pinta(ctx, d, y, colores)
    y += TARJETA[s].alto(d)
    secciones.push(s)
  }

  y += 18
  ctx.font = fuente(11)
  ctx.fillStyle = '#475569'
  ctx.textAlign = 'left'
  ctx.fillText('Ni un euro: se juega el orgullo · silosenosalgo', M, y)
  return { secciones, usado: y + ALTO_PIE - 18 }
}

/** Pinta la tarjeta y devuelve el PNG, a 1080 de ancho. */
export function dibujaPorra(d: DatosPorra, colorSi: string, colorNo: string): string {
  const alto = altoPorra(d)
  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = alto * ESCALA
  const ctx = lienzo.getContext('2d')!
  ctx.scale(ESCALA, ESCALA)
  pintaPorra(ctx, d, { si: colorSi, no: colorNo })
  return lienzo.toDataURL('image/png')
}

/** "8h 00m" para la escala; la tarjeta no depende de nadie más para escribirla. */
function etiquetaDuracion(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

/** Trae una imagen y espera a que esté lista; null si no se pudo. */
/** Un oráculo en la tarjeta del resultado. */
export interface FilaOraculo {
  nombre: string
  puesto: number
  puntos: number
  aciertos: number
  /**
   * La medalla, YA DECIDIDA por quien pinta la pantalla.
   *
   * No se calcula aquí a partir del puesto: con cero puntos no hay medalla
   * —el bronce no es un premio de asistencia— y esa regla vive en `bets.ts`
   * con sus pruebas. Calculándola otra vez, la tarjeta que se manda al grupo
   * daba un bronce a quien en la pantalla salía con un punto gris.
   */
  medalla: string
  /** Su mejor jugada, ya escrita ("clavó a Soriano: km 22"). */
  jugada: string | null
}

/**
 * La tarjeta del RESULTADO: quién ganó la porra.
 *
 * Es distinta de la del pulso, que enseña opiniones: esta enseña un marcador
 * terminado, así que el podio manda —el oro ocupa el doble que los demás— y
 * todo lo demás es fondo. Se comparte al acabar la carrera, que es cuando el
 * grupo quiere ver el estropicio.
 */
export function dibujaResultadoPorra(datos: {
  evento: string
  foto: HTMLImageElement | null
  oraculos: FilaOraculo[]
  /** Quién ganó la CARRERA, para que la tarjeta cuente las dos cosas. */
  ganador: { nombre: string; emoji: string | null; color: string | null; marca: string } | null
  /** El kilómetro más rápido, si se sabe. */
  record: { nombre: string; ritmo: string; desdeKm: number } | null
}): string {
  const { evento, foto, oraculos, ganador, record } = datos
  const ALTO_FOTO = foto ? 150 : 0
  const ALTO_PODIO = oraculos.length > 0 ? 118 : 0
  // Con qué lo ganaron: una línea por cada uno de los tres de arriba que tenga
  // algo que contar. Sin esto el podio son tres números, y lo que se discute en
  // el grupo no es el número, es quién clavó qué.
  const jugadas = oraculos.slice(0, 3).filter((o) => o.jugada && o.puntos > 0)
  const ALTO_JUGADAS = jugadas.length > 0 ? 10 + jugadas.length * 19 : 0
  const RESTO = Math.max(0, oraculos.length - 3)
  const ALTO_RESTO = RESTO > 0 ? 14 + RESTO * 30 : 0
  const ALTO_CARRERA = (ganador ? 56 : 0) + (record ? 44 : 0)
  const alto = ALTO_FOTO + 22 + 58 + ALTO_PODIO + ALTO_JUGADAS + ALTO_RESTO + ALTO_CARRERA + 34

  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = alto * ESCALA
  const ctx = lienzo.getContext('2d')!
  ctx.scale(ESCALA, ESCALA)
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  let y = 0
  if (foto) {
    // Recortada al ancho y oscurecida por abajo, para que el título se lea
    // encima sin una banda negra que parta la tarjeta.
    const escala = Math.max(ANCHO / foto.width, ALTO_FOTO / foto.height)
    const an = foto.width * escala, al = foto.height * escala
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, ANCHO, ALTO_FOTO); ctx.clip()
    ctx.drawImage(foto, (ANCHO - an) / 2, (ALTO_FOTO - al) / 2, an, al)
    const velo = ctx.createLinearGradient(0, ALTO_FOTO * 0.35, 0, ALTO_FOTO)
    velo.addColorStop(0, 'rgba(11,17,32,0)')
    velo.addColorStop(1, FONDO)
    ctx.fillStyle = velo
    ctx.fillRect(0, 0, ANCHO, ALTO_FOTO)
    ctx.restore()
    y = ALTO_FOTO
  }

  y += 22
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(13, 700)
  ctx.fillStyle = '#fbbf24'
  ctx.fillText('🔮  LA PORRA, RESUELTA', ANCHO / 2, y)
  y += 26
  ctx.font = fuente(24, 800)
  ctx.fillStyle = TINTA
  ctx.fillText(recorta(ctx, evento, ANCHO - 48), ANCHO / 2, y)
  y += 26

  // ── El podio ──────────────────────────────────────────────────────────
  const podio = oraculos.slice(0, 3)
  if (podio.length > 0) {
    const M = 20
    const AN = (ANCHO - M * 2 - 16) / 3
    // El oro en medio y más alto, como en un podio de verdad: el orden de
    // lectura da igual cuando la forma ya dice quién ganó.
    const sitios = podio.length === 1 ? [0] : podio.length === 2 ? [0, 1] : [1, 0, 2]
    podio.forEach((o, i) => {
      const col = sitios[i]
      const x = M + col * (AN + 8)
      const oro = o.puesto === 0 && o.puntos > 0
      // Las medidas van una debajo de otra a mano, así que se escriben aquí
      // juntas: la medalla, el nombre, el número y la palabra. Antes el número
      // y la palabra estaban a seis píxeles —con el número a 24— y se pisaban;
      // se veía solo en la imagen compartida, porque en pantalla lo coloca el
      // navegador y aquí lo colocamos nosotros.
      const alturaCaja = oro ? 104 : 90
      const cajaY = y + (oro ? 0 : 18)
      const yMedalla = cajaY + (oro ? 34 : 30)
      const yNombre = cajaY + (oro ? 58 : 50)
      const yPuntos = cajaY + (oro ? 88 : 76)
      const yPalabra = cajaY + (oro ? 100 : 87)
      pastilla(ctx, x, cajaY, AN, alturaCaja, 14,
        oro ? 'rgba(251,191,36,0.12)' : 'rgba(30,41,59,0.6)',
        oro ? '#f59e0b' : '#1e293b')
      ctx.textAlign = 'center'
      /**
       * La medalla, sobre un disco oscuro.
       *
       * Sin él se difumina: la bola de cristal es morada oscura y el relleno
       * ámbar de la caja del ganador aclara justo el fondo que tiene detrás, así
       * que el icono que corona la tarjeta era lo que peor se veía de ella. El
       * disco le devuelve el fondo oscuro de la tarjeta y el aro lo remata.
       */
      // Sin medalla no hay disco: un aro vacío alrededor de un punto gris
      // parece un hueco donde faltaba algo.
      if (o.medalla !== '·') {
        ctx.beginPath()
        ctx.arc(x + AN / 2, yMedalla - (oro ? 9 : 7), oro ? 19 : 15, 0, Math.PI * 2)
        ctx.fillStyle = FONDO
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = oro ? '#f59e0b' : '#334155'
        ctx.stroke()
      }
      ctx.font = fuente(oro ? 26 : 20)
      ctx.fillStyle = TINTA
      ctx.fillText(o.medalla, x + AN / 2, yMedalla)
      ctx.font = fuente(oro ? 15 : 13, 700)
      ctx.fillStyle = TINTA
      ctx.fillText(recorta(ctx, o.nombre, AN - 12), x + AN / 2, yNombre)
      ctx.font = fuente(oro ? 30 : 24, 900)
      ctx.fillStyle = oro ? '#fbbf24' : TINTA
      ctx.fillText(String(o.puntos), x + AN / 2, yPuntos)
      ctx.font = fuente(9, 600)
      ctx.fillStyle = TINTA_MUY_FLOJA
      ctx.fillText('PUNTOS', x + AN / 2, yPalabra)
    })
    y += ALTO_PODIO
  }

  // ── En qué acertó cada uno del podio ──────────────────────────────────
  if (jugadas.length > 0) {
    y += 10
    for (const o of jugadas) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = fuente(12)
      ctx.fillText(o.medalla, 22, y + 6)
      ctx.font = fuente(11, 700)
      ctx.fillStyle = TINTA
      const nombre = recorta(ctx, o.nombre, 110)
      ctx.fillText(nombre, 40, y + 6)
      const dx = 40 + ctx.measureText(nombre).width + 6
      ctx.font = fuente(11)
      ctx.fillStyle = TINTA_FLOJA
      ctx.fillText(recorta(ctx, o.jugada ?? '', ANCHO - dx - 22), dx, y + 6)
      ctx.textBaseline = 'alphabetic'
      y += 19
    }
  }

  // ── Y los demás, en una línea cada uno ────────────────────────────────
  if (RESTO > 0) {
    y += 14
    for (const o of oraculos.slice(3)) {
      ctx.textAlign = 'left'
      ctx.font = fuente(12, 600)
      ctx.fillStyle = TINTA_FLOJA
      ctx.fillText(`${o.puesto + 1}.`, 22, y + 8)
      ctx.fillStyle = TINTA
      ctx.fillText(recorta(ctx, o.nombre, ANCHO - 120), 46, y + 8)
      ctx.textAlign = 'right'
      ctx.font = fuente(13, 800)
      ctx.fillText(String(o.puntos), ANCHO - 22, y + 8)
      y += 30
    }
  }

  // ── Lo que pasó en la carrera ─────────────────────────────────────────
  if (ganador) {
    y += 14
    pastilla(ctx, 20, y, ANCHO - 40, 42, 12, 'rgba(30,41,59,0.5)', '#1e293b')
    marca(ctx, 44, y + 21, 26, ganador.emoji, ganador.color)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = fuente(13, 700)
    ctx.fillStyle = TINTA
    ctx.fillText(recorta(ctx, `🏁 ${ganador.nombre}`, ANCHO - 200), 64, y + 21)
    ctx.textAlign = 'right'
    ctx.font = fuente(12, 600)
    ctx.fillStyle = TINTA_FLOJA
    ctx.fillText(ganador.marca, ANCHO - 34, y + 21)
    ctx.textBaseline = 'alphabetic'
    y += 56 - 14
  }
  if (record) {
    y += 14
    ctx.textAlign = 'center'
    ctx.font = fuente(12, 600)
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(
      `⚡ Kilómetro más rápido: ${record.ritmo} — ${record.nombre}, desde el km ${record.desdeKm.toFixed(1)}`,
      ANCHO / 2, y + 14,
    )
    y += 44 - 14
  }

  ctx.textAlign = 'center'
  ctx.font = fuente(11, 600)
  ctx.fillStyle = TINTA_MUY_FLOJA
  ctx.fillText('silosenosalgo.com', ANCHO / 2, alto - 14)
  return lienzo.toDataURL('image/png')
}

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
