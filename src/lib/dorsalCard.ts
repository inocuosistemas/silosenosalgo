import { eventColorHex } from '../../shared/eventColors'

/**
 * El dorsal dibujado en un lienzo, para mandarlo al grupo.
 *
 * Misma decisión que la porra (ver `porraCard.ts`): no se fotografía la
 * pantalla, se dibuja. Aquí además es lo natural — el dorsal de la pantalla
 * está hecho para caber en 280 px de móvil, y lo que se manda al grupo tiene
 * que leerse sin ampliar—. Se dibuja a 540 de ancho y se guarda al doble.
 *
 * A diferencia de la porra, el papel ocupa la imagen entera: lo que se comparte
 * es el dorsal, no una tarjeta con un dorsal dentro.
 */

const ANCHO = 540
const ESCALA = 2
const TINTA = '#0b1120'
const TINTA_FLOJA = '#5b6472'
const TINTA_MUY_FLOJA = '#7b8290'

const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const fuente = (px: number, peso = 400) => `${peso} ${px}px ${FUENTE}`

export interface DatosDorsal {
  /** El número, tal cual lo lleva puesto. */
  bib: string
  nombre: string
  emoji: string | null
  color: string | null
  /** La carrera: nombre, distancia y desnivel para la cabecera. */
  carrera: string
  km: number | null
  desnivelM: number | null
  /** Salida y cierre de meta (epoch ms), si la carrera los tiene. */
  salida: number | null
  cierre: number | null
  /** El perfil, ya muestreado: pares de kilómetro y altitud. */
  perfil: { km: number; ele: number }[]
  /** Los pasos que se marcan sobre el perfil, con su corte escrito. */
  puntos: { nombre: string; km: number; cierre: string | null }[]
  /** Lo que le da la porra ("29h 00m – 33h 00m"), o null. */
  porra: string | null
}

/** "99 km", "42,2 km": el decimal solo cuando dice algo. Una carrera se anuncia
 *  por sus kilómetros redondos, y un dorsal la nombra como se anuncia. */
const etiquetaKm = (km: number) => {
  const uno = Math.round(km * 10) / 10
  return Number.isInteger(uno) ? `${uno.toFixed(0)} km` : `${uno.toFixed(1).replace('.', ',')} km`
}

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const dia = (ms: number) =>
  new Date(ms).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

/** Texto recortado con puntos suspensivos si no cabe en `max`. */
function recorta(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto
  let corto = texto
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > max) corto = corto.slice(0, -1)
  return `${corto}…`
}

/** El tamaño de letra más grande con el que `texto` cabe en `max`. */
function cabe(ctx: CanvasRenderingContext2D, texto: string, max: number, desde: number, peso: number): number {
  let px = desde
  while (px > 10) {
    ctx.font = fuente(px, peso)
    if (ctx.measureText(texto).width <= max) break
    px -= 2
  }
  return px
}

/**
 * Pinta el dorsal y devuelve el PNG.
 *
 * El alto no es fijo: una carrera sin recorrido publicado no tiene perfil que
 * dibujar, y el dorsal se queda más corto en vez de dejar un hueco en blanco.
 */
