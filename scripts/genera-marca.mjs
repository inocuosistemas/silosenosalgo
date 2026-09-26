// La marca de la app, dibujada aquí y solo aquí: un recorrido que es a la vez
// un rayo y la S de SiLoSeNoSalgo. Sale de un punto pequeño (la salida) y acaba
// en la posición en directo, con su halo.
//
//   node scripts/genera-marca.mjs
//
// De este mismo dibujo salen:
// - public/favicon.svg: el glifo solo, sin fondo. Es también la marca dentro
//   del visor (src/lib/marcaApp.ts), en la tarjeta que se comparte y en la
//   pantalla de arranque de index.html, que lleva una copia en línea.
// - iOS: el icono en claro, oscuro y tintado (AppIcon.appiconset) y el glifo
//   para las pantallas de la app (MarcaApp.imageset).
// - Android: las capas del icono adaptativo (primer plano, y monocroma para
//   los iconos temáticos; el fondo es un degradado en XML), el de la ficha de
//   Google Play y el glifo de las pantallas (drawable-nodpi/marca_app.png).
//
// Todo en PNG salvo el favicon: el cristal lleva filtros y desenfoques, que ni
// los catálogos de iOS ni un VectorDrawable de Android saben dibujar.
import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const f = (n) => Math.round(n * 10) / 10

// ---- El dibujo ---------------------------------------------------------------

/** Los vértices del recorrido en el lienzo de 1024, antes de centrarlo. */
const RECORRIDO = [[664, 218], [388, 524], [648, 524], [398, 800]]
const GROSOR = 104
/** Cuánto ocupa: deja margen de sobra alrededor, como piden los iconos de Apple. */
const ESCALA = 0.9
const HALO = 124

// Centrado contando el punto final, que es lo que más pesa.
const PUNTO = GROSOR * 0.76
const xs = RECORRIDO.map((p) => p[0]), ys = RECORRIDO.map((p) => p[1]), fin0 = RECORRIDO.at(-1)
const cx0 = (Math.min(...xs.map((x) => x - GROSOR / 2), fin0[0] - PUNTO) + Math.max(...xs.map((x) => x + GROSOR / 2), fin0[0] + PUNTO)) / 2
const cy0 = (Math.min(...ys.map((y) => y - GROSOR / 2), fin0[1] - PUNTO) + Math.max(...ys.map((y) => y + GROSOR / 2), fin0[1] + PUNTO)) / 2
const PTS = RECORRIDO.map(([x, y]) => [f(512 + (x - cx0) * ESCALA), f(512 + (y - cy0) * ESCALA)])
const W = GROSOR * ESCALA
const [SX, SY] = PTS[0]
const [EX, EY] = PTS.at(-1)
const TRAZO = `M${PTS.map((p) => p.join(' ')).join('L')}`

const TEMAS = {
  claro: {
    fondo: ['#B9A0FF', '#7C42F4', '#5319D0'], brillo: ['#FFFFFF', 0.30],
    cuerpo: [['#FFFFFF', 0.97], ['#F1E9FF', 0.9]], borde: '#6A2FE6', sombra: ['#2D0A86', 0.42],
    acento: ['#9A62FF', '#5A1BE0'], nucleo: '#FFFFFF', halo: ['#FFFFFF', 0.21],
  },
  oscuro: {
    fondo: ['#2A1650', '#150A2E', '#07030F'], brillo: ['#8A55FF', 0.32],
    cuerpo: [['#E4D7FF', 0.98], ['#9C68FF', 0.95]], borde: '#3A0FA0', sombra: ['#000000', 0.6],
    acento: ['#FFFFFF', '#DCCBFF'], nucleo: '#5A1BE0', halo: ['#B393FF', 0.23],
  },
}

const trazo = (paint) => `<path d="${TRAZO}" fill="none" stroke="${paint}" stroke-width="${f(W)}" stroke-linecap="round" stroke-linejoin="round"/>`
const punto = (paint) => `<circle cx="${EX}" cy="${EY}" r="${f(PUNTO * ESCALA)}" fill="${paint}"/>`

