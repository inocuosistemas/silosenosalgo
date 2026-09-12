# Registro de cambios

Qué ha cambiado, en cuál de las tres piezas —**web**, **Android**, **iOS**— y,
lo importante: **si obliga a actualizar la app o no**.

La web y las apps se despliegan por separado y nunca a la vez. Entre un
despliegue web y el reparto del APK siguiente pueden pasar semanas, y durante
todo ese tiempo hay gente corriendo con la versión vieja. Este fichero existe
para saber, sin tener que reconstruirlo de memoria, qué versión mínima hace
falta para que algo funcione.

## Cómo se lee

Cada entrada lleva una de estas etiquetas:

| Etiqueta | Qué significa |
|---|---|
| **Compatible** | La app instalada sigue funcionando igual. No hay que hacer nada. |
| **Requiere actualizar** | La app vieja deja de funcionar (o pierde algo). Hay que repartir versión nueva antes de contar con ello. |
| **Mejora al actualizar** | La app vieja funciona, pero no ve lo nuevo. Se actualiza cuando toque. |

## Por qué casi todo es compatible

No es suerte, es una decisión de diseño que conviene no perder:

- **Los dos clientes toleran campos que no conocen.** Android usa
  `Json { ignoreUnknownKeys = true }` (`Api.kt`) y en Swift `Codable` ignora las
  claves de más por defecto. Un campo nuevo en una respuesta no puede tumbar a
  nadie.
- **Los campos opcionales toleran ausencias.** En Kotlin llevan valor por
  defecto y en Swift son `Optional`, así que una app nueva contra un servidor
  viejo tampoco se rompe.
- **La base de datos solo crece.** Las migraciones son `ADD COLUMN` y
  `CREATE TABLE`, nunca `DROP`.

**Lo que SÍ rompería una app instalada**, y por tanto obliga a repartir versión
antes de tocarlo:

- Quitar o renombrar un campo que la app lee, o cambiarle el tipo.
- Cambiar el significado de un campo (unidades, huso horario, base de un
  porcentaje) sin cambiarle el nombre: es lo peor de todo, porque no falla —
  miente.
- Retirar un endpoint o exigir una cabecera o un parámetro nuevo.
- Cambiar la forma de autenticarse.

Cuando haya que hacer alguna de esas, la regla es: **añadir lo nuevo al lado, no
sustituir**; repartir la app; y solo entonces, mucho después, retirar lo viejo.

## Estado actual

| Pieza | Versión | Al día |
|---|---|---|
| Web | continuo (`npm run deploy`) | sí |
| Android · móvil propio | debug, del 281 | **no**: el de desarrollo se queda como estaba; se pone al día con `./gradlew installDebug` |
| Android · APK de reparto | 1.0 (**453**) publicado en GitHub Releases | sí. **Enlace fijo al último APK**, el que se manda a quien prueba: `https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk`. El compañero sigue con el **271** |
| iOS | 1.0 (**453**) subida a TestFlight el 2026-09-11 (antes el 442, 443, 444, 447 y 450) | sí, en cuanto salga de *Processing* |

El `versionCode` de Android es el número de commits (`build.gradle.kts`), así
que sirve para saber exactamente qué lleva dentro un APK: el 271 se compiló en
el commit 271.

## Cómo llega cada versión a quien la prueba

| Pieza | Camino |
|---|---|
| Web | `npm run deploy` (Cloudflare Pages). Las apps recogen el visor nuevo por OTA. |
| iOS | `ios/scripts/sube-a-testflight.sh` → TestFlight, probadores internos, sin revisión de Apple. |
| Android | `./gradlew assembleRelease` y se publica el APK como *release* de GitHub. El enlace que se manda **no cambia nunca**: `https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk` |

Cada release lleva **el mismo APK dos veces**: como `SiLoSeNoSalgo.apk`, que es
lo que hace que el enlace de arriba funcione siempre, y como
`SiLoSeNoSalgo-1.0-<build>.apk`, para que en la carpeta de descargas se sepa
cuál es cuál. Son idénticos byte a byte; el enlace fijo exige que el primero
exista con ese nombre exacto, así que no se puede publicar solo el versionado.

Para saber qué versión hay publicada, sin cuenta de GitHub:
`…/releases/latest` redirige a la etiqueta (`/releases/tag/v1.0-449`), y
`https://api.github.com/repos/inocuosistemas/silosenosalgo/releases/latest`
devuelve el dato crudo, con la fecha y el número de descargas.

> El repositorio es público, así que ese APK lo puede descargar cualquiera que
> tenga el enlace. Dentro no va ningún secreto: la clave de firma no viaja en el
> APK, solo su firma. Es el mismo fichero que antes se mandaba por WhatsApp.

---

## 2026-09-13

### Un kilómetro conocido ya no se pierde

**Servidor · desplegado.** El ping guardaba el `trackKm` que mandara la app, y
cuando la app no puede calcularlo —fuera del trazado, dentro de un coche, sin
recorrido cargado— manda nulo. Se escribía encima y **se perdía el último
kilómetro conocido**, que es justo el dato que dice dónde se quedó alguien: los
cuatro de la CanFranc acabaron con el kilómetro vacío y hubo que reconstruirlo
proyectando sus coordenadas a mano. Ahora es un `COALESCE`: nulo significa "no he
podido calcularlo", nunca "estoy en el kilómetro ninguno".

