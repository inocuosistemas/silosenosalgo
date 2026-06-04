#!/usr/bin/env node
// Despliega `dist/` en Cloudflare Pages con un mensaje de commit saneado.
//
// Cloudflare trunca el mensaje del commit a un limite de bytes; si el corte
// cae a mitad de un caracter multibyte (acentos, guiones largos, flechas,
// comillas tipograficas, elipsis, emojis), el mensaje deja de ser UTF-8
// valido y la API rechaza el deployment (code 8000111). Aqui transliteramos
// a ASCII y acortamos, asi nunca falla aunque el commit lleve acentos/emojis.

import { execFileSync, execSync } from 'node:child_process'

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
    // Limita a un juego seguro entre comillas dobles en cualquier shell (cmd y
    // sh): elimina " ' ` $ \ % etc. que romperian el comando de deploy.
    .replace(/[^A-Za-z0-9 ._:()[\]\/+#-]/g, ' ')
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

// Usamos execSync (corre via shell) en vez de execFileSync('npx', ...): en
// Windows `npx` es npx.cmd y Node no lo puede lanzar sin shell, fallando en
// silencio. Con el shell, se resuelve npx.cmd (cmd.exe) o npx (sh). El mensaje
// ya esta saneado a ASCII seguro, asi que entre comillas dobles no rompe nada.
const deployCmd =
  `npx wrangler pages deploy dist --project-name=${PROJECT} --commit-message="${message}"`

try {
  execSync(deployCmd, { stdio: 'inherit' })
} catch (err) {
  // A diferencia de antes, NO nos tragamos el fallo en silencio: un deploy roto
  // ya no parecera exitoso. wrangler imprime su propio error arriba (stdio
  // heredado); aqui resumimos y damos la pista mas habitual.
  console.error('\n[deploy] X El despliegue ha FALLADO (ver el error de wrangler arriba).')
  if (err && err.message) console.error(`[deploy]   ${err.message.split('\n')[0]}`)
  console.error('[deploy]   Si es un error de autenticacion (code 10000): npx wrangler login')
  process.exit(1)
}
