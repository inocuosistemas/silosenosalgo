#!/usr/bin/env bash
#
# Archiva la app y la sube a TestFlight.
#
# Es el sustituto de instala-en-iphone.sh cuando hay que repartir a varias
# personas: allí se firma para desarrollo y se instala por cable; aquí se firma
# para distribución y sube a App Store Connect, que se encarga del reparto.
#
# Uso:
#   ios/scripts/sube-a-testflight.sh              # archiva y sube
#   ios/scripts/sube-a-testflight.sh --sin-subir  # solo archiva (prueba en seco)
#   ios/scripts/sube-a-testflight.sh --sin-web    # reutiliza el dist/ ya hecho
#
# `--sin-web` existe por un problema real: `npm run build` se queda colgado cada
# cierto tiempo en el paso de Vite —sin error y sin salir— y aquí, con la salida
# redirigida, eso parece un archivado lento en vez de un cuelgue. Cuando ya se ha
# construido la web a mano (con `node node_modules/vite/bin/vite.js build`, que
# no se cuelga), esto evita repetir la verificación entera. Es el mismo apaño que
# `scripts/deploy-all.mjs --skip-build`, por el mismo motivo.
#
# Requisitos, todos de una vez:
#   · La cuenta soporte@inocuo.com dada de alta en Xcode ▸ Settings ▸ Accounts.
#   · La app creada en App Store Connect con el identificador
#     com.themakercrowd.silosenosalgo.
#   · Una clave de la API de App Store Connect (App Store Connect ▸ Usuarios y
#     acceso ▸ Integraciones), CON ACCESO "ADMIN". Con "App Manager" el
#     archivado va bien y la subida se cae con:
#
#       error: exportArchive Cloud signing permission error
#       error: exportArchive No profiles for '...' were found
#
#     porque firmar en la nube —crear el certificado y el perfil de
#     distribución— Apple solo se lo permite a las claves Admin.
#
#     El .p8 se guarda en ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
#     —Apple solo deja descargarlo una vez— y las dos variables van en el
#     perfil del shell (~/.zshrc), no en el repositorio:
#
#       export ASC_KEY_ID=XXXXXXXXXX
#       export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# El número de build sale del número de commits, así que cada subida lleva uno
# distinto y creciente sin tener que acordarse: App Store Connect rechaza un
# build repetido.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/../.." && pwd)"
subir=true
web=true
for arg in "$@"; do
  case "$arg" in
    --sin-subir) subir=false ;;
    --sin-web)   web=false ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

build="$(cd "$raiz" && git rev-list --count HEAD)"
version="$(awk -F'"' '/MARKETING_VERSION/{print $2; exit}' "$raiz/ios/project.yml")"
archivo="$raiz/ios/build/SiLoSeNoSalgo.xcarchive"
export_dir="$raiz/ios/build/export"
echo "▸ versión $version, build $build"

if [ "$web" = true ]; then
  echo "▸ 1/4 compilando la web…"
  ( cd "$raiz" && npm run build >/dev/null ) 2>/dev/null || ( cd "$raiz" && npm run build )
else
  echo "▸ 1/4 web: se reutiliza el dist/ ya construido (--sin-web)"
  [ -f "$raiz/dist/index.html" ] || { echo "No hay dist/ que reutilizar: constrúyelo antes." >&2; exit 1; }
fi

echo "▸ 2/4 copiando el visor a la app…"
"$raiz/ios/scripts/copy-webdist.sh"
( cd "$raiz/ios" && xcodegen generate >/dev/null )

# Con firma automática, el archivo se firma para DESARROLLO y es el paso de
# export el que lo vuelve a firmar para la tienda. Por eso aquí no se fuerza la
# identidad: si se pone "Apple Distribution" a mano, Xcode se queja de ajustes
# de firma en conflicto. La consecuencia es que hace falta al menos un
# dispositivo registrado en la cuenta, porque un perfil de desarrollo sin
# dispositivos Apple no lo emite.
# Con firma automática, crear o refrescar un perfil exige una cuenta
# autenticada. En una terminal no hay Xcode con cuenta añadida, así que se le
# pasa al ARCHIVADO la misma clave de la API que ya usaba el export. Sin esto,
# en cuanto el perfil necesita algo nuevo el archivado se cae con:
#
#   error: No Accounts: Add a new account in Accounts settings.
#   error: Provisioning profile "iOS Team Provisioning Profile: *" doesn't
#          include the Push Notifications capability.
#
# Y ese comodín es parte del problema: un App ID comodín NO admite push, así que
# hace falta que Xcode cree el perfil explícito del bundle id. Con la clave
# puesta lo hace solo.
autent=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  claveASC="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
  if [ -f "$claveASC" ]; then
    autent=(-authenticationKeyPath "$claveASC" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  fi
fi

echo "▸ 3/4 archivando (firma de distribución)…"
rm -rf "$archivo" "$export_dir"
( cd "$raiz/ios" && xcodebuild archive \
    -project SiLoSeNoSalgoTracker.xcodeproj \
    -scheme SiLoSeNoSalgoTracker \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$archivo" \
    -allowProvisioningUpdates \
    ${autent[@]+"${autent[@]}"} \
    CURRENT_PROJECT_VERSION="$build" )

if [ "$subir" = false ]; then
  echo
  echo "Archivo listo en $archivo (no se sube: --sin-subir)."
  exit 0
fi

: "${ASC_KEY_ID:?falta ASC_KEY_ID (ver la cabecera de este script)}"
: "${ASC_ISSUER_ID:?falta ASC_ISSUER_ID (ver la cabecera de este script)}"
clave="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$clave" ] || { echo "No encuentro la clave de la API en $clave" >&2; exit 1; }

# Las opciones de export se generan aquí y no se versionan: llevan el Team ID
# y cambian según a dónde vaya el build.
opciones="$raiz/ios/build/ExportOptions.plist"
cat > "$opciones" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>upload</string>
	<key>teamID</key><string>3M9984SP6R</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

echo "▸ 4/4 subiendo a App Store Connect…"
xcodebuild -exportArchive \
  -archivePath "$archivo" \
  -exportOptionsPlist "$opciones" \
  -exportPath "$export_dir" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$clave" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo
echo "Subido. En App Store Connect tarda unos minutos en aparecer ('Processing')."
echo "Cuando esté, TestFlight ▸ probadores internos lo ven sin revisión de Apple."