### Cinco kilómetros fuera del recorrido ya no es carrera

**Web · desplegado.** La baliza de quien abandonó siguió emitiendo desde **174 km
de distancia y a 107 km/h** —la autovía, camino de casa— y el mapa lo pintaba
primero de la carrera. Ahora, a más de 5 km del trazado se da por retirado, en el
último kilómetro que hizo corriendo.

Cinco es generoso a propósito: en montaña el GPS se va y perderse de verdad son
cientos de metros. Esto saca gente de una clasificación, y equivocarse por
esperar de más no le hace daño a nadie.

### La carrera de verdad, rebobinada

**Web · desplegado.** `/?demo=canfranc-2026&en=2026-09-12T07:45` abre el mapa del
evento con la CanFranc-CanFranc **real** congelada en esa hora: sus cuatro
balizas, sus 1344 posiciones, su recorrido y sus cortes.

No es una maqueta con datos inventados. Sirve para ver cómo se comporta un cambio
ante lo que de verdad pasa en una carrera —una baliza que calla tres horas, otra
que acaba a 174 km, uno que se para hora y media a 2500 m— sin esperar a la
siguiente. Sin `en` se abre en el último instante registrado.

Los datos del evento quedan guardados en `tests/fixtures/canfranc-2026/`
(balizas con su traza entera, parrilla, evento y recorrido) para poder seguir
estudiándolos.

## 2026-09-12

### Dar a alguien por retirado, y decir desde cuándo

**Web · desplegado.** Una baliza encendida no dice si quien la lleva sigue en
carrera. En la CanFranc pasaron los tres casos el mismo día: uno se quedó parado
hora y media a 2500 m, otro volvió al pueblo de salida —y su app lo colocó en
meta, liderando la carrera—, y un tercero perdió cobertura durante horas **sin
haber abandonado**. Distinguirlos importa en las dos direcciones: un retirado que
sigue contando ensucia la clasificación, y dar por retirado a quien sigue vivo es
mucho peor.

La regla vive en `src/lib/abandono.ts` con nueve pruebas, y da tres señales, de
más segura a menos:

| Señal | Cuándo se dio por retirado |
|---|---|
| **Dio media vuelta** (desanda ≥ 1 km y sigue bajando) | en su kilómetro más lejano |
| **Avance imposible a pie** (más de 3× su propio ritmo) | en el último punto que hizo andando |
| **Parado y sin opción al corte** | cuando se paró |

Lo que se busca no es "cuándo nos hemos dado cuenta" sino **cuándo dejó la
carrera**, que es la hora que vale para la clasificación y la que se le cuenta a
su gente.

Los casos borde, que son la mitad del trabajo:

- **El silencio nunca es prueba.** Sin puntos frescos no se juzga a nadie: quien
  está en una zona de sombra sigue corriendo. Es el error que no se puede
  cometer.
- **Parado no basta.** En una ultra se duerme, se come y se cambia uno de ropa.
  Lo que convierte la parada en retirada es que, aunque se levantara ahora mismo
  y siguiera a SU ritmo, el corte ya no le diera.
- **Un rodeo corto no es media vuelta**: volver doscientos metros a por un bastón
  no es retirarse.
- **Quien ya está en meta** nunca abandona, por mucho que lleve horas quieto.
- **Sin ritmo demostrado** no se juzga: no hay con qué comparar.
- **Si vuelve a andar, vuelve a la carrera.** La regla no guarda memoria a
  propósito: se recalcula con lo que hay.

Y un detalle que costó un fallo: "parado" se mide en **velocidad**, no en metros.
Con un umbral de 150 m entre puntos, un corredor a 23 min/km —que en dos minutos
hace 87 m— nunca salía de "parado", y la parada parecía haber empezado horas
antes de cuando empezó.

En la lista, quien abandona deja de hablar de carrera: ni hueco ni margen al
corte significan nada para él. Su renglón dice **dónde y desde cuándo**, y sale
del cálculo de huecos de los demás.

### La lista se lee como una clasificación, y el tramo se abre a pantalla completa

**Web · desplegado.** Dos cosas encontradas corriendo.

**La lista del evento estaba ilegible.** El aviso largo de "sin cobertura" vivía
DENTRO de la misma línea flex que el ritmo, el margen y los mandos, y con un
`w-full` en medio: el resultado en un móvil era media docena de columnas de una
palabra por renglón —"sin / cobertura / hace 50 / min"—. Ahora la fila son tres
renglones con un trabajo cada uno: quién va y por dónde; cómo va (hueco, ritmo,
margen); y cómo está su baliza, con los mandos. Ninguno envuelve.

**Y el hueco con el de delante, como en una clasificación de ciclismo**: `▲ 1,9
km · 1 h 00`. Leyendo hacia abajo salen las dos preguntas —el de delante en tu
fila, el de atrás en la de debajo—, que es como ya se leen estas tablas. Sustituye
al "por delante / por detrás" respecto a ti de ayer, que obligaba a buscarse a uno
mismo primero. El tiempo va **a tu ritmo**, no al suyo: la pregunta es cuánto
tardarías TÚ en cerrarlo. Y no se enseña cuando pasa de seis horas, que entonces
es ruido, ni al líder, que lleva su medalla.