/** Una pieza de cristal: sombra corta, cuerpo, luz en el canto de arriba y un brillo. */
function cristal(id, forma, T, { paint, especular, sombra }) {
  const mascara = `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">${forma('#fff')}</mask>`
  let cuerpo = ''
  if (sombra) cuerpo += `<g filter="url(#sombra)" opacity="${f(T.sombra[1] * sombra * 100) / 100}">${forma(T.sombra[0])}</g>`
  cuerpo += `<g filter="url(#vidrio)">${forma(paint)}</g>`
  const [cx, cy, rx, ry, rot] = especular
  cuerpo += `<g mask="url(#${id})"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${f(cx)} ${f(cy)})" fill="url(#especular)"/></g>`
  return { mascara, cuerpo }
}

/**
 * El SVG de la marca. `fondo`: con el degradado detrás (el icono) o sin él (el
 * glifo). `sombra`: la sombra corta que lo separa del fondo; sobre un fondo que
 * no es el suyo ensucia, así que el glifo suelto no la lleva.
 */
function marca(tema, { fondo = true, sombra = fondo, caja = '0 0 1024 1024' } = {}) {
  const T = TEMAS[tema]
  const linea = cristal('m-trazo', trazo, T, { paint: 'url(#cuerpo)', especular: [520, 330, 200, 64, -48], sombra: sombra ? 1 : 0 })
  const final = cristal('m-punto', punto, T, { paint: 'url(#acento)', especular: [EX - 22, EY - 30, 48, 28, -20], sombra: sombra ? 0.8 : 0 })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caja}"><defs>
<linearGradient id="fondo" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${T.fondo[0]}"/><stop offset=".55" stop-color="${T.fondo[1]}"/><stop offset="1" stop-color="${T.fondo[2]}"/></linearGradient>
<radialGradient id="brillo" cx=".28" cy=".12" r=".75"><stop offset="0" stop-color="${T.brillo[0]}" stop-opacity="${T.brillo[1]}"/><stop offset="1" stop-color="${T.brillo[0]}" stop-opacity="0"/></radialGradient>
<linearGradient id="cuerpo" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="${T.cuerpo[0][0]}" stop-opacity="${T.cuerpo[0][1]}"/><stop offset="1" stop-color="${T.cuerpo[1][0]}" stop-opacity="${T.cuerpo[1][1]}"/></linearGradient>
<linearGradient id="acento" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${T.acento[0]}"/><stop offset="1" stop-color="${T.acento[1]}"/></linearGradient>
<radialGradient id="especular" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="sombra" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><feGaussianBlur stdDeviation="18"/><feOffset dy="20"/></filter>
<filter id="vidrio" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b"/><feOffset in="b" dy="7" result="bo"/><feComposite in="SourceAlpha" in2="bo" operator="out" result="arriba"/>
<feFlood flood-color="#fff" flood-opacity=".95"/><feComposite in2="arriba" operator="in" result="luz"/>
<feOffset in="b" dy="-10" result="bu"/><feComposite in="SourceAlpha" in2="bu" operator="out" result="abajo"/>
<feFlood flood-color="${T.borde}" flood-opacity=".38"/><feComposite in2="abajo" operator="in" result="sombreado"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sombreado"/><feMergeNode in="luz"/></feMerge></filter>
${linea.mascara}${final.mascara}
</defs>`
    + (fondo ? '<rect width="1024" height="1024" fill="url(#fondo)"/><rect width="1024" height="1024" fill="url(#brillo)"/>' : '')
    + `<circle cx="${EX}" cy="${EY}" r="${HALO}" fill="${T.halo[0]}" opacity="${T.halo[1]}"/>`
    + linea.cuerpo
    + `<circle cx="${SX}" cy="${SY}" r="${f(W * 0.22)}" fill="url(#acento)" opacity=".55"/>`
    + final.cuerpo
    + `<circle cx="${EX}" cy="${EY}" r="${f(W * 0.27)}" fill="${T.nucleo}"/>`
    + '</svg>'
}

/** La silueta plana, en blanco: la capa monocroma de Android. */
function silueta(caja = '0 0 1024 1024') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caja}">${trazo('#fff')}${punto('#fff')}</svg>`
}

