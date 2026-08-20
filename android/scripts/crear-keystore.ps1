# Crea, UNA SOLA VEZ, la clave con la que se firman las versiones de release.
# Equivalente en PowerShell de crear-keystore.sh, para trabajar en Windows.
#
#   .\android\scripts\crear-keystore.ps1
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

# `param` tiene que ser la primera instrucción del fichero: solo pueden
# precederla comentarios.
param(
    # Solo para integración continua; a mano es mejor dejar que la pregunte, así
    # no queda en el historial del terminal.
    [string]$Clave,
    [string]$Alias   = 'silosenosalgo',
    [string]$Almacen = 'silosenosalgo-release.jks',
    [string]$Pais    = 'ES'
)

$ErrorActionPreference = 'Stop'

# El nombre de la sociedad lleva tilde, y aquí no se puede confiar en la
# codificación del fichero: PowerShell 5.1 lee los .ps1 sin BOM como ANSI, y
# "Informáticos" se convertiría en "InformÃ¡ticos" DENTRO del certificado, donde
# ya no hay forma de corregirlo. Escrito por punto de código no depende de eso.
$a = [char]0xE1
$Empresa = "Inocuo Sistemas Inform${a}ticos SL"
$Marca   = 'TheMakerCrowd'

$here    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # android/
$destino = Join-Path $here $Almacen
$props   = Join-Path $here 'keystore.properties'

$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool -and $env:JAVA_HOME) {
    $candidato = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    if (Test-Path $candidato) { $keytool = $candidato }
}
if (-not $keytool) {
    Write-Error "no encuentro keytool — instala el JDK 17 (winget install EclipseAdoptium.Temurin.17.JDK) o pon JAVA_HOME."
    exit 1
}

# Regenerar encima de una clave existente es exactamente el desastre que este
# script tiene que evitar: la nueva no sirve para actualizar lo firmado con la
# vieja, y la vieja ya no está.
if (Test-Path $destino) {
    Write-Error "ya existe $destino — no lo toco. Si de verdad quieres una clave nueva, mueve la vieja a un sitio seguro antes."
    exit 1
}

function Pedir-Clave([string]$mensaje) {
    $segura = Read-Host -Prompt $mensaje -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not $Clave) {
    $Clave = Pedir-Clave 'Contrasena para la clave (minimo 6 caracteres)'
    $otra  = Pedir-Clave 'Repite la contrasena'
    if ($Clave -ne $otra) { Write-Error 'no coinciden.'; exit 1 }
}
if ($Clave.Length -lt 6) { Write-Error 'keytool exige al menos 6 caracteres.'; exit 1 }

# El certificado va autofirmado y no lo valida nadie, pero el nombre queda fijado
# para siempre: se comprueba abajo antes de dar el trabajo por bueno.
$dname = "CN=$Marca, O=$Empresa, C=$Pais"

Write-Host ""
Write-Host "Almacen : $destino"
Write-Host "Alias   : $Alias"
Write-Host "Titular : $dname"
Write-Host ""

# La contraseña viaja por el entorno y no por la línea de órdenes: los argumentos
# de un proceso los puede leer cualquier otro proceso de la máquina.
$env:SLSNS_PW_TMP = $Clave
try {
    & $keytool -genkeypair -v `
        -storetype PKCS12 `
        -keystore $destino `
        -alias $Alias `
        -keyalg RSA -keysize 4096 `
        -validity 10000 `
        -dname $dname `
        -storepass:env SLSNS_PW_TMP `
        -keypass:env SLSNS_PW_TMP
    if ($LASTEXITCODE -ne 0) { throw "keytool ha fallado con codigo $LASTEXITCODE" }

} finally {
    Remove-Item Env:\SLSNS_PW_TMP -ErrorAction SilentlyContinue
}

# `keystore.properties` se escribe sin BOM: Java lo lee como .properties (Latin-1
# / escapes \uXXXX) y un BOM al principio le estropearia la primera clave.
$contenido = @"
# Generado por scripts/crear-keystore.ps1. Git-ignored: NO subir nunca.
# La ruta es relativa a `android/`.
storeFile=$Almacen
storePassword=$Clave
keyAlias=$Alias
keyPassword=$Clave
"@
[IO.File]::WriteAllText($props, $contenido, (New-Object Text.UTF8Encoding($false)))

# El certificado se lee del fichero, NO se le pregunta a keytool. Con `keytool
# -list` por una tubería, Java escribe en Cp1252 y PowerShell lee en CP850, así
# que la "á" de "Informáticos" sale como "ß" y parece que el certificado está
# corrupto cuando no lo está. Leyendo el PKCS12 con .NET no hay conversión de
# por medio y lo que se ve es lo que hay dentro.
Write-Host ""
Write-Host "--- Esto es lo que ha quedado grabado en el certificado ---"
$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($destino, $Clave)
Write-Host ("Titular : " + $cert.Subject)
Write-Host ("SHA-256 : " + $cert.GetCertHashString('SHA256'))
Write-Host ("Valido  : {0:yyyy-MM-dd} -> {1:yyyy-MM-dd}" -f $cert.NotBefore, $cert.NotAfter)
Write-Host "Apunta la huella SHA-256: es como se identifica esta clave en Play Console."

Write-Host ""
Write-Host "Listo. Creados:"
Write-Host "  $destino"
Write-Host "  $props"
Write-Host ""
Write-Host "AHORA, antes de seguir:"
Write-Host "  1. Copia el .jks a un sitio seguro que NO sea este ordenador."
Write-Host "  2. Guarda la contrasena en el gestor de contrasenas."
Write-Host "Sin esas dos cosas, un disco roto os deja sin poder actualizar la app."