### Un tramo, a pantalla completa

**Web · desplegado.** En el seguimiento individual, tocar una tarjeta de tramo la
abre ampliada: la misma tarjeta con `zoom` de CSS —letra y dibujos crecen a la
vez, sin una segunda pantalla que mantener— y con el mapa y el perfil apilados a
todo lo ancho en vez de a media tarjeta cada uno.

El perfil pasa de 168×56 a 272×150. Eso es lo que quita el achatamiento: a la
medida vieja, los 1200 m de subida de un tramo de esta carrera se veían como una
rampa suave. Se pasa de tramo con ‹ › o con las flechas, y se cierra con Escape.

Arrastrar el carrusel ya no abre el zoom sin querer: diez píxeles de movimiento
separan un toque de un arrastre.

### Un corredor se quedaba clavado en un kilómetro que ya no era suyo

**Web · desplegado.** Encontrado EN CARRERA, en la CanFranc: la lista del mapa
del evento daba a un participante por el **km 2,7 y "fuera del recorrido ·
2620 m"**, con un margen en rojo de −2 h 25 ante un corte que en realidad tenía
de sobra. Su posición real era el km 17,1, a 16 m del trazado.

El kilómetro de quien NO lo manda se proyecta sobre el trazado en una ventana de
±3 km alrededor de su último kilómetro conocido. La ventana existe por una razón
buena —en un circuito que acaba donde empieza, una búsqueda global pone en el
km 0 al que acaba de cruzar meta— pero **no sabía recuperarse**: basta un rato
sin refrescar (la pantalla apagada, la pestaña en segundo plano) para que el
corredor avance más de lo que la ventana alcanza, y entonces se queda clavada
para siempre, porque cada refresco la vuelve a centrar en el kilómetro malo.

Ahora, cuando el punto que encuentra la ventana queda a más de 300 m del
corredor, se rehace la búsqueda en todo el recorrido y se acepta solo si está
**mucho** más cerca. Eso distingue una ventana descolgada —donde el punto bueno
está a metros— de alguien que de verdad va por otro valle, a quien se le sigue
avisando sin moverlo. Comprobado con los datos reales del caso: 2620 m → se
reengancha al km 17,14 a 16 m.

> Solo lo sufrían las balizas que **no mandan su kilómetro**, o sea Android con
> APK anterior al que lo calcula. Con `trackKm` en el ping no hay proyección que
> valga: manda el que lo calcula, que es quien va corriendo.

### Cuánto le llevas a cada uno

**Web · desplegado.** En la lista del mapa del evento, debajo de cada
participante: **"1,7 km por delante"** o **"2,3 km por detrás"** — respecto a ti.
Y tu propia fila marcada con un **"tú"**.

Lo que se quiere saber a las tres de la mañana no es que alguien va por el km
18,2, sino que te lleva 1,7. La resta la hacía uno de cabeza comparando dos
números; ahora la hace la pantalla. Con palabras y no con un signo: un "−1,7" se
lee mal en los dos sentidos cuando llevas cuatro horas corriendo.

Solo aparece con la sesión iniciada y si tú también corres esa carrera —sin un
"yo" no hay nada que restar— y solo entre quienes mandan kilómetro. En el enlace
público la lista se queda exactamente como estaba.

## 2026-09-11

### Cambiar el nombre de la salida sin salir de "En directo"

**iOS · en código** · *Mejora al actualizar*
**Android · en código** · *Mejora al actualizar*
**Web** · no aplica.

Renombrar una salida en marcha ya se podía, pero había que bajar hasta "Mis
seguimientos" y buscar la propia sesión entre las anteriores. Se le ocurre a uno
a mitad de ruta —"esto no era un entrenamiento, era la carrera"— y donde se está
mirando entonces es en **En directo**: ahí está ahora el nombre, con su botón de
renombrar al lado. El enlace ya compartido no cambia: el nombre es una etiqueta,
el token es otra cosa.

Y con él, un fallo de Android que solo se veía al reabrir la app:
`renombraSesion` avisaba al servidor y recargaba la lista —así que la fila se
veía bien— pero no tocaba `Estado.titulo`, que es lo que se guarda en disco para
reanudar y lo que alimenta el visor incrustado (`ViewerData`). O sea: renombrabas
a mitad de carrera, cerrabas la app, y **volvía el nombre viejo**. Es el gemelo
exacto del fallo del título que se perdía al reabrir, que era de iOS; ahora las
dos apps propagan el nombre nuevo al estado vivo, al disco y al visor.

### La traza en directo se perdía sobre el mapa

**Web · desplegado.** El trazo verde sobre un bosque verde no se
veía. Y no era solo el verde: el color de la traza SIGNIFICA algo —la precisión
del GPS, con sus cuatro bandas— y el mapa de fondo tiene sus propios verdes,
naranjas y rojos, así que el naranja se perdía sobre una carretera naranja y el
rojo sobre una autovía roja. Un color que quiere decir algo y no se lee no dice
nada.

La solución ya estaba en casa: **el mapa del evento y el del planificador dibujan
un filo oscuro debajo de sus líneas** (`#020617` / `#0f172a`, más grueso y
translúcido) y el visor en directo era el único sin él. Ahora lo lleva, con el
mismo criterio, y los cuatro colores se leen sobre cualquier fondo.

