# Google Play: SiLoSeNoSalgo

Todo lo de la publicación en Google Play: cuenta, decisiones, lo que se contestó en
cada formulario y cómo sacar la siguiente versión. Paquete
`com.themakercrowd.silosenosalgo`.

## Estado

| Fecha | Qué |
|---|---|
| 2026-09-27 | Paquete registrado y verificado en *Android developer verification* (clave de la APK de GitHub). |
| 2026-09-27 | Versión **774 (1.0)** enviada a revisión en **Producción**, lanzamiento completo, solo **España**. |

Pendiente:
- Añadir **todos los países de la UE** (o todos) en *Production → Countries/regions*,
  para no chocar con el Reglamento (UE) 2018/302 de geobloqueo. No pide nueva revisión.
- La traducción **en-US** de la ficha (textos abajo), si no se llegó a añadir.
- La App Store pedirá lo mismo: cuenta de revisión (`app-review`), borrar cuenta desde
  la app (ya está en iOS) y motivos de la ubicación en segundo plano.

## La cuenta

- **Cuenta de desarrollador**: *TheMakerCrowd*, de **organización** (Inocuo Sistemas
  Informáticos SL), ID 4797191313104859604. Se entra con la cuenta de Google
  **maker@6996.es** (no con jm@jose.es). Al ser de organización, no hace falta la prueba
  cerrada de 12 probadores y 14 días.
- **Consola**: https://play.google.com/console . Si abre la página pública de «sign up»,
  entrar por https://accounts.google.com/AccountChooser?continue=https://play.google.com/console/developers
  y elegir maker@6996.es.
- **Correo de avisos**: los de Google Play llegan a maker@6996.es.

## Verificación de desarrollador de Android

Desde septiembre de 2026 Android exige que las apps instaladas en móviles certificados
(también las que se instalan fuera de Play) sean de un desarrollador verificado. En
*Android developer verification* está registrado el paquete con la clave con la que se
firma la **APK de GitHub**:

    SHA-256  B7:3B:5A:AB:28:C7:D6:5C:E7:A7:7C:02:9C:94:3B:AB:E7:C5:64:07:F6:90:6C:F6:79:5D:62:03:7F:E4:86:CD
    DN       CN=TheMakerCrowd, O=Inocuo Sistemas Informáticos SL, C=ES

Para demostrar que la clave era nuestra se subió un APK de release firmado con ella que
llevaba `android/app/src/main/assets/adi-registration.properties` con el código que dio
la consola (`C3GKHMDH37IJEAAAAAAAAAAAAA`). El fichero se queda en el repositorio: no
estorba y vale si hay que volver a demostrarlo. Si algún día se cambia la clave, hay que
registrar la nueva («Add key»). La huella se lee sin contraseña:
`apksigner verify --print-certs SiLoSeNoSalgo.apk`.

## Decisiones

- **Firma**: *Play App Signing* con clave generada por Google. Nuestra clave de release
  (`keystore.properties`) es la **clave de subida**. Consecuencia: la app de Play y la APK
  de GitHub tienen firmas distintas; quien tenga una tiene que desinstalarla para
  instalar la otra.
