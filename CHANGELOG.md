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
| Android · APK de reparto | 1.0 (**435**) compilado y firmado, en `android/app/build/outputs/reparto/SiLoSeNoSalgo-1.0-435.apk` | sí, **listo para mandar**: lleva el visor web reconstruido y el evento del día. El compañero sigue con el **271** |
| iOS | 1.0 (435 en código); compila y pasa sus pruebas | **no**: falta instalarla en el iPhone (`ios/scripts/instala-en-iphone.sh`) |

El `versionCode` de Android es el número de commits (`build.gradle.kts`), así
que sirve para saber exactamente qué lleva dentro un APK: el 271 se compiló en
el commit 271.

---

## 2026-09-10

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
