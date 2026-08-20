#!/usr/bin/env bash
# Copia el visor web construido (dist/ de la raíz) a los assets de la app, para
# empaquetarlo como visor offline incrustado. Espejo de ios/scripts/copy-webdist.sh.
#
# Se ejecuta después de `npm run build` y antes de compilar:
#   npm run build && android/scripts/copy-webdist.sh && (cd android && ./gradlew assembleDebug)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"   # android/
dist="$here/../dist"
dest="$here/app/src/main/assets/web"

if [ ! -d "$dist" ]; then
  echo "error: no encuentro $dist — ejecuta antes 'npm run build' en la raíz." >&2
  exit 1
fi

mkdir -p "$dest"
# Mismas exclusiones que iOS y que make-ota-manifest.mjs: _headers y _redirects
# son de Cloudflare y los .gpx son datos de prueba. Así lo empaquetado coincide
# exactamente con lo que describe el manifiesto OTA.
rsync -a --delete \
  --exclude '.DS_Store' --exclude '_headers' --exclude '_redirects' --exclude '*.gpx' \
  "$dist/" "$dest/"

echo "Copiados $(du -sh "$dest" | cut -f1) de visor web → $dest"
