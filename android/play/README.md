# Google Play: todo lo que pide la consola

Cuenta de desarrollador de **empresa** (Inocuo Sistemas Informáticos SL): no hace
falta la prueba cerrada de 14 días. Paquete `com.themakercrowd.silosenosalgo`.

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
