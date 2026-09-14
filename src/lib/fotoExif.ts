/**
 * Dónde y cuándo se hizo una foto, leído de su EXIF.
 *
 * Una foto hecha con la ubicación activada lleva sus coordenadas dentro: es la
 * forma buena de ponerla en el mapa, porque dice dónde se HIZO y no dónde se
 * sube, que puede ser en el coche de vuelta. Hay que leerlo del fichero original
 * ANTES de comprimirlo: al redibujarla en un lienzo el EXIF se pierde.
 *
 * Solo JPEG, que es lo que entregan los móviles al elegir una foto desde la web
 * (el iPhone convierte sus HEIC al subirlas). Sin EXIF, o si algo no cuadra, se
 * devuelve todo a null: la foto se coloca con otra fuente, no se rompe nada.
 */

export interface DatosExif {
  lat: number | null
  lon: number | null
  /** Cuándo se hizo, epoch ms. */
  tomadaEn: number | null
}

const NADA: DatosExif = { lat: null, lon: null, tomadaEn: null }

export function leeExif(buf: ArrayBuffer): DatosExif {
  try {
    const v = new DataView(buf)
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return NADA
    let o = 2
    while (o + 4 <= v.byteLength) {
      if (v.getUint8(o) !== 0xff) return NADA
      const marca = v.getUint8(o + 1)
      const largo = v.getUint16(o + 2)
      if (marca === 0xe1 && texto(v, o + 4, 6) === 'Exif\0\0') return leeTiff(v, o + 10)
      // Empieza la imagen: ya no quedan cabeceras.
      if (marca === 0xda) return NADA
      o += 2 + largo
    }
    return NADA
  } catch {
    return NADA
  }
}

function texto(v: DataView, desde: number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(desde + i))
  return s
}

function leeTiff(v: DataView, base: number): DatosExif {
  const le = v.getUint16(base) === 0x4949
  const u16 = (p: number) => v.getUint16(base + p, le)
  const u32 = (p: number) => v.getUint32(base + p, le)
  if (u16(2) !== 42) return NADA

  /** Las entradas de un IFD, por etiqueta: posición de cada una. */
  const entradas = (ifd: number): Map<number, number> => {
    const out = new Map<number, number>()
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      out.set(u16(e), e)
    }
    return out
  }
  /** Dónde están los datos de una entrada: dentro de ella si caben en 4 bytes. */
  const datos = (e: number, bytes: number) => (bytes <= 4 ? e + 8 : u32(e + 8))
  const ascii = (e: number) => {
    const n = u32(e + 4)
    return texto(v, base + datos(e, n), n).replace(/\0+$/, '')
  }
  const racionales = (e: number) => {
    const n = u32(e + 4)
    const d = datos(e, n * 8)
    return Array.from({ length: n }, (_, i) => {
      const den = u32(d + i * 8 + 4)
      return den === 0 ? NaN : u32(d + i * 8) / den
    })
  }

  const ifd0 = entradas(u32(4))
  let lat: number | null = null
  let lon: number | null = null
  let tomadaEn: number | null = null

  const gps = ifd0.get(0x8825)
  if (gps !== undefined) {
    const g = entradas(u32(gps + 8))
    const grados = (valor: number | undefined, ref: number | undefined, negativo: string) => {
      if (valor === undefined || ref === undefined) return null
      const [d, m, s] = racionales(valor)
      const x = d + (m ?? 0) / 60 + (s ?? 0) / 3600
      if (!Number.isFinite(x)) return null
      return ascii(ref).toUpperCase() === negativo ? -x : x
    }
    lat = grados(g.get(0x0002), g.get(0x0001), 'S')
    lon = grados(g.get(0x0004), g.get(0x0003), 'W')
    if (lat !== null && (Math.abs(lat) > 90 || (lat === 0 && lon === 0))) { lat = null; lon = null }
    if (lon !== null && Math.abs(lon) > 180) { lat = null; lon = null }
  }

  const exif = ifd0.get(0x8769)
  if (exif !== undefined) {
    const x = entradas(u32(exif + 8))
    const original = x.get(0x9003)
    if (original !== undefined) tomadaEn = aMilisegundos(ascii(original), x.has(0x9011) ? ascii(x.get(0x9011)!) : null)
  }
  return { lat, lon, tomadaEn }
}

/**
 * "2026:09:12 10:15:03", con su desfase si lo trae ("+02:00"). Sin desfase se
 * toma como hora local de quien la sube, que casi siempre es la del sitio.
 */
export function aMilisegundos(fecha: string, desfase: string | null): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(fecha)
  if (!m) return null
  const [a, mes, d, h, mi, s] = m.slice(1).map(Number)
  const z = desfase ? /^([+-])(\d{2}):(\d{2})$/.exec(desfase) : null
  if (z) {
    const signo = z[1] === '-' ? -1 : 1
    return Date.UTC(a, mes - 1, d, h, mi, s) - signo * (Number(z[2]) * 60 + Number(z[3])) * 60_000
  }
  const t = new Date(a, mes - 1, d, h, mi, s).getTime()
  return Number.isFinite(t) ? t : null
}