Dos detalles del cómo: **todos los filos se dibujan antes que todos los
colores** —no filo y color tramo a tramo— porque si no el filo de un tramo tapa
el color del anterior en cada junta. Y **con el mapa de calor puesto no hay
filo** en la traza: ahí se apaga a propósito para no competir con los colores del
ritmo, que son los protagonistas. El calor sí estrena el suyo.

**Android / iOS** · *Compatible*. El visor va dentro de las apps: les llega con
la actualización OTA en cuanto la web esté desplegada.

### La app enseña tus carreras, y desde ellas se llega a la parrilla

**iOS · 1.0 (453) en TestFlight** · *Mejora al actualizar*
**Android · 1.0 (453)** · *Mejora al actualizar* — publicado.
**Web** · no aplica.

Nada más abrir la app, una sección **"Mis carreras"** con las que corres: el
nombre con tu marca, el día y la hora, y **"hoy"** destacado el día que toca.

Hasta ahora los eventos solo existían dentro del selector de "qué salida es
esta": escondidos tras una sección plegada y presentados como un ATRIBUTO de la
salida. Para quien corre carreras organizadas el evento no es un atributo, es el
motivo de abrir la app.

Cada carrera lleva las dos cosas que se quieren hacer con ella:

- **Tocarla** la deja preparada: la baliza se atribuye a ella y hereda su hora
  oficial, así que queda armada hasta el disparo. Otro toque la quita. Es el
  mismo estado que el selector de abajo —no hay dos verdades—, solo que aquí se
  llega en un gesto.
- **"Parrilla"** abre su pantalla web: quién corre, el tablón, los resultados.
  Va al navegador porque **la parrilla vive solo en la web**: el visor incrustado
  en la app se carga siempre con `?t=` y no puede pintarla (`Config.eventLobbyLink`
  en las dos apps).

Lo que NO hace es empezar a emitir. Eso sigue siendo un solo botón, el de
arriba, con el nombre y la ruta ya decididos: empezar a compartir la posición no
puede pasar por tocar un nombre en una lista.

Salen **todas**, incluidas las que ya no admiten baliza: esas van **plegadas**
("Ver las terminadas"), porque no se pueden correr pero su parrilla sigue siendo
donde están los resultados, que es justo lo que se quiere mirar el domingo por la
tarde. El selector de abajo sigue viendo solo las vivas —a una carrera cerrada no
se le puede atribuir una baliza—, así que son dos listas distintas en el store
(`events` / `pastEvents`, `eventos` / `eventosPasados`) y no un filtro de
pantalla.

Y las pendientes llevan **cuenta atrás al segundo**: `faltan 2 d 03 h 04 m 05 s`.
Dice dos cosas que una fecha no dice —que queda mucho y uno se puede ir a dormir,
o que queda poco y hay que ir preparando la baliza—. La regla es común a las dos
apps (`TrackingRules.cuentaAtras` / `countdown`, con pruebas en las dos): las
unidades en cero de delante no se escriben y las de detrás van con dos cifras,
para que el número no baile de ancho cada segundo y se pueda leer de reojo.
Pasada la hora no hay cuenta atrás sino "ya ha salido": un número creciente ahí
no significaría nada.

El reloj late solo mientras la pantalla se ve (`TimelineView` en iOS, un
`LaunchedEffect` en Android), así que no hay nada que apagar al salir.

### La parrilla ofrece la baliza a quien todavía no la tiene

**Web · pendiente de desplegar.** En "El directo", justo debajo de "empieza a
compartir tu posición con la app", hay ahora un enlace para descargarla. Es el
sitio donde se descubre que hace falta: quien entra en la parrilla y lee esa
frase es exactamente quien no la tiene.

Solo se le ofrece a quien CORRE y todavía no está emitiendo —con la baliza en
marcha sobra, y a quien solo mira la carrera no le hace falta—. El enlace apunta
siempre a la última publicada (`ANDROID_APK_URL` en `shared/config.ts`, el mismo
que se pega en los grupos), así que no hay que tocarlo al repartir una versión.

La de iPhone no se enlaza: se reparte por TestFlight, por invitación, así que lo
que dice es a quién pedirla.

**Android / iOS** · *Compatible*. La parrilla es de la web.

### Cada app dice qué versión es

**iOS · 1.0 (450) en TestFlight** · *Mejora al actualizar*
**Android · 1.0 (449)** · *Mejora al actualizar* — publicado.
**Web** · no aplica.

Al pie de la pantalla de la baliza, en pequeño: `SiLoSeNoSalgo 1.0 (447)`.

No es decoración. El número visible —`versionName` en Android, el corto en
iOS— es **"1.0" en todas las compilaciones**, así que en los ajustes del sistema
se veía lo mismo con el APK de agosto que con el de hoy. Quien probaba no podía
decir qué versión llevaba, y sin eso no hay forma de responder a un "a mí no me
sale lo del evento del día": el número que distingue una versión de otra es el
de compilación, que es el número de commits, y no salía por ningún sitio.

En Android hizo falta activar `buildConfig = true`: desde AGP 8 no se genera
`BuildConfig` si no se pide, y sin él el número solo se puede leer abriendo el
APK. En iOS sale del propio paquete (`CFBundleVersion`). Se puede seleccionar
con el dedo para pegarlo en un mensaje.

