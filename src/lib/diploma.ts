/**
 * El DIPLOMA de quien acabó la carrera, como imagen para guardar o mandar.
 *
 * Se pinta en un lienzo, como la tarjeta de la porra, y por lo mismo: una
 * imagen es lo que se comparte en un grupo o se guarda en el carrete, y no
 * necesita que quien la recibe tenga nada instalado.
 *
 * Lo que cuenta, de arriba abajo: la carrera (foto, nombre, día, distancia y
 * desnivel), quién —su marca, su nombre y su dorsal—, el TIEMPO en grande y de
 * dónde sale (oficial de la organización, o del GPS con su margen, o de un paso
 * anotado a mano), y tres números: el puesto, el ritmo y la hora de llegada.
 * Abajo, el perfil del recorrido: es lo que dice lo que costó.
 */

import { eventColorHex } from '../../shared/eventColors'

const ANCHO = 540
const ALTO = 840
const ESCALA = 2
const FONDO = '#0b1120'
const TINTA = '#f8fafc'
const FLOJA = '#94a3b8'
const MUY_FLOJA = '#64748b'
const ORO = '#fbbf24'
const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const fuente = (px: number, peso = 400, estilo = '') => `${estilo} ${peso} ${px}px ${FUENTE}`.trim()

export interface DatosDiploma {
  evento: string
  foto: HTMLImageElement | null
  /** Día de la carrera (epoch ms): la salida oficial, o la llegada. */
  dia: number | null
  km: number | null
  desnivelM: number | null
  corredor: { nombre: string; emoji: string | null; color: string | null; dorsal: string | null }
  /** El tiempo ya escrito ("13h 17m 04s") y de dónde sale. */
  tiempo: string
  fuenteTiempo: string
  puesto: number | null
  llegados: number
  ritmo: string | null
  /** La hora de llegada ya escrita ("19:17:04"). */
  llegada: string | null
  /** Las alturas del recorrido, en orden y repartidas por distancia, para el perfil. */
  perfil: number[] | null
  /** Los puntos de paso, como fracción del recorrido (0–1): se marcan en el perfil, como en el dorsal. */
  pasos?: number[]
}

function recorta(ctx: CanvasRenderingContext2D, texto: string, max: number): string {
  if (ctx.measureText(texto).width <= max) return texto
  let t = texto
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

function caja(ctx: CanvasRenderingContext2D, x: number, y: number, an: number, al: number, r: number, relleno?: string, borde?: string) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, an, al, r)
  else ctx.rect(x, y, an, al)
  if (relleno) { ctx.fillStyle = relleno; ctx.fill() }
  if (borde) { ctx.strokeStyle = borde; ctx.lineWidth = 1; ctx.stroke() }
}

