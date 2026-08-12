#!/usr/bin/env node
// Genera dist/ota-manifest.json: la lista completa de ficheros del visor web
// con su hash, mas un buildId que resume el conjunto.
//
// Lo consume el actualizador OTA de la app iOS (ios/Sources/WebOTAUpdater.swift):
// como la app sirve el visor desde una copia empaquetada, sin este manifiesto no
// hay forma de saber QUE ficheros componen un build (los chunks perezosos no
// aparecen en index.html) ni de saber cuando la descarga esta completa. Y la
// descarga tiene que ser todo-o-nada: activar un build a medias dejaria el visor
// roto justo donde mas duele, sin cobertura.
//
// Se excluye lo mismo que ios/scripts/copy-webdist.sh (_headers/_redirects son
// de Cloudflare y los .gpx son datos de prueba), asi que el manifiesto describe
// exactamente lo que la app necesita.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const OUT = 'ota-manifest.json'
const EXCLUDE = new Set(['_headers', '_redirects', '.DS_Store', OUT])

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

const files = walk(DIST)
  .map((full) => relative(DIST, full).split(sep).join('/'))
  .filter((rel) => !EXCLUDE.has(rel) && !rel.endsWith('.gpx') && !rel.endsWith('/.DS_Store'))
  .sort()
  .map((rel) => {
    const bytes = readFileSync(join(DIST, rel))
    return { path: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  })

// El buildId resume el conjunto: si cambia un solo fichero, cambia el id y la
// app sabe que hay build nuevo sin comparar hash por hash.
const buildId = createHash('sha256')
  .update(files.map((f) => `${f.path}:${f.sha256}`).join('\n'))
  .digest('hex')
  .slice(0, 16)

const totalBytes = files.reduce((n, f) => n + f.bytes, 0)
writeFileSync(join(DIST, OUT), JSON.stringify({ buildId, files, totalBytes }, null, 2))
console.log(`-> ${OUT}: ${files.length} ficheros · ${(totalBytes / 1e6).toFixed(1)} MB · build ${buildId}`)
