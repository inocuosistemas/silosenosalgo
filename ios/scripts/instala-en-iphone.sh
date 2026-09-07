#!/usr/bin/env bash
#
# Instala la app en un iPhone conectado, firmando con el certificado GRATUITO.
#
# Es el camino de mientras: sin cuenta de pago no hay TestFlight, así que la
# app se instala desde aquí y CADUCA A LOS SIETE DÍAS —hay que repetirlo—. En
# cuanto Apple apruebe el alta de organización, esto se sustituye por archivar
# y subir a App Store Connect.
#
# Requisito de una vez: la cuenta de Apple tiene que estar dada de alta en
# Xcode (Xcode ▸ Settings ▸ Accounts ▸ + ▸ Apple ID). Sin eso el firmado
# automático no puede crear el perfil y el build muere con "No Accounts".
#
# Uso:
#   ios/scripts/instala-en-iphone.sh                # al primer iPhone que vea
#   ios/scripts/instala-en-iphone.sh <UDID>         # a uno concreto
#
# Hace, en este orden y sin saltarse ninguno:
#   1. compila la web  — la app lleva el visor dentro, y sin esto se instala
#      con el visor viejo aunque la web esté al día;
#   2. lo copia a ios/WebDist;
#   3. regenera el .xcodeproj (no se versiona: sale de project.yml);
#   4. compila y firma para el dispositivo;
#   5. lo instala.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/../.." && pwd)"
# El equipo personal, el del certificado gratuito. No vive en `project.yml`
# porque ahí va el de la ORGANIZACIÓN cuando exista, y no conviene que uno pise
# al otro en un fichero versionado.
EQUIPO="${DEVELOPMENT_TEAM:-GQN76XXKG3}"

udid="${1:-}"
if [ -z "$udid" ]; then
  udid="$(xcrun xctrace list devices 2>/dev/null \
    | awk '/^iPhone.*\(/{ if (match($0, /\(([0-9A-Fa-f-]{25,})\)/, m)) { print m[1]; exit } }')"
fi
[ -n "$udid" ] || { echo "No veo ningún iPhone. Conéctalo o ponlo en la misma red y desbloquéalo." >&2; exit 1; }
echo "▸ iPhone: $udid"

echo "▸ 1/5 compilando la web…"
( cd "$raiz" && npm run build >/dev/null ) 2>/dev/null || ( cd "$raiz" && npm run build )

echo "▸ 2/5 copiando el visor a la app…"
"$raiz/ios/scripts/copy-webdist.sh"

echo "▸ 3/5 regenerando el proyecto…"
( cd "$raiz/ios" && xcodegen generate )

echo "▸ 4/5 compilando y firmando…"
( cd "$raiz/ios" && xcodebuild \
    -project SiLoSeNoSalgoTracker.xcodeproj \
    -scheme SiLoSeNoSalgoTracker \
    -configuration Debug \
    -destination "id=$udid" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$EQUIPO" \
    build )

app="$(cd "$raiz/ios" && xcodebuild -project SiLoSeNoSalgoTracker.xcodeproj \
        -scheme SiLoSeNoSalgoTracker -configuration Debug -destination "id=$udid" \
        -showBuildSettings 2>/dev/null \
        | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{d=$2} / FULL_PRODUCT_NAME /{n=$2} END{print d"/"n}')"
echo "▸ 5/5 instalando $app"
xcrun devicectl device install app --device "$udid" "$app"

echo
echo "Listo. Recuerda: con certificado gratuito la app deja de abrirse a los 7 días."
echo "La primera vez, en el iPhone: Ajustes ▸ General ▸ VPN y gestión de dispositivos ▸ confiar."
