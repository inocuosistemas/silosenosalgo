#!/usr/bin/env bash
# Crea, UNA SOLA VEZ, la clave con la que se firman las versiones de release.
# Espejo de crear-keystore.ps1 (Windows).
#
#   android/scripts/crear-keystore.sh
#
# Deja dos ficheros en `android/`, los dos fuera de git:
#   silosenosalgo-release.jks   el almacén con la clave
#   keystore.properties         dónde está y con qué contraseña abrirla
#
# ESTA CLAVE NO SE PUEDE REGENERAR. Android identifica una app por la pareja
# (identificador, clave): si se pierde, ni Play ni un móvil aceptan una
# actualización, y el único camino es publicar otra app desde cero. Haz copia de
# seguridad del .jks y guarda la contraseña en el gestor de contraseñas ANTES de
# seguir. Ver ../docs/firma-y-publicacion.md
set -euo pipefail

alias_clave="${SLSNS_KEY_ALIAS:-silosenosalgo}"
almacen="${SLSNS_STORE_FILE:-silosenosalgo-release.jks}"
pais="${SLSNS_COUNTRY:-ES}"
empresa='Inocuo Sistemas Informáticos SL'
marca='TheMakerCrowd'

here="$(cd "$(dirname "$0")/.." && pwd)"   # android/
destino="$here/$almacen"
props="$here/keystore.properties"

if ! command -v keytool >/dev/null 2>&1; then
  echo "error: no encuentro keytool — instala el JDK 17 (brew install openjdk@17) o pon JAVA_HOME." >&2
  exit 1
fi

# Regenerar encima de una clave existente es exactamente el desastre que este
# script tiene que evitar: la nueva no sirve para actualizar lo firmado con la
# vieja, y la vieja ya no está.
if [ -e "$destino" ]; then
  echo "error: ya existe $destino — no lo toco. Si de verdad quieres una clave nueva, mueve la vieja a un sitio seguro antes." >&2
  exit 1
fi

clave="${SLSNS_STORE_PASSWORD:-}"
if [ -z "$clave" ]; then
  read -rsp 'Contraseña para la clave (mínimo 6 caracteres): ' clave; echo
  read -rsp 'Repite la contraseña: ' otra; echo
  [ "$clave" = "$otra" ] || { echo 'error: no coinciden.' >&2; exit 1; }
fi
[ "${#clave}" -ge 6 ] || { echo 'error: keytool exige al menos 6 caracteres.' >&2; exit 1; }

# El certificado va autofirmado y no lo valida nadie, pero el nombre queda fijado
# para siempre: se comprueba abajo antes de dar el trabajo por bueno.
dname="CN=$marca, O=$empresa, C=$pais"

echo
echo "Almacén : $destino"
echo "Alias   : $alias_clave"
echo "Titular : $dname"
echo

# La contraseña viaja por el entorno y no por la línea de órdenes: los argumentos
# de un proceso los puede leer cualquier otro proceso de la máquina.
export SLSNS_PW_TMP="$clave"
trap 'unset SLSNS_PW_TMP' EXIT

keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore "$destino" \
  -alias "$alias_clave" \
  -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -dname "$dname" \
  -storepass:env SLSNS_PW_TMP \
  -keypass:env SLSNS_PW_TMP

echo
echo "--- Esto es lo que ha quedado grabado en el certificado ---"
# `-J-Dfile.encoding=UTF-8` no es opcional: al pasar la salida por una tubería,
# Java deja de escribir en la codificación del terminal y usa la de la
# plataforma. Con LANG=C la "á" de "Informáticos" saldría como "?" y parecería
# que el certificado está corrupto cuando no lo está.
keytool -J-Dfile.encoding=UTF-8 -list -v -keystore "$destino" -alias "$alias_clave" \
    -storepass:env SLSNS_PW_TMP \
  | grep -Ei 'propietario|owner|sha256|sha-256|válido|valid' || true
echo "Apunta la huella SHA-256: es como se identifica esta clave en Play Console."

umask 077
cat > "$props" <<EOF
# Generado por scripts/crear-keystore.sh. Git-ignored: NO subir nunca.
# La ruta es relativa a \`android/\`.
storeFile=$almacen
storePassword=$clave
keyAlias=$alias_clave
keyPassword=$clave
EOF
chmod 600 "$props" "$destino"

echo
echo "Listo. Creados:"
echo "  $destino"
echo "  $props"
echo
echo "AHORA, antes de seguir:"
echo "  1. Copia el .jks a un sitio seguro que NO sea este ordenador."
echo "  2. Guarda la contraseña en el gestor de contraseñas."
echo "Sin esas dos cosas, un disco roto os deja sin poder actualizar la app."