/** El diploma, como PNG en data URL. */
export function dibujaDiploma(d: DatosDiploma): string {
  const lienzo = document.createElement('canvas')
  lienzo.width = ANCHO * ESCALA
  lienzo.height = ALTO * ESCALA
  const ctx = lienzo.getContext('2d')!
  ctx.scale(ESCALA, ESCALA)
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, ALTO)

  // ── La foto, arriba, fundida con el fondo ─────────────────────────────
  const ALTO_FOTO = d.foto ? 170 : 0
  if (d.foto) {
    const esc = Math.max(ANCHO / d.foto.width, ALTO_FOTO / d.foto.height)
    const an = d.foto.width * esc, al = d.foto.height * esc
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, ANCHO, ALTO_FOTO); ctx.clip()
    ctx.drawImage(d.foto, (ANCHO - an) / 2, (ALTO_FOTO - al) / 2, an, al)
    const velo = ctx.createLinearGradient(0, ALTO_FOTO * 0.3, 0, ALTO_FOTO)
    velo.addColorStop(0, 'rgba(11,17,32,0)')
    velo.addColorStop(1, FONDO)
    ctx.fillStyle = velo
    ctx.fillRect(0, 0, ANCHO, ALTO_FOTO)
    ctx.restore()
  }

  // ── El marco: dos filetes dorados, como un diploma de papel ────────────
  ctx.strokeStyle = 'rgba(251,191,36,0.55)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(12, 12, ANCHO - 24, ALTO - 24)
  ctx.strokeStyle = 'rgba(251,191,36,0.25)'
  ctx.lineWidth = 1
  ctx.strokeRect(18, 18, ANCHO - 36, ALTO - 36)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let y = Math.max(ALTO_FOTO, 30) + 26

  ctx.font = fuente(13, 800)
  ctx.fillStyle = ORO
  ctx.fillText('D I P L O M A   ·   F I N I S H E R', ANCHO / 2, y)
  y += 32
  ctx.font = fuente(26, 800)
  ctx.fillStyle = TINTA
  ctx.fillText(recorta(ctx, d.evento, ANCHO - 70), ANCHO / 2, y)
  y += 22
  const datos = [
    d.dia != null ? new Date(d.dia).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
    d.km != null ? `${d.km.toFixed(1)} km` : null,
    d.desnivelM != null && d.desnivelM > 0 ? `↑${Math.round(d.desnivelM).toLocaleString('es-ES')} m` : null,
  ].filter(Boolean).join('  ·  ')
  ctx.font = fuente(13, 500)
  ctx.fillStyle = FLOJA
  ctx.fillText(datos, ANCHO / 2, y)

  // Un adorno entre la carrera y la persona.
  y += 22
  ctx.strokeStyle = 'rgba(251,191,36,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(ANCHO / 2 - 90, y); ctx.lineTo(ANCHO / 2 - 12, y); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(ANCHO / 2 + 12, y); ctx.lineTo(ANCHO / 2 + 90, y); ctx.stroke()
  ctx.fillStyle = ORO
  ctx.beginPath()
  ctx.moveTo(ANCHO / 2, y - 4); ctx.lineTo(ANCHO / 2 + 4, y); ctx.lineTo(ANCHO / 2, y + 4); ctx.lineTo(ANCHO / 2 - 4, y)
  ctx.closePath(); ctx.fill()

  y += 28
  ctx.font = fuente(13, 400, 'italic')
  ctx.fillStyle = FLOJA
  ctx.fillText('Se certifica que', ANCHO / 2, y)

  // ── Quién: su marca, su nombre y su dorsal ─────────────────────────────
  y += 44
  const hex = d.corredor.color ? eventColorHex(d.corredor.color) : '#94a3b8'
  ctx.font = fuente(32, 800)
  const nombre = recorta(ctx, d.corredor.nombre, ANCHO - 170)
  const anNombre = ctx.measureText(nombre).width
  const TAM = 46
  const hueco = 12
  const x0 = ANCHO / 2 - (TAM + hueco + anNombre) / 2
  ctx.beginPath()
  ctx.arc(x0 + TAM / 2, y - 11, TAM / 2, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'; ctx.fill()
  ctx.lineWidth = 3; ctx.strokeStyle = hex; ctx.stroke()
  if (d.corredor.emoji) {
    ctx.font = fuente(25)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = TINTA
    ctx.fillText(d.corredor.emoji, x0 + TAM / 2, y - 10)
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.font = fuente(32, 800)
  ctx.fillStyle = TINTA
  ctx.fillText(nombre, x0 + TAM + hueco, y)
  ctx.textAlign = 'center'
  // EL DORSAL, como el de la carrera: papel blanco, los cuatro agujeros del
  // imperdible, la carrera impresa arriba en pequeño y el número en grande.
  // Es lo que se lleva puesto ese día, y lo que más dice "yo estuve ahí".
  if (d.corredor.dorsal) {
    y += 18
    const AN = 250, AL = 96
    const x = ANCHO / 2 - AN / 2
    const papel = ctx.createLinearGradient(0, y, 0, y + AL)
    papel.addColorStop(0, '#ffffff')
    papel.addColorStop(1, '#f1f0ec')
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2
    caja(ctx, x, y, AN, AL, 6, '#ffffff')
    ctx.restore()
    caja(ctx, x, y, AN, AL, 6, undefined, undefined)
    ctx.fillStyle = papel; ctx.fill()
    ctx.fillStyle = 'rgba(11,17,32,0.3)'
    for (const [hx, hy] of [[x + 9, y + 9], [x + AN - 9, y + 9], [x + 9, y + AL - 9], [x + AN - 9, y + AL - 9]]) {
      ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill()
    }
    ctx.font = fuente(9, 800)
    ctx.fillStyle = '#475569'
    ctx.fillText(recorta(ctx, d.evento.toUpperCase(), AN - 40), ANCHO / 2, y + 19)
    ctx.font = fuente(52, 900)
    ctx.fillStyle = '#0b1120'
    ctx.fillText(recorta(ctx, d.corredor.dorsal, AN - 30), ANCHO / 2, y + 70)
    // La franja del color del corredor al pie del papel, como la de su categoría.
    ctx.fillStyle = hex
    ctx.fillRect(x + 20, y + AL - 12, AN - 40, 4)
    y += AL
  }

  y += 32
  ctx.font = fuente(13, 400, 'italic')
  ctx.fillStyle = FLOJA
  ctx.fillText('ha completado la carrera en', ANCHO / 2, y)

  // ── El tiempo ─────────────────────────────────────────────────────────
  y += 52
  ctx.font = fuente(46, 900)
  ctx.fillStyle = '#6ee7b7'
  ctx.fillText(d.tiempo, ANCHO / 2, y)
  y += 22
  ctx.font = fuente(11, 700)
  ctx.fillStyle = d.fuenteTiempo === 'TIEMPO OFICIAL' ? ORO : MUY_FLOJA
  ctx.fillText(d.fuenteTiempo, ANCHO / 2, y)

  // ── Tres números ──────────────────────────────────────────────────────
  y += 22
  const celdas = [
    { v: d.puesto != null ? `${d.puesto}º` : '—', e: d.llegados > 0 ? `PUESTO DE ${d.llegados}` : 'PUESTO' },
    { v: d.ritmo ?? '—', e: 'RITMO /KM' },
    { v: d.llegada ?? '—', e: 'LLEGADA' },
  ]
  const M = 44, SEP = 10
  const AN = (ANCHO - M * 2 - SEP * 2) / 3
  celdas.forEach((c, i) => {
    const x = M + i * (AN + SEP)
    caja(ctx, x, y, AN, 58, 10, 'rgba(15,23,42,0.9)', 'rgba(51,65,85,0.9)')
    ctx.font = fuente(20, 800)
    ctx.fillStyle = TINTA
    ctx.fillText(recorta(ctx, c.v, AN - 12), x + AN / 2, y + 28)
    ctx.font = fuente(9, 700)
    ctx.fillStyle = MUY_FLOJA
    ctx.fillText(c.e, x + AN / 2, y + 46)
  })
  y += 58

  // ── El perfil del recorrido, al pie ───────────────────────────────────
  const perfil = d.perfil && d.perfil.length > 1 ? d.perfil : null
  const PIE = 44
  if (perfil) {
    const top = y + 20
    const base = ALTO - PIE
    const alto = base - top
    if (alto > 30) {
      let min = Infinity, max = -Infinity
      for (const e of perfil) { if (e < min) min = e; if (e > max) max = e }
      const rango = Math.max(1, max - min)
      const x = (i: number) => 34 + (i / (perfil.length - 1)) * (ANCHO - 84)
      const yy = (e: number) => base - 4 - ((e - min) / rango) * (alto - 8)
      ctx.beginPath()
      ctx.moveTo(x(0), base)
      perfil.forEach((e, i) => ctx.lineTo(x(i), yy(e)))
      ctx.lineTo(x(perfil.length - 1), base)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, top, 0, base)
      grad.addColorStop(0, 'rgba(251,191,36,0.35)')
      grad.addColorStop(1, 'rgba(251,191,36,0.03)')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.beginPath()
      perfil.forEach((e, i) => (i === 0 ? ctx.moveTo(x(i), yy(e)) : ctx.lineTo(x(i), yy(e))))
      ctx.strokeStyle = 'rgba(251,191,36,0.8)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // Los puntos de paso, como en el dorsal: un punto sobre la línea.
      for (const f of d.pasos ?? []) {
        // El de la meta no: ahí va la bandera.
        if (!(f > 0 && f < 0.985)) continue
        const i = Math.round(f * (perfil.length - 1))
        ctx.beginPath()
        ctx.arc(x(i), yy(perfil[i]), 2.6, 0, Math.PI * 2)
        ctx.fillStyle = FONDO; ctx.fill()
        ctx.lineWidth = 1.5; ctx.strokeStyle = ORO; ctx.stroke()
      }
      // La meta, al final del perfil.
      // Dibujada y no un emoji: el emoji no se deja anclar al punto exacto y
      // quedaba torcido encima del último paso. Un mástil que sale del final
      // del perfil y una bandera de cuadros ondeando hacia fuera.
      const fx = x(perfil.length - 1), fy = yy(perfil[perfil.length - 1])
      const MASTIL = 22, AN = 14, AL = 10, C = 3.5
      ctx.strokeStyle = TINTA; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - MASTIL); ctx.stroke()
      for (let fi = 0; fi < AL / C; fi++) {
        for (let co = 0; co < AN / C; co++) {
          ctx.fillStyle = (fi + co) % 2 === 0 ? TINTA : '#0f172a'
          ctx.fillRect(fx + co * C, fy - MASTIL + fi * C, C, C)
        }
      }
      ctx.strokeStyle = 'rgba(248,250,252,0.6)'; ctx.lineWidth = 0.5
      ctx.strokeRect(fx, fy - MASTIL, AN, AL)
      ctx.beginPath(); ctx.arc(fx, fy, 2.6, 0, Math.PI * 2); ctx.fillStyle = ORO; ctx.fill()
    }
  }

  ctx.font = fuente(11, 600)
  ctx.fillStyle = MUY_FLOJA
  ctx.fillText('silosenosalgo.com', ANCHO / 2, ALTO - 24)
  return lienzo.toDataURL('image/png')
}

/** Unas pocas alturas del recorrido, repartidas por distancia: para el perfil del pie. */
export function perfilParaDiploma(track: { points: { ele: number }[]; cumKm: number[] } | null | undefined, n = 160): number[] | null {
  if (!track || track.points.length < 2 || track.cumKm.length !== track.points.length) return null
  const total = track.cumKm[track.cumKm.length - 1]
  if (!(total > 0)) return null
  const out: number[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const km = (k / (n - 1)) * total
    while (j + 1 < track.cumKm.length && track.cumKm[j + 1] < km) j++
    out.push(track.points[j].ele)
  }
  return out
}