### El nombre de la salida se perdía al reabrir la app (iOS)

**iOS · 1.0 (447) en TestFlight** · *Mejora al actualizar*
**Android** · ya lo hacía bien; el APK 447 lo lleva igual.
**Web** · no aplica.

Ponerle nombre a una salida, cerrar la app y volver a abrirla dejaba la baliza
sin nombre. El seguimiento seguía siendo el mismo —el enlace no cambia y el
servidor sí guardaba el nombre—, pero en el móvil y en el visor incrustado
pasaba a llamarse "Sin nombre" a mitad de carrera.

El motivo: en iOS el nombre vivía solo en el `@State` de la pantalla, que muere
con el proceso. Lo que se guardaba en disco para poder reanudar llevaba la
cadencia, la hora, la ruta y la actividad, pero no el nombre; y al reanudar se
registraba en el visor un `title: nil` literal. Android lo guardaba desde
siempre (`EstadoActivo.titulo`): es otra de las asimetrías entre las dos apps.

Ahora el nombre vive en el store, se guarda con el resto del estado activo y
vuelve al reanudar, también sin cobertura. De paso, renombrar la salida EN
MARCHA cambia el nombre al instante en el visor, en vez de esperar a parar y
volver a abrir.

### "Salgo ya" es un toque, y quitar la ruta se lleva su hora

**iOS · 1.0 (444) en TestFlight** · *Mejora al actualizar*
**Android · 1.0 (445)** · *Mejora al actualizar* — luego rehecho como 447.

En la baliza, elegir una ruta con hora ponía esa hora como salida prevista —bien—
pero quitar la ruta la dejaba ahí, huérfana, y no había forma de volver a
"ahora" que no fuera pelearse con el selector de fecha. Peor en iOS: una vez
tocada, la hora ya no podía volver a "ahora" nunca, porque el aviso de cambio
marcaba "tocada" también cuando la cambiaba el propio código y deshacía al
instante su propio reset.

Ahora:

- **Quitar la ruta se lleva la hora que puso.** Si hay evento, vuelve a la
  oficial del evento; si no, a "ahora". Una hora puesta A MANO se queda: quien
  la tocó tenía un motivo. (Android ya lo hacía; iOS no.)
- **"Salir ahora · quitar la hora prevista"**, un botón debajo de la hora en las
  dos apps. La salida vuelve a ser el momento de pulsar Empezar y la baliza no
  se queda armada esperando una hora que ya no va.
- **En iOS, sin hora fijada se lee "Ahora"** y un botón "Programar la salida",
  en vez de un selector con la hora de cuando se abrió la pantalla, que parecía
  una hora puesta y no lo era.

**Web** · no aplica: la baliza es de las apps.

## 2026-09-10

### Los tres enlaces de una carrera ya no parecen el mismo

**Web · desplegado.** Al arreglar la vista previa, los tres enlaces del evento
—parrilla, público e invitación— pasaron a compartir la MISMA tarjeta, con el
sello de "PARRILLA" en los tres. En un grupo, pegados uno detrás de otro,
parecían el mismo enlace repetido hasta que alguien se paraba a leer el texto.

Ahora cada enlace tiene su tarjeta, y se distingue sin leer nada:

| Enlace | Sello | Color |
|---|---|---|
| Parrilla (`?e=`) | 🏁 PARRILLA | azul |
| Público (`?ev=`) | 📍 SIGUE LA CARRERA | rojo |
| Invitación (`?evento=`) | 🎽 TE APUNTAS | verde |
| Cualquiera, ya corrida | 🏁 CARRERA TERMINADA | ámbar |

El sello es una pastilla rellena y no un renglón de color, porque una vista
previa se mira del tamaño de un sello de correos y ahí una línea de texto se
pierde sobre el cartel; y el color tiñe la tarjeta entera —el velo sobre el
cartel—, que es lo que de verdad los separa de un golpe de vista.

Las dibuja y las sube quien organiza al abrir la parrilla, las tres de una vez.
Mientras un evento no tenga las suyas, sus enlaces siguen enseñando la de la
parrilla: el sello no cuadrará, pero se sigue viendo la carrera en grande, que
es mejor que caer al cartel recortado.

**Android / iOS** · *Compatible*. Las vistas previas las arma el borde.

### El enlace de la carrera enseñaba media palabra del cartel

**Web · desplegado.** Al pegar el enlace público de un evento en
WhatsApp salía la pastilla pequeña: una miniatura cuadrada con el cartel
recortado a lo bruto —"NFRA" de Canfranc— y el texto al lado. Dos cosas a la
vez: el enlace público anunciaba el CARTEL a secas, que es 3:1, y el HTML lo
declaraba como 1200×630. Un previsualizador que espera 1,91:1 y recibe un 3:1
recorta al centro y se cae a la miniatura.

Ahora los tres enlaces del evento —público, parrilla e invitación— anuncian la
misma **tarjeta de 1200×630** que ya se dibujaba para la parrilla: el cartel de
fondo, el nombre de la carrera, cuándo se sale y cuántos van. Y el tamaño que se
declara es el de la imagen que de verdad se sirve, incluso cuando toca caer al
cartel (3:1) porque la tarjeta todavía no está subida.

