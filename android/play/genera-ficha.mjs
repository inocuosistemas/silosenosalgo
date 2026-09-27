// Las imágenes de la ficha de Google Play, a partir de las capturas de
// `origen/` (del emulador y del visor):
//
//   node android/play/genera-ficha.mjs
//
// - `ficha/grafico-destacado.png`: 1024×500, el que sale arriba de la ficha.
// - `ficha/telefono-NN.png`: 1080×1920 (9:16), cada captura con su titular.
//   Play pide que el lado largo no pase del doble del corto; las capturas del
//   móvil (20:9) no lo cumplen solas, y con el titular encima se leen mejor.
//
// El icono de 512 lo deja `scripts/genera-marca.mjs` en
// `android/app/src/main/ic_launcher-playstore.png`.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sharp = createRequire(import.meta.url)('sharp')
const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..', '..')
const origen = join(aqui, 'origen')
const destino = join(aqui, 'ficha')
mkdirSync(destino, { recursive: true })

const FUENTE = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const escapa = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fondo = (w, h) => `<defs><linearGradient id="f" x1="0" y1="0" x2="0.35" y2="1">
  <stop offset="0" stop-color="#B9A0FF"/><stop offset=".55" stop-color="#7C42F4"/><stop offset="1" stop-color="#5319D0"/></linearGradient>
  <radialGradient id="b" cx=".2" cy=".05" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#f)"/><rect width="${w}" height="${h}" fill="url(#b)"/>`

/** Esquinas redondeadas y una sombra suave, como un móvil apoyado. */
async function tarjeta(fichero, ancho, alto, radio) {
  const img = await sharp(fichero).resize(ancho, alto, { fit: 'cover', position: 'top' }).png().toBuffer()
  const mascara = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="${ancho}" height="${alto}" rx="${radio}" fill="#fff"/></svg>`)
  return sharp(img).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer()
}

// ── Gráfico destacado ──────────────────────────────────────────────────────
{
  const W = 1024, H = 500
  const icono = await tarjeta(join(raiz, 'ios/Resources/Assets.xcassets/AppIcon.appiconset/icono-1024.png'), 250, 250, 56)
  const texto = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fondo(W, H)}
    <text x="400" y="215" font-family="${FUENTE}" font-size="74" font-weight="700" fill="#fff">SiLoSeNoSalgo</text>
    <text x="402" y="275" font-family="${FUENTE}" font-size="31" fill="#fff" fill-opacity=".92">Tu baliza GPS: que te sigan en directo</text>
    <text x="402" y="330" font-family="${FUENTE}" font-size="24" fill="#fff" fill-opacity=".75">Salidas · Carreras · Tramos · Maqueta 3D</text>
  </svg>`)
  await sharp(texto)
    .composite([{ input: icono, left: 110, top: 125 }])
    .png().toFile(join(destino, 'grafico-destacado.png'))
}

// ── Capturas de teléfono ───────────────────────────────────────────────────
const capturas = [
  ['baliza.png', 'Arma tu baliza', 'y quien tenga el enlace te sigue en directo'],
  ['tramos-mapa.png', 'Cada medio, su tramo', 'a pie, en barco, en tren… y lo corriges en el mapa'],
  ['tramos-tarjeta.png', 'Tu salida, de un vistazo', 'distancia, tiempo y ritmo por tramos'],
  ['maqueta.png', 'Tu salida en 3D', 'y en vídeo, con tus fotos donde las hiciste'],
  ['video-noche.png', 'La luz de aquel día', 'amanece, atardece y anochece a su hora'],
  ['mi-posicion.png', 'Tú, sobre la ruta', 'tu posición y hacia dónde miras'],
  ['carreras.png', 'Tus carreras', 'con su cuenta atrás, su mapa y su porra'],
  ['en-directo.png', 'En la notificación', 'y en un widget en la pantalla de inicio'],
]
const W = 1080, H = 1920
let n = 0
for (const [fichero, titulo, sub] of capturas) {
  n++
  const altoCaptura = 1480
  const meta = await sharp(join(origen, fichero)).metadata()
  const anchoCaptura = Math.round(altoCaptura * (meta.width / meta.height))
  const captura = await tarjeta(join(origen, fichero), anchoCaptura, altoCaptura, 44)
  const sombra = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter></defs>
    <rect x="${(W - anchoCaptura) / 2}" y="${H - altoCaptura - 70 + 24}" width="${anchoCaptura}" height="${altoCaptura}" rx="44" fill="#1e0a4d" fill-opacity=".45" filter="url(#s)"/></svg>`)
  const lienzo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${fondo(W, H)}
    <text x="${W / 2}" y="170" text-anchor="middle" font-family="${FUENTE}" font-size="76" font-weight="700" fill="#fff">${escapa(titulo)}</text>
    <text x="${W / 2}" y="245" text-anchor="middle" font-family="${FUENTE}" font-size="40" fill="#fff" fill-opacity=".9">${escapa(sub)}</text>
  </svg>`)
  await sharp(lienzo)
    .composite([{ input: sombra, left: 0, top: 0 }, { input: captura, left: Math.round((W - anchoCaptura) / 2), top: H - altoCaptura - 70 }])
    .png().toFile(join(destino, `telefono-${String(n).padStart(2, '0')}.png`))
}
console.log(`Ficha: gráfico destacado y ${n} capturas en ${destino}`)
