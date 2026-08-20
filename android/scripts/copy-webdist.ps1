# Copia el visor web construido (dist/ de la raíz) a los assets de la app.
# Equivalente en PowerShell de copy-webdist.sh, para desarrollar en Windows.
#
#   npm run build
#   .\android\scripts\copy-webdist.ps1
#   cd android; .\gradlew.bat assembleDebug
#
# Requiere PowerShell 5.1 o superior (el que trae Windows 10/11 de serie).
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # android/
$dist = Join-Path (Split-Path -Parent $here) 'dist'
$dest = Join-Path $here 'app\src\main\assets\web'

if (-not (Test-Path $dist)) {
    Write-Error "no encuentro $dist — ejecuta antes 'npm run build' en la raíz."
    exit 1
}

# --delete del rsync: se vacía el destino antes de copiar. Sin esto, los ficheros
# de un build anterior (que llevan hash en el nombre) se acumularían y el APK
# crecería con basura que además no está en el manifiesto OTA.
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Mismas exclusiones que copy-webdist.sh y que make-ota-manifest.mjs: _headers y
# _redirects son de Cloudflare y los .gpx son datos de prueba. Así lo empaquetado
# coincide exactamente con lo que describe el manifiesto OTA.
$excluidos = @('_headers', '_redirects', '.DS_Store')

$distFull = (Resolve-Path $dist).Path
Get-ChildItem -Path $dist -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($distFull.Length).TrimStart('\', '/')
    $nombre = $_.Name
    if ($excluidos -contains $nombre) { return }
    if ($nombre -like '*.gpx') { return }

    $destino = Join-Path $dest $rel
    $carpeta = Split-Path -Parent $destino
    if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Force -Path $carpeta | Out-Null }
    Copy-Item -Path $_.FullName -Destination $destino -Force
}

$total = (Get-ChildItem -Path $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum
$n = (Get-ChildItem -Path $dest -Recurse -File).Count
Write-Host ("Copiados {0:N1} MB en {1} ficheros de visor web -> {2}" -f ($total / 1MB), $n, $dest)