- **Variante `play`** (`./gradlew bundlePlay`, `app/src/play/`, `BuildConfig.TIENDA_PLAY`),
  porque Play no deja a una app suya:
  - avisar de APKs nuevas en GitHub (una app de Play solo se actualiza por Play);
  - pedir la exención de batería directa (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`): lleva a
    la lista de ajustes;
  - leer la galería entera (`READ_MEDIA_IMAGES`) si no es su función principal: las fotos
    de una ruta se eligen con el selector de Android, sin búsqueda automática por horas.
    La APK de GitHub conserva la búsqueda.
- **Aviso de ubicación** («Tu ubicación»), en todas las variantes: antes de cualquier
  petición del sistema, dice qué se recoge, para qué y que sigue con la app cerrada. Es la
  *divulgación destacada* que exige Play para la ubicación en segundo plano.
- **Borrar la cuenta**: en la app (*Mi cuenta → Borrar la cuenta*, Android e iOS) y sin la
  app en https://silosenosalgo.themakercrowd.com/borrar-cuenta (`public/borrar-cuenta.html`,
  `functions/api/auth/borrar.ts`, `functions/lib/borrarCuenta.ts`). Los eventos creados
  con más participantes pasan a otro; en clasificaciones guardadas el nombre queda como
  «Cuenta borrada».
- **Cuentas por invitación**: se permite en Play, pero hace falta una cuenta para los
  revisores y decirlo en la ficha (lo dice la última línea de la descripción).
- **Declaración de IA en los recursos**: «Don't label assets» (capturas reales, icono y
  gráfico dibujados con código).
- **Managed publishing**: desactivado; lo aprobado se publica solo.

## Cuenta de revisión

Usuario **`app-review`** (sirve también para Apple). La contraseña está solo en la
consola (*App content → App access*) y en el gestor del dueño; no se escribe en ningún otro
sitio. Se creó con una invitación de un solo uso.

Tiene una salida **inventada** para que los revisores vean tramos, pausas y la maqueta:
«Barcelona: Rambla, barco y Ciutadella» (id `7US_AA3rzIP_GTOk5GMV7A`, fijada con la
chincheta). No se le copian datos reales de nadie.

## El paquete

```sh
android/scripts/copy-webdist.sh           # la web, dentro de la app
cd android && ./gradlew bundlePlay        # → app/build/outputs/bundle/play/app-play.aab
```

Es la variante `play` (ver `app/build.gradle.kts` y `app/src/play/`): sin aviso de
APKs de GitHub, sin pedir la exención de batería directa y sin permiso de galería.
Se firma con nuestra clave, que en Play hace de **clave de subida**; la de firma la
genera Google (Play App Signing). Quien tenga la APK de GitHub tendrá que
desinstalarla para pasar a la de Play.

## Imágenes

`node android/play/genera-ficha.mjs` → `ficha/` (a partir de `origen/`):

- Icono 512×512: `android/app/src/main/ic_launcher-playstore.png`
- Gráfico destacado 1024×500: `ficha/grafico-destacado.png`
- Capturas de teléfono 1080×1920: `ficha/telefono-01.png` … `telefono-08.png`

## Ficha (es-ES, idioma por defecto)

**Nombre** (30): `SiLoSeNoSalgo`

**Descripción breve** (80):

> Tu baliza GPS: que te sigan en directo en tus salidas, rutas y carreras.

**Descripción completa**:

> SiLoSeNoSalgo convierte tu móvil en una baliza GPS. Ármala al salir y comparte un enlace: quien lo tenga ve en el mapa por dónde vas, en directo, sin instalar nada ni tener cuenta.
>
> TUS SALIDAS
> • Seguimiento en directo con la pantalla bloqueada, con una notificación mientras la baliza está armada.
> • En «Automático», la salida se parte sola en tramos a pie, corriendo, en bici, en coche, en tren o en barco, con la distancia, el tiempo y el ritmo de cada uno. Si alguno no es, lo cambias en el mapa.
> • Notas con foto o nota de voz, en el sitio donde las tomas.
> • Añade después las fotos que hiciste durante la ruta: cada una va donde estabas a esa hora.
> • Pausas con nombre y emoji («🍽️ Cena»).
>
> CARRERAS
> • Apúntate a una carrera y os veis todos en el mismo mapa.
> • Cuenta atrás, recorrido con controles y cierres, previsión de paso y porra entre amigos.
> • El replay de la carrera cuando termina.
>
> MAQUETA 3D Y VÍDEO
> • Cualquier salida o carrera en una maqueta 3D del terreno.
> • Un vídeo para compartir: el recorrido avanzando, tus fotos donde las hiciste y, si quieres, la luz real de aquel día, del amanecer a la noche.
>
> EN EL MAPA
> • Tu posición y hacia dónde miras, y a cuánto estás de la ruta.
> • Radar de lluvia, perfil del recorrido y mapas descargados para ir sin cobertura.
>
> PRIVACIDAD
> • La ubicación solo se registra mientras la baliza está armada, y la armas tú.
> • Los seguimientos caducan solos. Sin publicidad, sin analítica y sin venta de datos.
> • Puedes borrar tu cuenta cuando quieras, desde la app.
>
> Las cuentas se crean por invitación, desde la web.

**Notas de la versión** (500):

> Primera versión en Google Play: baliza en directo, salidas por tramos, carreras, maqueta 3D con vídeo y tu posición en el mapa.

## Ficha (en-US, traducción)

**Short description**:

> Your GPS beacon: let people follow you live on outings, routes and races.

**Full description**:

> SiLoSeNoSalgo turns your phone into a GPS beacon. Arm it when you head out and share a link: anyone with it sees where you are on the map, live, with nothing to install and no account.
>
> YOUR OUTINGS
> • Live tracking with the screen locked, with a notification while the beacon is armed.
> • In "Automatic", the outing splits itself into legs on foot, running, by bike, car, train or boat, with distance, time and pace for each. If one is wrong, fix it on the map.
> • Notes with a photo or a voice memo, pinned where you took them.
> • Add the photos you took during the route afterwards: each one goes where you were at that time.
> • Named stops with an emoji ("🍽️ Dinner").
>
> RACES
> • Join a race and see everyone on the same map.
> • Countdown, course with checkpoints and cut-offs, split forecasts and a betting pool among friends.
> • The race replay when it's over.
>
> 3D MODEL AND VIDEO
> • Any outing or race on a 3D model of the terrain.
> • A video to share: the route unfolding, your photos where you took them and, if you like, the real light of that day, from dawn to night.
>
> ON THE MAP
> • Your position and which way you're facing, and how far you are from the route.
> • Rain radar, route profile and downloaded maps for no-coverage areas.
>
> PRIVACY
> • Location is only recorded while the beacon is armed, and you arm it.
> • Tracks expire on their own. No ads, no analytics, no selling of data.
> • Delete your account whenever you want, from the app.
>
> Accounts are created by invitation, from the web.

## Datos de la app y de contacto

- **Categoría**: Deportes. **Etiquetas**: Senderismo, Running, Navegación.
- **Correo de contacto**: dev@themakercrowd.com
- **Sitio web**: https://silosenosalgo.themakercrowd.com
- **Política de privacidad**: https://silosenosalgo.themakercrowd.com/privacidad
- **Borrar la cuenta (URL)**: https://silosenosalgo.themakercrowd.com/borrar-cuenta

## Contenido de la aplicación (formularios)

**Acceso a la aplicación**: toda la funcionalidad necesita cuenta. Instrucciones:
«Entra con el usuario y la contraseña indicados. Para ver una salida en directo,
en Baliza toca «Compartir · sin carrera»; en Archivo están las salidas guardadas.»
La cuenta de revisión se crea con una invitación desde la web de administración;
usuario y contraseña se escriben directamente en la consola.

**Anuncios**: no contiene anuncios.

**Clasificación de contenido** (cuestionario IARC), categoría «Todas las demás
aplicaciones»: sin violencia, sexo, lenguaje, drogas ni apuestas con dinero.
- ¿Los usuarios pueden interactuar o intercambiar contenido? **Sí** (ánimos y fotos en eventos).
- ¿Se comparte la ubicación del usuario con otros? **Sí** (es la función de la app).
- ¿Compras digitales? **No**.

**Público objetivo**: 16 años o más (16-17 y 18+). No está dirigida a niños.

**Seguridad de los datos**:
- ¿Recoge o comparte datos? **Sí recoge; no comparte** con terceros (lo que ve quien
  tiene tu enlace lo decides tú, y Play no lo cuenta como «compartir»).
- ¿Cifrado en tránsito? **Sí** (HTTPS). ¿Se puede pedir que se borren? **Sí**
  (en la app y en la URL de arriba).

| Tipo de dato | Recogido | Opcional | Para qué |
|---|---|---|---|
| Ubicación precisa | Sí | No | Funcionalidad de la app |
| Ubicación aproximada | Sí | No | Funcionalidad de la app |
| Información personal → ID de usuario (nombre de usuario) | Sí | No | Funcionalidad, gestión de la cuenta |
| Fotos | Sí | Sí | Funcionalidad de la app (fotos de notas y de eventos) |
| Audio → grabaciones de voz | Sí | Sí | Funcionalidad de la app (notas de voz) |
| Salud y forma física → información de actividad física | Sí | Sí | Funcionalidad de la app (tramos por medio de transporte) |
| Actividad en la app → otro contenido generado por el usuario | Sí | Sí | Funcionalidad de la app (notas, pausas con nombre) |

Nada de analítica, publicidad, identificadores de dispositivo ni informes de fallos.

**Funciones de salud**: Actividad física y fitness.

**Servicios gubernamentales, funciones financieras, noticias**: no.

## Declaraciones de permisos

**Ubicación en segundo plano** (`ACCESS_BACKGROUND_LOCATION`):

> SiLoSeNoSalgo es una baliza GPS: comparte la posición en directo de quien la arma con las personas que tienen su enlace, durante salidas de montaña, rutas y carreras que duran horas. El móvil va guardado y con la pantalla bloqueada; si la ubicación se cortara al salir de la app, quien sigue a esa persona dejaría de verla justo cuando más importa (una caída, perderse, un retraso). La ubicación en segundo plano solo se recoge mientras la baliza está armada —lo hace el usuario a mano— y hay una notificación permanente todo ese tiempo. Antes de pedir el permiso, la app explica en un aviso propio qué se recoge, para qué y que sigue con la app cerrada.

Vídeo: 30-60 s grabado en un móvil con cuenta (ver abajo), subido a YouTube como «oculto».

**Servicio en primer plano** (tipo `location`): mismo texto; tarea: «Seguimiento de
la ubicación del usuario mientras la baliza está armada, con la pantalla bloqueada».
Mismo vídeo.

### El vídeo de la ubicación en segundo plano

En un Android con la app de Play (o la de GitHub) y una cuenta, grabando la pantalla:

1. Borrar los datos de la app (Ajustes → Apps → SiLoSeNoSalgo → Almacenamiento) y abrirla.
2. Entrar: sale el aviso «Tu ubicación» → Aceptar → «Mientras se usa la aplicación» →
   «Permitir siempre».
3. En Baliza, «Compartir · sin carrera» → la baliza en marcha y su notificación.
4. Bloquear el móvil unos segundos, desbloquear y enseñar que la traza sigue.

## Lo que se contestó en la consola (resumen)

- **Acceso**: restringido, con la cuenta `app-review` y las instrucciones de la guía
  (en inglés y en español).
- **Anuncios**: no. **ID de publicidad**: no se usa (el manifiesto no lleva `AD_ID`).
- **Clasificación de contenido**: interacción entre usuarios sí (ánimos, fotos), el
  contenido de usuarios no es lo principal, sin desnudos ni violencia, comparte la
  ubicación con otros sí, sin compras ni apuestas con dinero.
- **Público**: 16-17 y 18+. No dirigida a niños.
- **Seguridad de los datos**: recoge y no comparte; cifrado en tránsito; cuentas con
  usuario y contraseña; URL de borrado de cuenta `…/borrar-cuenta` y de borrado de datos
  `…/borrar-cuenta#datos`. Tipos: ubicación aproximada y precisa, ID de usuario, fotos,
  grabaciones de voz, información de forma física, otros mensajes en la app (ánimos),
  otro contenido generado por el usuario y *Device or other IDs* (el identificador
  anónimo de quien mira una baliza). Todos recogidos, no compartidos, no efímeros;
  obligatorios la ubicación, el ID de usuario y el de dispositivo; para qué: funcionalidad
  (y gestión de la cuenta en el ID de usuario).
- **Salud**: *Activity and fitness*; sin Health Connect.
- **Categoría**: Deportes. **Contacto**: dev@themakercrowd.com, sitio web y sin teléfono.

## Textos enviados en las declaraciones de permisos

Vídeo (YouTube, oculto, canal «the Maker Crowd»):
**https://www.youtube.com/watch?v=xUvBS2pLLOg** — también en `ubicacion-segundo-plano.mp4`.
Se grabó en el emulador con la variante de depuración en modo de prueba, que arma la
baliza en local sin cuenta (`PruebaDePantalla` + `TrackingStore.empieza`).

**Ubicación en segundo plano · App purpose**

> SiLoSeNoSalgo is a GPS beacon for hiking, running and races. The user arms the beacon before heading out and shares a link: anyone with the link sees their live position on a map, so family, friends or race organisers can follow them and raise the alarm if something goes wrong. The app also saves each outing (route, notes, photos) and splits it by mode of transport.

**Ubicación en segundo plano · Location access**

> Live beacon: while the user has manually armed the beacon, the app records GPS positions and sends them to our server, so the people with the link see where the user is in real time. Outings last hours with the phone in a pocket and the screen locked, so location must keep being collected in the background. A persistent notification is shown the whole time and collection stops when the user stops the beacon. This is explained in the in-app disclosure shown before the permission prompt.

**Servicio en primer plano** (`FOREGROUND_SERVICE_LOCATION`) · tarea *User-initiated location sharing*

> The user arms the beacon to share their live location with the people who have their link during outings and races that last hours, with the phone in a pocket and the screen locked. The foreground service shows a persistent notification the whole time and stops when the user stops the beacon.

**Reconocimiento de actividad** (`ACTIVITY_RECOGNITION`)

> Only in outings set to "Automatic" (no route or race): while the beacon is armed, the app reads Android's activity recognition (still, walking, running, cycling, in vehicle) to split the recorded route into legs by mode of transport, with distance, time and pace for each. Only that mode hint is stored with each GPS position. It is not used for ads, analytics or health tracking, and the user is asked for the permission when starting such an outing.

## Avisos que se pueden ignorar

- *No deobfuscation file*: el código no se ofusca (R8 apagado).
- *Native code without debug symbols*: la única parte nativa es `libandroidx.graphics.path.so`
  de Compose. Está alineada a 16 KB, como exige Play desde noviembre de 2025.

## La siguiente versión

```sh
android/scripts/copy-webdist.sh
cd android && ./gradlew bundlePlay        # app/build/outputs/bundle/play/app-play.aab
```

1. *Test and release → Production → Create new release*, subir el `.aab` y las notas en
   `<es-ES>…</es-ES>`. El `versionCode` son los commits de git, así que siempre sube.
2. *Publishing overview → Send changes for review*.
3. Si la web cambia sin tocar lo nativo, no hace falta versión nueva: la app descarga la
   web nueva sola (OTA).
4. Si cambian permisos, sensores o datos que se recogen, revisar *App content* (seguridad
   de los datos y declaraciones) antes de enviar.
5. La APK de GitHub sigue su camino: `./gradlew assembleRelease` y `gh release create`.
6. Desde la 788 las versiones de release van con **R8** (encogidas y ofuscadas, lo pedía
   el aviso «DEX code optimization»). El mapa para leer los fallos va dentro del `.aab`
   y Play lo coge solo; el de la APK queda en `app/build/outputs/mapping/release/`.
   Si algo falla solo en release, sospechar primero de R8: las reglas están en
   `app/proguard-rules.pro`.