De paso, más resolución: la tarjeta se dibuja a 1,5× (1800×945 reales, como ya
hacía la de una ruta compartida) y el cartel se guarda a 1800 px de ancho en vez
de 1200, que era menos de lo que la tarjeta necesita de fondo y se veía blando.
El fichero sigue por debajo de lo que aceptan los previsualizadores, que es lo
que de verdad manda: una imagen demasiado pesada la descartan y no se ve nada.

La tarjeta la dibuja y la sube quien organiza al abrir la parrilla, así que los
eventos que ya existen estrenan la suya la próxima vez que su organizador entre.
Los carteles ya subidos se quedan como están hasta que alguien los reencuadre.

**Android / iOS** · *Compatible*. Las vistas previas las arma el borde con el
HTML; las apps no pintan nada de esto.

### El curso FIT reiniciaba el Fenix 7 al abrirlo

**Web · desplegado.** Descargar el curso FIT, subirlo a Garmin
Connect y sincronizarlo con un Fenix 7 acababa siempre igual: el reloj se
reinicia al abrir el recorrido. El mismo recorrido en GPX va fino, y ahí está
la pista — **Connect recorta puntos cuando importa un GPX, pero un FIT de curso
se lo queda tal cual**. O sea que el tamaño del fichero lo teníamos que
arreglar nosotros y no lo hacíamos.

Los ficheros que salían de aquí, medidos: 16 000 puntos para 429 km, 11 867
para 65 km —uno cada cinco metros y medio— y 1 485 posiciones repetidas
seguidas en uno de ellos. El umbral que se repite en los foros de Garmin para
un Fenix 7 está sobre los **10 000 puntos**: por encima hay congelaciones y
reinicios. Íbamos claramente por encima, y encima con tramos de longitud cero,
que es donde el cálculo de rumbo se queda sin definir.

Ahora se manda mucho menos y, sobre todo, mejor:

- **Fuera las posiciones repetidas.** Un punto que no se mueve del anterior no
  es un punto, es un tramo de longitud cero.
- **La geometría se simplifica guardando la forma** (Ramer-Douglas-Peucker con
  cuatro metros de tolerancia, por debajo del error del propio GPS): las
  horquillas se quedan enteras y desaparecen los puntos de más de las rectas.
  Los mismos recorridos de arriba salen ahora con 2 913 y 1 302 puntos.
- **Tope duro de 6 000**, muy por debajo del límite del reloj, por si acaso.
- **Un sitio, un punto de curso.** El control y su avituallamiento vienen en
  las mismas coordenadas del GPX de la organización; en el reloj eso gastaba
  cupo y avisaba dos veces de lo mismo. Cuando coinciden, manda el que lleva
  hora de corte.
- **Tope de 200 puntos de curso**, el del reloj, que pasado se come los últimos
  sin avisar —los del final del recorrido, justo cuando más falta hacen—. Si
  hay que elegir, se quedan los cortes.
- **Los nombres se recortan a 32 bytes sin partir un carácter.** Sin tope, un
  solo POI con nombre kilométrico infla el fichero entero, y pasados los 254
  bytes el tamaño ya no cabe donde se anota y el fichero sale ilegible.
- **Las marcas de tiempo salen de la distancia**, no de un segundo por punto:
  429 km ya no se recorren en hora y media —257 km/h a pie— sino a una
  velocidad de este mundo, que es de donde el reloj saca lo que queda.

Los km de cada POI siguen exactos: cada punto que se queda conserva su
distancia acumulada real. **Hay que volver a descargar el FIT**: los que ya
estén en Connect siguen siendo los de antes.

El listón lo pone la propia Garmin: ese recorrido de 429 km se le subió con
75 074 puntos en un GPX y ella lo guardó con **3 851** —uno cada 111 m—, que es
como lo exporta. Ahora le mandamos 2 913 por esa ruta; antes, 16 000.

**Y el motivo por el que existía el FIT ya no es cierto.** Se hizo porque
Connect importaba los POI de un GPX y los dejaba todos a «0,00 km». Ya no:
comprobado el 10/09/2026 con una ruta de 99,59 km, los diez POI salen en
«Puntos del trayecto» a su kilómetro real. Así que para la vía normal —subir a
Connect y sincronizar— **el GPX es la vía recomendada**, y además la más
segura, porque Connect recorta al importarlo. Al FIT le queda lo suyo: el km va
escrito y no calculado, los POI llegan como puntos de curso de verdad, y el
fichero se puede copiar **directo al reloj por USB** (carpeta `NewFiles`) sin
pasar por Connect, que es la única vía en la que controlamos exactamente qué
recibe el reloj. Los botones de descarga lo dicen ya en su ayuda.

**Android / iOS** · No aplica: el curso FIT se descarga desde la web.

### El planificador empieza por el margen que quieres en cada corte

**Web · desplegado.** El paso «Ritmo» pedía lo que nadie sabe
contestar antes de una carrera larga: modelo de previsión, ritmo en llano,
minutos por cada 100 m de D+. Ahora lo primero que pregunta es lo único que sí
se sabe —**cuánto quieres llegar antes de cada corte**— y de ahí sale el ritmo.

