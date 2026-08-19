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
  - `TrackingRules.kt` — las **reglas** del seguimiento (ritmo de envío, recorte
    de la traza, tope del atasco, deducción del tipo de movimiento, filtros de
    lecturas malas), otra vez sin Android ni red. Espejo de la lógica de
    `ios/Sources/TrackingStore.swift` y `LocationManager.swift`.
  - `LocationEngine.kt` — el GPS. Usa el `LocationManager` de la plataforma, no
    los servicios de Google Play: en montaña no queremos depender de un
    componente que puede faltar o estar caducado en el aparato.
  - `TrackingStore.kt` — la sesión viva: crea, registra, persiste y sube.
    Singleton de aplicación porque quien reanuda tras una muerte del proceso no
    es la interfaz, es el servicio.
  - `TrackingService.kt` — el servicio en primer plano (`location`) con su
    notificación permanente. Sin él Android deja de entregar posiciones a los
    pocos minutos de apagarse la pantalla.
  - `LocalStore.kt` — lo que sobrevive a que el sistema mate la app: atasco,
    traza, notas y estado activo, en escritura atómica.
  - `MediosNota.kt` — foto y voz de las notas. Todo se encoge antes de
    guardarlo: lo que se sube se sube desde el monte, y una foto de 4 MB puede
    no llegar nunca mientras que la misma a 1600 px sí llega.
  - `PoiTypes.kt` — la taxonomía de las notas de campo. Espejo de
    `shared/poiTypes.ts` y de `ios/Sources/PoiTypes.swift`: **los tres van a la
    vez**, con los mismos slugs, etiquetas y emojis.
  - `MainActivity.kt`, `PantallaSesiones.kt`, `PantallaNotas.kt` — las pantallas
    Compose: entrar, compartir, "Mis seguimientos" y las notas de campo.
  - `VisorWeb.kt` — el visor incrustado: el MISMO código web que ve quien te
    sigue, servido entero desde el móvil. Espejo de `AppWebSchemeHandler.swift`.
  - `WebAssetStore.kt` — de dónde salen sus ficheros: copia OTA activa si la
    hay, si no la empaquetada en el APK.
  - `WebOtaUpdater.kt` — descarga y activa versiones nuevas del visor. Las
    reglas de qué se acepta están en `WebOta.kt`, probadas en la JVM.
  - `ViewerData.kt` — el estado que el visor pide a `/api/track/:id`, fabricado
    con la traza local en vez de traído de la red.
  - `TileCache.kt` — teselas del mapa en disco, con la política de OSM.
- `app/src/main/assets/web/` — visor web construido (copiado de `../dist` por
  `scripts/copy-webdist.sh`, o `copy-webdist.ps1` en Windows; git-ignored, igual
  que `ios/WebDist/`).
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

## En Windows

El desarrollo funciona igual; solo cambian tres cosas: `gradlew.bat` en vez de
`./gradlew`, el script del visor es `copy-webdist.ps1` (PowerShell, porque el
`.sh` usa rsync) y el SDK se localiza por la variable `ANDROID_HOME`.

```powershell
winget install EclipseAdoptium.Temurin.17.JDK
winget install Google.AndroidStudio     # trae SDK, adb y drivers
winget install OpenJS.NodeJS.LTS Git.Git

# En una terminal NUEVA (para que las variables estén puestas):
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"

npm install
npm run build
.\android\scripts\copy-webdist.ps1
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
```

`local.properties` no hace falta si `ANDROID_HOME` está puesta; Android Studio lo
crea solo la primera vez que abre la carpeta `android/`.

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

**El Bloqueo automático de Samsung deja la depuración USB en gris.** Comprobado
en el Galaxy A26 de pruebas (One UI 8, Android 16): mientras esté activo, los
interruptores de "Depuración USB" y "Depuración inalámbrica" salen
deshabilitados **y sin ningún mensaje que explique por qué**, aunque el modo
desarrollador esté activado y el cable puesto en "Transferencia de archivos".
Se apaga en Ajustes → Seguridad y privacidad → Bloqueo automático. El resto de
Opciones de desarrollo sí se deja tocar, y eso despista: parece un móvil
gestionado por Knox cuando no lo es.

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

## Decisiones de la fase 2

**El GPS es el gasto, no la subida.** Los tres perfiles (Equilibrado / Ahorro /
Alta precisión) no cambian cada cuánto se sube: cambian lo que se le pide al
GPS. Y por eso el filtro de distancia se traslada al propio `LocationManager` en
vez de descartar arriba lecturas ya calculadas — una posición descartada ya se
ha pagado. Parado, en modo distancia, el aparato no gasta.

**Primero se registra, luego se envía.** Cada posición se guarda en disco antes
de intentar subirla, y la subida es un paso aparte que se reintenta. Sin
cobertura no se pierde nada, que es lo único que de verdad importa aquí. Se
escribe en cada posición y no cada N: en Android el sistema mata el proceso sin
avisar, y lo que no esté en disco en ese momento se ha perdido.

**El servicio en primer plano no es opcional.** Sin `foregroundServiceType=
"location"` y su notificación permanente, Android deja de entregar posiciones a
los pocos minutos de apagarse la pantalla — y no avisa: las lecturas dejan de
llegar sin más, que es el fallo más difícil de diagnosticar de toda la app.
Desde Android 14 el permiso de ubicación tiene que estar **ya concedido** al
llamar a `startForeground`, así que la pantalla pide permisos antes de arrancar
el servicio y nunca al revés.

