#!/usr/bin/env bash
#
# Instala la app en un iPhone conectado, firmando con el equipo de la empresa.
#
# Es el camino corto para probar en un dispositivo sin pasar por TestFlight ni
# por App Store Connect. Con el equipo de pago el perfil vale un año; con el
# certificado personal gratuito, siete días.
#
# Requisito de una vez: la cuenta de Apple de la organización
# (soporte@inocuo.com) tiene que estar dada de alta en Xcode (Xcode ▸ Settings
# ▸ Accounts ▸ + ▸ Apple ID). Sin eso el firmado automático no puede crear el
# perfil y el build muere con "No Accounts".
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
# El equipo sale de `project.yml` (el de la organización). Solo se pasa a
# xcodebuild si se pide otro por variable de entorno, p. ej. el personal
# gratuito:  DEVELOPMENT_TEAM=GQN76XXKG3 ios/scripts/instala-en-iphone.sh
EQUIPO="${DEVELOPMENT_TEAM:-}"
equipo_arg=()
if [ -n "$EQUIPO" ]; then
  equipo_arg=( DEVELOPMENT_TEAM="$EQUIPO" )
  echo "▸ equipo: $EQUIPO (pisa el de project.yml)"
fi

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
    "${equipo_arg[@]+"${equipo_arg[@]}"}" \
    build )

app="$(cd "$raiz/ios" && xcodebuild -project SiLoSeNoSalgoTracker.xcodeproj \
        -scheme SiLoSeNoSalgoTracker -configuration Debug -destination "id=$udid" \
        -showBuildSettings 2>/dev/null \
        | awk -F' = ' '/ BUILT_PRODUCTS_DIR /{d=$2} / FULL_PRODUCT_NAME /{n=$2} END{print d"/"n}')"
echo "▸ 5/5 instalando $app"
xcrun devicectl device install app --device "$udid" "$app"

echo
echo "Listo. Con el equipo de la empresa el perfil vale un año; con el gratuito, 7 días."
echo "La primera vez, en el iPhone: Ajustes ▸ General ▸ VPN y gestión de dispositivos ▸ confiar."
