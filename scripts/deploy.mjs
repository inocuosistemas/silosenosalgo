#!/usr/bin/env node
// Despliega `dist/` en Cloudflare Pages con un mensaje de commit saneado.
//
// Cloudflare trunca el mensaje del commit a un limite de bytes; si el corte
// cae a mitad de un caracter multibyte (acentos, guiones largos, flechas,
// comillas tipograficas, elipsis, emojis), el mensaje deja de ser UTF-8
// valido y la API rechaza el deployment (code 8000111). Aqui transliteramos
// a ASCII y acortamos, asi nunca falla aunque el commit lleve acentos/emojis.

import { execFileSync } from 'node:child_process'

const PROJECT = 'silosenosalgo'

/** Convierte un texto a ASCII seguro y lo acorta a `max` caracteres. */
function sanitize(text, max = 200) {
  const ascii = (text || '')
    .normalize('NFKD')                    // descompone acentos: "a-tilde" -> a + diacritico
    .replace(/[̀-ͯ]/g, '')      // elimina las marcas diacriticas combinantes
    .replace(/[‒-―]/g, '-')     // guiones largos -> "-"
    .replace(/→/g, '->')             // flecha
    .replace(/[«»“”]/g, '"') // comillas angulares/dobles -> '"'
    .replace(/[‘’]/g, "'")      // comillas simples tipograficas -> "'"
    .replace(/…/g, '...')            // elipsis
    .replace(/[^\x00-\x7F]/g, '')         // descarta cualquier no-ASCII restante (emojis, etc.)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
  return ascii || 'deploy'
}

function gitSubject() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%s'], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

const message = sanitize(gitSubject())
console.log(`-> Deploy a Cloudflare Pages (${PROJECT})`)
console.log(`   commit-message saneado: "${message}"`)

try {
  execFileSync(
    'npx',
    ['wrangler', 'pages', 'deploy', 'dist', `--project-name=${PROJECT}`, `--commit-message=${message}`],
    { stdio: 'inherit' },
  )
} catch {
  // wrangler ya imprime el error; salimos con codigo de error sin doble traza.
  process.exit(1)
}
