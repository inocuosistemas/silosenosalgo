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
| Android · APK de reparto | 1.0 (**447**) publicado en GitHub Releases | sí. **Enlace fijo al último APK**, el que se manda a quien prueba: `https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk`. El compañero sigue con el **271** |
| iOS | 1.0 (**447**) subida a TestFlight el 2026-09-11 (antes el 442, 443 y 444) | sí, en cuanto salga de *Processing* |

El `versionCode` de Android es el número de commits (`build.gradle.kts`), así
que sirve para saber exactamente qué lleva dentro un APK: el 271 se compiló en
el commit 271.

## Cómo llega cada versión a quien la prueba

| Pieza | Camino |
|---|---|
| Web | `npm run deploy` (Cloudflare Pages). Las apps recogen el visor nuevo por OTA. |
| iOS | `ios/scripts/sube-a-testflight.sh` → TestFlight, probadores internos, sin revisión de Apple. |
| Android | `./gradlew assembleRelease` y se publica el APK como *release* de GitHub. El enlace que se manda **no cambia nunca**: `https://github.com/inocuosistemas/silosenosalgo/releases/latest/download/SiLoSeNoSalgo.apk` |

El APK se sube con el nombre `SiLoSeNoSalgo.apk` a secas —sin versión— porque es
lo que hace que ese enlace funcione siempre. La versión va en el título de la
release y dentro del propio APK, que es donde la mira Android al instalar.

> El repositorio es público, así que ese APK lo puede descargar cualquiera que
> tenga el enlace. Dentro no va ningún secreto: la clave de firma no viaja en el
> APK, solo su firma. Es el mismo fichero que antes se mandaba por WhatsApp.

---

## 2026-09-11

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
