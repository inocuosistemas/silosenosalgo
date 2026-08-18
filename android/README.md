# SiLoSeNoSalgo · App de seguimiento (Android)

Espejo Android de la app iOS (`../ios`). **Mismo backend, mismo protocolo, mismo
visor web**: aquí no hay nada de servidor, solo otro cliente.

> Estado: **fase 1 en curso** — lo que no necesita el móvil delante. El
> seguimiento en vivo (servicio en primer plano + GPS) es la fase 2 y se hace
> con el dispositivo real: ver "Lo que falta" al final.

## Estructura

- `app/src/main/java/com/themakercrowd/silosenosalgo/`
  - `Config.kt` — URLs del backend y de los enlaces públicos, plantilla de
    teselas. Espejo de `ios/Sources/Config.swift`.
  - `WireTypes.kt` — los modelos del protocolo, espejo de `/shared/wireTypes.ts`
    y de la mitad superior de `ios/Sources/API.swift`.
  - `Api.kt` — cliente HTTP. Espejo de `ios/Sources/API.swift`.
  - `TokenStore.kt` — el token de sesión cifrado (Keystore). Espejo de
    `ios/Sources/Keychain.swift`.
  - `WebOta.kt` — las **reglas** del actualizador OTA del visor, sin Android ni
    red, para poder probarlas en la JVM. Espejo de la lógica de
    `ios/Sources/WebOTAUpdater.swift`.
- `app/src/main/assets/web/` — visor web construido (copiado de `../dist` por
  `scripts/copy-webdist.sh`; git-ignored, igual que `ios/WebDist/`).
- `app/src/test/` — pruebas JVM: contrato de red, reglas OTA y el manifiesto
  **real de producción** como caso de verdad.

## Requisitos

No hace falta Android Studio para compilar ni pasar las pruebas:

```sh
brew install openjdk@17 gradle
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
sdkmanager --sdk_root="$HOME/Library/Android/sdk" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

`local.properties` (git-ignored) apunta al SDK. Mínimo **Android 10** (API 29),
objetivo API 35.

## Compilar y probar

```sh
npm run build                    # en la raíz del repo
android/scripts/copy-webdist.sh  # dist/ → assets del visor incrustado
cd android
./gradlew testDebugUnitTest      # pruebas JVM (no necesitan móvil ni emulador)
./gradlew assembleDebug          # APK en app/build/outputs/apk/debug/
```

Para instalarlo en el móvil (fase 2, hace falta el dispositivo enchufado con
depuración USB activada):

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Decisiones que conviene no deshacer sin pensar

**`X-Auth-Mode: token` en todas las peticiones.** Sin esa cabecera el backend
contesta en modo cookie, que una app nativa no puede aprovechar.

**Los campos opcionales se OMITEN, no se mandan como `null`.** El backend
distingue "no lo sé" de "ponlo a null": mandar nulos borraría la actividad o el
plan en vez de dejarlos como estaban. Por eso los cuerpos JSON se construyen a
mano en `Api.kt` en vez de serializar el modelo entero.

**Los epoch son MILISEGUNDOS** y en `Double`, no `Long`: el backend puede mandar
decimales.

**Todo campo nuevo es nullable.** Un cliente publicado tiene que sobrevivir a un
backend antiguo que aún no manda `pinned`/`activity`, y al revés (por eso
`ignoreUnknownKeys`).

**El HTML del visor no se verifica por hash.** `functions/_middleware.ts` lo
reescribe al servirlo (og:* a URLs absolutas), así que los bytes servidos nunca
coinciden con los del build. Se valida por estructura: que exista y que cite un
módulo `assets/*.js` del propio manifiesto — eso es lo que impide activar el
`index.html` de un build con los assets de otro, el escenario que deja el visor
en blanco.

**El OTA es todo o nada.** Se descarga a staging, se verifica entero y solo
entonces se promociona. Cualquier fallo deja la copia activa intacta.

## Lo que falta (fase 2, con el móvil delante)

- `LocationManager` / `TrackingStore`: servicio en primer plano con
  `foregroundServiceType="location"`, cola de envío y retención de la traza.
- Permiso de ubicación en segundo plano: se pide en un **segundo** paso, después
  de conceder la de primer plano. Pedirlos juntos hace que Android lo rechace en
  silencio.
- **Samsung / One UI** (el dispositivo de pruebas es un Galaxy A26): hay que
  sacar la app de "aplicaciones inactivas" y poner la batería en "sin
  restricciones", o el sistema mata el seguimiento. Se documentará aquí con los
  pasos exactos una vez comprobado en el aparato.
- Cámara y audio de las notas, caché de teselas en disco, paquetes
  `.slsnsguide` (formato ya especificado en `../docs/slsnsguide-v1.md`), y las
  pantallas Compose.