export function dibujaDorsal(d: DatosDorsal): string {
  const M = 40                                   // margen lateral del impreso
  const ANCHO_UTIL = ANCHO - M * 2
  const hayPerfil = d.perfil.length > 1

  const ALTO_CABEZA = 132
  const ALTO_NUMERO = 208
  const ALTO_CORREDOR = 66
  const ALTO_PERFIL = hayPerfil ? 148 : 0
  const ALTO_BANDA = 46
  const ALTO_PIE = 34
  const alto = ALTO_CABEZA + ALTO_NUMERO + ALTO_CORREDOR + ALTO_PERFIL + ALTO_BANDA + ALTO_PIE

  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = alto * ESCALA
  const ctx = lienzo.getContext('2d')!
  ctx.scale(ESCALA, ESCALA)

  // ── El papel ───────────────────────────────────────────────────────────
  const papel = ctx.createLinearGradient(0, 0, ANCHO * 0.3, alto)
  papel.addColorStop(0, '#ffffff')
  papel.addColorStop(0.55, '#fbfaf7')
  papel.addColorStop(1, '#efece5')
  ctx.fillStyle = papel
  ctx.fillRect(0, 0, ANCHO, alto)

  // Los cuatro agujeros del imperdible, que es lo que lo hace un dorsal y no
  // una tarjeta blanca.
  ctx.fillStyle = 'rgba(11,17,32,.16)'
  for (const [x, y] of [[30, 30], [ANCHO - 30, 30], [30, alto - 30], [ANCHO - 30, alto - 30]]) {
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  let y = 0

  // ── La prueba ──────────────────────────────────────────────────────────
  y += 62
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const nombreCarrera = d.carrera.toUpperCase()
  ctx.font = fuente(cabe(ctx, nombreCarrera, ANCHO_UTIL, 40, 900), 900)
  ctx.fillStyle = TINTA
  ctx.fillText(nombreCarrera, ANCHO / 2, y)
  y += 26
  const modalidad = [
    d.km != null ? etiquetaKm(d.km) : null,
    d.desnivelM ? `${d.desnivelM.toLocaleString('es-ES')} m D+` : null,
  ].filter(Boolean).join('   ·   ')
  if (modalidad) {
    ctx.font = fuente(15, 600)
    ctx.fillStyle = TINTA_FLOJA
    ctx.fillText(modalidad, ANCHO / 2, y)
  }
  y += 22
  ctx.strokeStyle = 'rgba(11,17,32,.13)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(ANCHO - M, y)
  ctx.stroke()

  // ── El número ──────────────────────────────────────────────────────────
  //
  // Lo que de verdad es un dorsal. Se escribe tan grande como quepa: un 7 llena
  // el papel y un "A-1234" se estrecha, igual que en el impreso de verdad.
  y = ALTO_CABEZA + ALTO_NUMERO - 46
  ctx.font = fuente(cabe(ctx, d.bib, ANCHO_UTIL, 190, 900), 900)
  ctx.fillStyle = TINTA
  ctx.fillText(d.bib, ANCHO / 2, y)

  // ── El corredor ────────────────────────────────────────────────────────
  y = ALTO_CABEZA + ALTO_NUMERO + 40
  const hex = d.color ? eventColorHex(d.color) : '#94a3b8'
  ctx.font = fuente(cabe(ctx, d.nombre.toUpperCase(), ANCHO_UTIL - 70, 34, 800), 800)
  const anchoNombre = ctx.measureText(d.nombre.toUpperCase()).width
  const xAro = (ANCHO - (anchoNombre + 52)) / 2 + 20
  ctx.beginPath()
  ctx.arc(xAro, y - 10, 20, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = hex
  ctx.stroke()
  if (d.emoji) {
    ctx.font = fuente(22)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(d.emoji, xAro, y - 9)
    ctx.textBaseline = 'alphabetic'
  }
  ctx.textAlign = 'left'
  ctx.font = fuente(cabe(ctx, d.nombre.toUpperCase(), ANCHO_UTIL - 70, 34, 800), 800)
  ctx.fillStyle = TINTA
  ctx.fillText(recorta(ctx, d.nombre.toUpperCase(), ANCHO_UTIL - 70), xAro + 32, y)

  // ── El perfil ──────────────────────────────────────────────────────────
  //
  // Lo que se mira de reojo en carrera: cuánto queda por subir. Va con sus
  // pasos marcados, que son los sitios que se nombran ese día.
  if (hayPerfil) {
    const yTop = ALTO_CABEZA + ALTO_NUMERO + ALTO_CORREDOR + 12
    const ALTO_TRAZO = 78
    const kmMax = d.perfil[d.perfil.length - 1].km || 1
    let min = Infinity, max = -Infinity
    for (const p of d.perfil) { if (p.ele < min) min = p.ele; if (p.ele > max) max = p.ele }
    // Un recorrido llano no se dibuja como una sierra: sin rango, la línea sale
    // recta por el medio, que es la verdad de ese recorrido.
    const rango = max - min > 5 ? max - min : 1
    const px = (km: number) => M + (km / kmMax) * ANCHO_UTIL
    const py = (ele: number) => yTop + ALTO_TRAZO - ((ele - min) / rango) * (ALTO_TRAZO - 6) - 3

    ctx.beginPath()
    ctx.moveTo(M, yTop + ALTO_TRAZO)
    for (const p of d.perfil) ctx.lineTo(px(p.km), py(p.ele))
    ctx.lineTo(ANCHO - M, yTop + ALTO_TRAZO)
    ctx.closePath()
    ctx.fillStyle = 'rgba(11,17,32,.13)'
    ctx.fill()

    ctx.beginPath()
    d.perfil.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.km), py(p.ele)) : ctx.lineTo(px(p.km), py(p.ele))))
    ctx.strokeStyle = TINTA
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Con muchos pasos se marcan solo los que tienen corte: en un dedo de papel
    // cuarenta rayas son una valla, no un perfil.
    const conCorte = d.puntos.filter((p) => p.cierre !== null)
    const marcas = d.puntos.length > 14 && conCorte.length > 0 ? conCorte : d.puntos
    const eleEn = (km: number) => {
      let mejor = d.perfil[0]
      for (const p of d.perfil) if (Math.abs(p.km - km) < Math.abs(mejor.km - km)) mejor = p
      return mejor.ele
    }
    for (const p of marcas) {
      const x = px(p.km)
      const yp = py(eleEn(p.km))
      ctx.beginPath()
      ctx.moveTo(x, yp)
      ctx.lineTo(x, yTop + ALTO_TRAZO)
      ctx.strokeStyle = 'rgba(11,17,32,.28)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, yp, 3, 0, Math.PI * 2)
      ctx.fillStyle = TINTA
      ctx.fill()
    }

    // Los hitos: salida, el corte de media carrera y meta. Los tres que se
    // miran antes de salir.
    const medio = d.km
      ? conCorte.reduce<typeof conCorte[number] | null>((mejor, p) => {
        if (p.km >= d.km! * 0.9) return mejor
        const dist = Math.abs(p.km - d.km! / 2)
        return mejor === null || dist < Math.abs(mejor.km - d.km! / 2) ? p : mejor
      }, null)
      : null
    const yh = yTop + ALTO_TRAZO + 26
    const hitos: [string, string, CanvasTextAlign, number][] = [
      ['SALIDA', d.salida ? hora(d.salida) : 'km 0', 'left', M],
      [
        medio ? `${medio.nombre.toUpperCase()} · KM ${medio.km.toFixed(0)}` : '',
        medio ? `cierre ${medio.cierre}` : '',
        'center', ANCHO / 2,
      ],
      [
        d.km != null ? `META · KM ${d.km.toFixed(0)}` : 'META',
        d.cierre ? `cierre ${hora(d.cierre)}` : '—',
        'right', ANCHO - M,
      ],
    ]
    for (const [arriba, abajo, align, x] of hitos) {
      if (!arriba) continue
      ctx.textAlign = align
      ctx.font = fuente(10, 600)
      ctx.fillStyle = TINTA_MUY_FLOJA
      ctx.fillText(recorta(ctx, arriba, ANCHO_UTIL / 3 - 6), x, yh)
      ctx.font = fuente(13, 800)
      ctx.fillStyle = TINTA
      ctx.fillText(abajo, x, yh + 16)
    }
  }

  // ── La banda de su color ───────────────────────────────────────────────
  const yBanda = alto - ALTO_BANDA - ALTO_PIE
  ctx.fillStyle = hex
  ctx.fillRect(0, yBanda, ANCHO, ALTO_BANDA)
  ctx.fillStyle = TINTA
  ctx.font = fuente(13, 800)
  ctx.textAlign = 'left'
  ctx.fillText(
    d.salida ? `${dia(d.salida).toUpperCase()} · SALIDA ${hora(d.salida)}` : 'SIN HORA DE SALIDA',
    M, yBanda + 29,
  )
  if (d.porra) {
    ctx.textAlign = 'right'
    ctx.fillText(`LA PORRA: ${d.porra}`, ANCHO - M, yBanda + 29)
  }

  // ── La letra pequeña de todos los dorsales ─────────────────────────────
  const yPie = alto - 13
  ctx.font = fuente(10, 600)
  ctx.fillStyle = TINTA_MUY_FLOJA
  ctx.textAlign = 'left'
  ctx.fillText('EMERGENCIAS 112', M, yPie)
  ctx.textAlign = 'center'
  ctx.fillText('DORSAL VISIBLE', ANCHO / 2, yPie)
  ctx.textAlign = 'right'
  ctx.fillText('SILOSENOSALGO', ANCHO - M, yPie)

  return lienzo.toDataURL('image/png')
}