Se elige entre justo, 15, 30, 45 minutos o una hora (o se teclea otro), y cada
opción enseña ya el ritmo que pide; un margen que no da dice «no llegas» en vez
de dejarte calcularlo. Debajo, una línea dice qué corte manda —el que fija el
ritmo de todo el recorrido— y el botón lo pone de ritmo base. En los demás
cortes se llega con más colchón que el pedido, nunca con menos.

Lo que hace que esto sirva para empezar: **el ritmo necesario no depende del
ritmo que lleves puesto**. Sale del recorrido, de las horas de corte, de las
paradas previstas y de la hora de salida, así que contesta incluso cuando el
ritmo es justo lo que no tienes ni idea de cuál es. Con los tiempos del GPX
mandando tramo a tramo, ponerlo cambia el modelo a ritmo fijo —si no, el ritmo
no pintaría nada— y avisa antes de hacerlo.

El modelo de previsión y el ritmo base pasan a una sección plegada que enseña,
cerrada, lo que hay elegido. Siguen enteros: esto no quita nada, cambia el
orden en que se pregunta.

**Sin cortes de tiempo no aparece.** Un recorrido sin horas de corte no tiene
margen que elegir, así que el paso vuelve a ser el de antes —modelo y ritmo,
abiertos— sin una opción vacía que no lleva a ningún sitio. En cuanto se le
ponen cortes a los waypoints, aparece.

**Android / iOS** · *Compatible*. No les toca: las apps llevan el visor, no el
planificador. La estrategia por tramos de después, con su margen y sus botones
de ritmo único y variable, se queda igual.

### Los cortes de la Canfranc-Canfranc decían que sobraban 176 horas

**Web · desplegado.** El plan de paso de la Canfranc-Canfranc daba
márgenes de fantasía: +24 h en el primer control y +176 h en meta. La hora del
corte se guarda sin fecha (solo HH:MM) y el día se deduce al pintarlo, pidiendo
que cada corte caiga DESPUÉS del anterior. El GPX de la organización trae cada
control DOS veces —el cierre de control y su avituallamiento, en las mismas
coordenadas—, así que la segunda copia no podía caer a la misma hora que la
primera y se iba veinticuatro horas más allá. Ocho controles duplicados, ocho
días de más.

Ahora el mismo punto repetido es UN corte; dos cortes a la misma hora pueden
serlo (un control y su avituallamiento cierran a la vez); y en un mismo punto la
hora se lee en su lectura más cercana, así que un avituallamiento que recoge
cinco minutos antes de su control se queda cinco minutos antes, y un 23:50 →
00:10 sigue cruzando la medianoche.

No hay que volver a publicar nada: el día se deduce al pintar, así que los
planes y los eventos ya guardados se arreglan solos en cuanto sale el
despliegue.

**Android / iOS** · *Compatible*. El visor va dentro de las apps, así que se
arregla con la actualización OTA del visor, ya desplegado; no hace falta APK
nuevo. Un móvil que nunca se conecte se queda con el visor del APK que lleve
dentro.

### El día de la carrera, la baliza ya viene con la carrera puesta

**Android · 1.0 (435)** · *Mejora al actualizar* — APK firmado en `reparto/`, listo para mandar.
**iOS · en código, sin instalar todavía** · *Mejora al actualizar*
**Web** · no aplica: la baliza es de las apps.

Al abrir la baliza el día de un evento en el que participas, aparece ya elegido
—con un aviso de que lo ha puesto la app, y se quita con un toque—. Con él viene
la hora oficial de salida, así que la baliza se queda **armada y en silencio**
hasta el disparo en vez de emitir desde el aparcamiento.

Elige la carrera de HOY (día natural del móvil), sin terminar y con hora puesta;
si hay dos el mismo día, la más cercana a ese momento. No se mete donde no la
llaman: nunca con una salida en marcha o armada, nunca si ya hay evento elegido,
y nunca el que acabas de quitar —eso se recuerda aunque cierres la app—.

**Y la ruta sin hora ya no borra la del evento.** Una ruta planificada casi nunca
lleva hora (se planifica el recorrido, no el día). En Android, elegirla después
del evento dejaba la salida en "ahora" y la baliza arrancaba a emitir en cuanto
se pulsaba Empezar. Ahora la hora la pone la ruta si la trae y, si no, el evento.
Una ruta CON hora sigue mandando sobre la del evento: quien sale en otra tanda la
planifica con la suya.

> **Compatible con cualquier APK anterior.** No cambia nada del servidor: se usa
> `startsAt` de `GET /api/events`, que ya viajaba y ya venía relleno. Un APK
> viejo se comporta como siempre —hay que elegir el evento a mano— y quien lo
> lleve sale igual de bien en el mapa común.

---

## 2026-09-01

### Marcas de evento: cada participante con su emoji

**Web · desplegado.** El emoji pasa a ser el identificador de cada participante
en un evento (único de verdad) y el color pasa a agrupar, pudiendo repetirse. Se
elige en la parrilla, y cada cuenta puede guardar su marca favorita para todas
las carreras. Las banderas de país no valen como emoji. El organizador puede
reservarse el reparto de colores ("agrupar por colores").

**Android · 1.0 (281)** · *Mejora al actualizar* — instalada en el móvil propio;
el APK firmado espera en `reparto/` a que se pase al compañero.
**iOS · instalada en el iPhone** · *Mejora al actualizar*