// El recuadro del glifo suelto: cuadrado, centrado y con el halo dentro.
const radio = Math.max(...PTS.flatMap(([x, y]) => [Math.abs(x - 512), Math.abs(y - 512)]).map((d) => d + W / 2), Math.abs(EX - 512) + HALO, Math.abs(EY - 512) + HALO)
const CAJA_GLIFO = `${f(512 - radio - 8)} ${f(512 - radio - 8)} ${f(2 * radio + 16)} ${f(2 * radio + 16)}`

const png = (svg, lado) => sharp(Buffer.from(svg), { density: 300 }).resize(lado, lado).png({ compressionLevel: 9 })

// ---- Web -----------------------------------------------------------------------

const glifo = marca('oscuro', { fondo: false, caja: CAJA_GLIFO })
await writeFile(join(raiz, 'public', 'favicon.svg'), glifo + '\n')
// La pantalla de arranque lleva una copia en línea: se ve antes de que cargue nada.
const index = join(raiz, 'index.html')
const html = await readFile(index, 'utf8')
const arranque = glifo.replace('<svg ', '<svg width="72" height="72" aria-hidden="true" ')
await writeFile(index, html.replace(/(<!-- El logo es copia de public\/favicon\.svg\. -->\s*<div class="arranque"[^>]*>\s*)<svg[^]*?<\/svg>/, `$1${arranque}`))

// ---- iOS -----------------------------------------------------------------------

const iconoIOS = join(raiz, 'ios', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset')
// App Store Connect rechaza el canal alfa en el icono.
await png(marca('claro'), 1024).removeAlpha().toFile(join(iconoIOS, 'icono-1024.png'))
await png(marca('oscuro'), 1024).removeAlpha().toFile(join(iconoIOS, 'icono-1024-oscuro.png'))
// Tintado: iOS se queda con la luminancia y la tiñe del color elegido.
await png(marca('oscuro'), 1024).removeAlpha().grayscale().toFile(join(iconoIOS, 'icono-1024-tintado.png'))
await writeFile(join(iconoIOS, 'Contents.json'), JSON.stringify({
  images: [
    { filename: 'icono-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'icono-1024-oscuro.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'icono-1024-tintado.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
  ],
  info: { author: 'xcode', version: 1 },
}, null, 2) + '\n')

// El glifo de las pantallas: hasta 76 pt en la de la baliza.
const marcaIOS = join(raiz, 'ios', 'Resources', 'Assets.xcassets', 'MarcaApp.imageset')
for (const [n, lado] of [[1, 80], [2, 160], [3, 240]]) await png(glifo, lado).toFile(join(marcaIOS, `marca-${n}x.png`))

// ---- Android -------------------------------------------------------------------

const res = join(raiz, 'android', 'app', 'src', 'main', 'res')
// El icono adaptativo son capas de 108dp de las que se ven, recortados en
// círculo o en lo que elija el lanzador, los 72 centrales. El dibujo de 1024 va
// en 64: en un círculo parece más grande que en el cuadrado de iOS, y así
// queda del mismo tamaño a la vista.
const VISTO = 64
const CAJA_ADAPTATIVA = `${f(-1024 * (108 - VISTO) / 2 / VISTO)} ${f(-1024 * (108 - VISTO) / 2 / VISTO)} ${f(1024 * 108 / VISTO)} ${f(1024 * 108 / VISTO)}`
const DENSIDADES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
for (const [densidad, lado] of Object.entries(DENSIDADES)) {
  const destino = join(res, `mipmap-${densidad}`)
  await mkdir(destino, { recursive: true })
  await png(marca('claro', { fondo: false, sombra: true, caja: CAJA_ADAPTATIVA }), lado).toFile(join(destino, 'ic_launcher_foreground.png'))
  await png(silueta(CAJA_ADAPTATIVA), lado).toFile(join(destino, 'ic_launcher_monochrome.png'))
}
// La ficha de Google Play se sube a mano a la consola; no entra en el APK.
await png(marca('claro'), 512).removeAlpha().toFile(join(raiz, 'android', 'app', 'src', 'main', 'ic_launcher-playstore.png'))
// El glifo de las pantallas: hasta 72dp, a xxxhdpi.
await png(glifo, 288).toFile(join(res, 'drawable-nodpi', 'marca_app.png'))

console.log('Marca generada: favicon, index.html, iOS (icono claro/oscuro/tintado y MarcaApp) y Android (capas, Play y marca_app)')