**El permiso de segundo plano se pide en un SEGUNDO paso**, después de conceder
el de primer plano. Pedirlos juntos hace que Android rechace la petición en
silencio: no sale ningún diálogo y el permiso se queda sin dar.

**El latido se le pide al GPS, no a un temporizador de la app.** Esta es la
decisión menos evidente del archivo y la que costó una traza cortada en la
primera prueba real. Parado y en modo distancia el GPS no entrega nada, así que
los puntos los tiene que generar algo cada 150 s; ese algo NO puede ser un
`Handler.postDelayed`, porque cuenta con `uptimeMillis`, que **se detiene cuando
la CPU se suspende con la pantalla apagada** (que el móvil esté cargando no lo
evita: eso solo impide el modo Doze, no la suspensión). El síntoma es
traicionero — el servicio sigue vivo, no hay ningún error en el log, y la traza
simplemente deja de crecer. Por eso [LocationEngine] engancha un **segundo
listener solo por tiempo**: es el subsistema de ubicación quien despierta la CPU
para entregar cada lectura, y entre una y otra el móvil puede seguir durmiendo.

**Ese segundo enganche obliga a filtrar repeticiones.** El sistema entrega la
MISMA lectura a los dos listeners, así que sin `esRepetida` cada posición se
registraría y se subiría por duplicado (visto en la primera prueba de campo:
tres puntos con el mismo instante). La firma buena es el instante del fix, no
las coordenadas — estar parado repite coordenadas legítimamente.

**En modo distancia, el tiempo mínimo del GPS no es un detalle.** En Android el
filtro de distancia lo aplica el *framework*, no el aparato: el GPS se enciende
al ritmo del tiempo mínimo aunque nadie se mueva. Con un valor corto, el perfil
"Ahorro" tendría el GPS en continuo — justo lo que promete no hacer. Está en 15 s
como compromiso: andando, 100 m son unos 72 s, así que sobra; en bici son ~18 s
y el tramo se detecta con una lectura de retraso.

**El visor se sirve desde `appassets.androidplatform.net`, no desde un esquema
propio.** En iOS hay que inventarse `appweb://` porque WebKit no deja
interceptar http/https. En Android sí se puede, y usar el dominio reservado da
además un **origen seguro**: bajo un esquema propio el visor perdería las APIs
web que solo funcionan con https y fallaría de formas que cuesta relacionar con
la causa.

**Descontar las barras del sistema es obligatorio con targetSdk 35+.** Desde
Android 15 la app se dibuja de borde a borde por defecto: sin
`safeDrawingPadding` el título queda debajo del reloj y los botones de abajo,
tapados por la barra de navegación. Se vio en la primera captura del visor.

**Tras registrar una posición se mantiene la CPU despierta un minuto.** La
entrega de la lectura despierta el móvil lo justo para el callback; si se vuelve
a dormir con la subida a medias, el atasco crece sin que falle nada visible. El
bloqueo se coge **siempre con plazo**, nunca indefinido: uno colgado por un fallo
se comería la batería de toda la travesía.

## Lo que falta (fase 2, con el móvil delante)

- **Comprobar en el aparato lo que solo se comprueba andando**: que la traza no
  se corta con la pantalla apagada, cuánto dura la batería con cada perfil, y si
  One UI mata el servicio en una travesía larga.
- **Samsung / One UI** (el dispositivo de pruebas es un Galaxy A26): sacar la
  app de "aplicaciones inactivas" y poner la batería en "sin restricciones". La
  app ya detecta si sigue optimizada y ofrece quitarlo, pero falta confirmar en
  el aparato si con eso basta o hace falta además lo de aplicaciones inactivas.
- Reanudar al reiniciar el móvil (`BOOT_COMPLETED`): hoy se reanuda si el
  sistema mata el proceso (`START_STICKY` + estado en disco), pero un reinicio
  completo deja la sesión parada hasta que se abre la app.
- **Medir la cadencia real del latido en la calle.** En la primera prueba con la
  pantalla apagada entró **un punto en 6,7 minutos**, no uno cada 150 s: el
  sistema difiere la entrega mientras el móvil está suspendido, y dentro de un
  edificio el GPS además pierde el enganche. Hay que ver cuánto se separa al aire
  libre antes de dar por buena la cadencia — si se confirma el retraso, el visor
  daría "señal perdida" a quien solo se ha parado a comer.
- **El recorrido se infla estando parado.** En la prueba marcó 368 m sin
  moverse: la distancia se suma punto a punto y el ruido del GPS se acumula. Lo
  mismo pasa en iOS (`trailDistanceMeters` suma todo). Habría que descartar los
  saltos por debajo de la precisión de la lectura antes de sumarlos.
- **Descarga por adelantado del corredor de una ruta** (la noche antes de
  salir): la caché de teselas se llena hoy según se mira el mapa, pero no sabe
  precargar. Es lo que en iOS hace `TileCache.tiles(for:)` + `MapDownloadView`.
- Overlay del plan en el visor (`/api/share/:id`) y el factor de forma
  confirmado por quien camina (`/api/track/:id/form`).
- Paquetes `.slsnsguide` (formato ya especificado en
  `../docs/slsnsguide-v1.md`).