Las apps enseñan tu marca junto al evento, en el selector y en el resumen
plegado, para poder confirmar en la línea de salida con qué te van a ver. Elegir
marca sigue siendo cosa de la web: es una decisión que se toma una vez y con
cobertura, no con el móvil en la mano y el dorsal puesto.

> **Compatible con el APK 271.** El cambio en `GET /api/events` es aditivo
> (`myEmoji`, `myColor`, `colorsLocked`): la app vieja los ignora y sigue
> funcionando igual. Los endpoints nuevos (`/emoji`, `/settings`,
> `/auth/profile`) no los llama nadie desde el móvil. Quien corra con el APK
> viejo aparece en el mapa común con su emoji igualmente —lo pinta la web—,
> simplemente no lo ve en su teléfono.

### Cambiar el recorrido no invalida la planificación de nadie

**Web · desplegado.** Al republicar el recorrido de un evento se guarda qué
cambió respecto al anterior (puntos que se mueven de kilómetro, cierres con hora
nueva, puntos añadidos o quitados, diferencia de distancia). Quien tenga una
previsión guardada ANTERIOR a ese cambio ve el detalle en la parrilla y un botón
para abrir el recorrido nuevo; al guardar allí se actualiza esa misma previsión.

No se borra ni se invalida nada de nadie: las horas de paso no se guardan, se
calculan, así que un punto que pasa del km 42 al 44,3 recibe su hora nueva solo.
Lo que cambia es el veredicto —ese corte está más lejos— y eso es información,
no un error que reparar borrando el trabajo de los demás.

**Android / iOS** · *Compatible*. Campos nuevos en la parrilla, que es de la web.

### La salida oficial de la carrera, y los puntos del recorrido en el mapa

**Web · desplegado.** El evento guarda su día y hora de salida: se rellena sola
con la de la previsión de origen al ponerle el recorrido, y quien organiza la
puede corregir en la parrilla. Con ella, "Planificar sobre el recorrido del
evento" arranca ya con la fecha buena en vez de heredar la que tuviera el
organizador el día que lo montó.

El mapa del evento pinta también los puntos del recorrido (avituallamientos,
controles, cimas), en ámbar los que tienen hora de cierre, con el nombre visible
al acercar.

**Android / iOS** · *Compatible*. `startsAt` ya viajaba en la lista de eventos;
ahora además viene relleno.

### Notas de la carrera

**Web · desplegado.** El evento tiene un tablón donde quien organiza cuenta lo
que hasta ahora acababa en el grupo de chat: dónde está la bolsa de vida, a qué
hora sale el autobús, qué hay en cada avituallamiento. Sale arriba de la
parrilla, lo escribe solo el organizador y lo leen los participantes.

**Android / iOS** · *Compatible*. Campo nuevo en la parrilla, que es de la web.

### Organizar sin correr

**Web · desplegado.** Crear un evento ya no obliga a figurar entre los que lo
corren: al crearlo hay una casilla ("Yo también corro esta carrera", marcada por
defecto), y quien organiza puede dejar de correrla sin dejar de organizarla —o
apuntarse después con su propio código—. La parrilla, el mapa en directo y los
mandos de organización siguen abiertos para el dueño aunque no participe.

**Android / iOS** · *Compatible*. `GET /api/events` sigue devolviendo, por
defecto, solo los eventos que uno CORRE; los que se organizan sin correr hay que
pedirlos con `?organising=1`, que solo hace la web. Es deliberado: la app usa
esa lista para saber a qué carrera atribuir la baliza, y emitir para una carrera
que no corres lo rechaza el servidor de todas formas.

### Escala: eventos de hasta cien participantes

**Web · desplegado.** Buscador en la lista del mapa común (por nombre, dorsal o
emoji), seguir a una persona con el mapa (se suelta al arrastrar), y los emojis
se degradan a puntos de color cuando hay mucha gente y poco zoom.

**Android / iOS** · *Compatible*. El mapa común es de la web; las apps no
cambian.

### Cuentas: restablecer contraseña y borrar cuentas

**Web · desplegado.** Un administrador genera un enlace de un solo uso (24 h) y
la contraseña nueva la elige su dueño. También se pueden borrar cuentas, con sus
recuentos a la vista.

**Android / iOS** · *Compatible*, con un aviso operativo:

> ⚠️ **Restablecer una contraseña cierra TODAS las sesiones de esa cuenta**,
> incluidas las de las apps del móvil. Quien la restablezca tendrá que volver a
> iniciar sesión en su teléfono. Es deliberado —si no, cambiarla no serviría de
> nada cuando alguien sospecha que su contraseña anda por ahí—, pero conviene
> avisar a esa persona, no vaya a descubrirlo en la salida.

### Cabecera que no cabía en el móvil

**Web · desplegado.** Los mandos se salían de la pantalla en un móvil. Ahora la
cabecera se parte en dos filas, y el CSS recorta cualquier desborde
(`overflow-x: clip`) para que nada vuelva a estirar la página.

**Android / iOS** · no aplica (la cabecera es de la web).

---

## Antes del 2026-09-01

El histórico anterior está en `git log`, que hasta aquí ha sido el único
registro. Este fichero empieza el día que las tres piezas dejaron de ir a la
vez y quedó claro que hacía falta saber qué versión necesita qué.
