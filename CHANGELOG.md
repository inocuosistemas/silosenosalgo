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
| Android · móvil propio | 1.0 (281), debug | sí |
| Android · APK de reparto | 1.0 (**281**) compilado y firmado, en `android/app/build/outputs/reparto/` | sí, pero **sin repartir**: el compañero sigue con el **271** |
| iOS | 1.0 (281 en código), instalada en el iPhone 16 Pro | sí |

El `versionCode` de Android es el número de commits (`build.gradle.kts`), así
que sirve para saber exactamente qué lleva dentro un APK: el 271 se compiló en
el commit 271.

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
