# Firma y publicación · Android e iOS

Quién publica esta app, con qué nombre, y cómo se firma cada plataforma. Vale
para `../android` y para `../ios`: la identidad es común, las claves no.

## Los tres nombres

Es fácil confundirlos porque los tres se llaman "el nombre de la app", y no
tienen por qué parecerse:

| | Qué es | Dónde se define | Valor |
|---|---|---|---|
| **Nombre visible** | Lo que se lee bajo el icono | `strings.xml` / `PRODUCT_NAME` | `SiLoSeNoSalgo` |
| **Identificador** | Nombre interno, único en el mundo | `applicationId` / `PRODUCT_BUNDLE_IDENTIFIER` | `com.themakercrowd.silosenosalgo` |
| **Editor** | Quién publica, visible en la ficha de la tienda | Play Console / App Store Connect | `TheMakerCrowd` |

El **identificador** tiene que ser único entre todas las apps del mundo, y no
existe ningún registro central donde apuntarlo. La convención resuelve el
problema reutilizando el único registro global que ya había —los dominios— y
escribiéndolos al revés:

```
themakercrowd.com  →  com.themakercrowd  →  com.themakercrowd.silosenosalgo
                      └── el dominio ──┘     └────── esta app ──────┘
```

Como `themakercrowd.com` es nuestro, nadie más puede reclamar
`com.themakercrowd.*`. El usuario no lo ve nunca: es lo que el sistema usa para
la carpeta de datos, para saber que una instalación nueva es *actualización* de
la anterior y no otra app distinta, y para la URL en la tienda.

**No se puede cambiar después de publicar.** Ni en Play ni en App Store.
Cambiarlo equivale a publicar una app nueva, sin usuarios, sin reseñas y sin
posibilidad de actualizar a quien tenga la vieja.

## La identidad

- **Titular de las cuentas:** `Inocuo Sistemas Informáticos SL`. Es el nombre
  legal, el que Apple y Google verifican con documentación, y el que va en el
  campo `O=` del certificado de Android. Se elige el nombre de la sociedad y no
  el comercial porque la marca puede cambiar y la sociedad no.
- **Nombre de editor:** `TheMakerCrowd`. En Play Console se elige directamente.
  En App Store sale del alta; Apple admite un nombre comercial distinto del
  legal si consta como tal en el registro **D-U-N-S**.
- **Identificador:** `com.themakercrowd.silosenosalgo`, **el mismo en las dos
  plataformas**.

> El **D-U-N-S** es gratis pero puede tardar de días a semanas en concederse, y
> sin él no hay cuenta de organización en Apple (solo cuenta personal, que
> publica a nombre de una persona física). Si la App Store está en el plan, es
> lo primero que hay que pedir porque es lo que más tarda.

## Por qué no hay una sola clave para las dos plataformas

No es una limitación que se pueda esquivar, son dos sistemas incompatibles:

- **Android** se firma con un almacén (`.jks`) **autofirmado que generas tú**.
  No interviene ninguna autoridad y nadie comprueba lo que pone dentro. Lo único
  que importa es que sea siempre el mismo.
- **iOS** se firma con certificados **emitidos por Apple** contra tu Team ID.
  No existe la firma autofirmada para distribuir.

Lo que se unifica, entonces, es la identidad de alrededor: el mismo nombre legal
en los dos sitios, el mismo nombre de editor y el mismo identificador.

## Android

### Crear la clave (una sola vez, y para siempre)

```powershell
.\android\scripts\crear-keystore.ps1     # Windows
```
```sh
android/scripts/crear-keystore.sh        # macOS/Linux
```

Pregunta una contraseña y deja dos ficheros en `android/`, los dos git-ignored:

- `silosenosalgo-release.jks` — el almacén, con una clave RSA de 4096 bits
  válida ~27 años (Play exige que llegue más allá de 2033).
- `keystore.properties` — dónde está y con qué contraseña abrirla.

El certificado sale a nombre de
`CN=TheMakerCrowd, O=Inocuo Sistemas Informáticos SL, C=ES`. El script imprime
el titular al terminar: **compruébalo antes de seguir**, porque una tilde mal
codificada ahí ya no se arregla.

> **Copia de seguridad, inmediatamente.** El `.jks` fuera de este ordenador y la
> contraseña en el gestor de contraseñas. Android identifica una app por la
> pareja *(identificador, clave)*: sin la clave no se puede publicar una
> actualización **nunca más**, ni en Play ni instalando el APK a mano. Quien la
> tenga, en cambio, puede publicar en vuestro nombre — por eso no va al
> repositorio.

### Los acentos: dónde dan igual y dónde no

**En el certificado se quedan.** `Informáticos` va grabado como UTF-8 correcto
(`C3 A1`), comprobado leyendo el PKCS12 y también el APK ya firmado. Ese campo
no lo valida nadie, no decide nada y el usuario no lo ve nunca: es una etiqueta.
Quitarle la tilde obligaría a generar una clave nueva, y el día que se normaliza
"regenerar la clave" es el día que se empieza a perder.

Lo que sí conviene saber es que **verlo mal no significa que esté mal**. Al
volcar `keytool -list` por una tubería, Java escribe en Cp1252 y la consola lee
en CP850, así que la `á` aparece como `ß`; `apksigner verify` la muestra como
`?`. En los dos casos el certificado está intacto. Para comprobarlo de verdad,
sin conversiones de por medio:

```powershell
$c = New-Object Security.Cryptography.X509Certificates.X509Certificate2(
        'silosenosalgo-release.jks', '<contraseña>')
$c.Subject
```

**En la contraseña, en cambio, mejor ASCII.** No por superstición: pasa por
`keystore.properties`, por variables de entorno, por los secretos de la
integración continua y quizá por un terminal de macOS para lo de iOS, y cada
salto tiene su codificación. De hecho `java.util.Properties.load(InputStream)`
decodifica en ISO-8859-1 **haga lo que haga el fichero**, así que una contraseña
con tilde o eñe daría un "contraseña incorrecta" sin ninguna pista de por qué
(por eso `build.gradle.kts` la lee con `reader(Charsets.UTF_8)`). Para la fuerza
de la contraseña compensa de sobra: alargarla aporta mucho más que meterle
símbolos raros.

Y si hiciera falta, **la contraseña se puede cambiar sin tocar la clave** — la
identidad de la app no cambia, solo el candado:

```sh
keytool -storepasswd -keystore silosenosalgo-release.jks
```

En un almacén PKCS12 las dos contraseñas van forzosamente juntas, así que esa
orden cambia las dos a la vez. Después hay que actualizar `keystore.properties`.

### Cómo se llama cada cosa

| Cosa | Nombre correcto | Valor |
|---|---|---|
| `silosenosalgo-release.jks` | **almacén de claves** (*keystore*) | — |
| `storePassword` | **contraseña del almacén** | la que pide el script |
| `keyPassword` | **contraseña de la clave** | la misma |
| `keyAlias` | **alias** de la clave | `silosenosalgo` |
| La clave, una vez en Play | **clave de subida** (*upload key*) | — |

El almacén es un **contenedor** y puede guardar varias claves, cada una con su
alias; el nuestro guarda una sola. Por eso hay **dos** contraseñas, una para el
contenedor y otra para la clave de dentro. El script les da **el mismo valor**,
que es lo que hace Android Studio y lo que esperan las herramientas: si alguien
busca una segunda contraseña distinta, no existe.

La extensión `.jks` viene de *Java KeyStore*, pero el fichero está en formato
**PKCS12** (el actual; JKS está obsoleto). Se conserva la extensión porque es la
convención en Android, y Gradle detecta el formato solo.

### Qué guardar en el gestor de contraseñas

Una sola ficha, con este nombre para que aparezca al buscar tanto por la app
como por la plataforma:

```
Android · clave de firma · SiLoSeNoSalgo (TheMakerCrowd)
```

Y dentro, además de la contraseña:

| Campo | Valor |
|---|---|
| Contraseña del almacén | (la misma sirve para la clave) |
| Alias | `silosenosalgo` |
| Fichero | `silosenosalgo-release.jks` (formato PKCS12) |
| Titular | `CN=TheMakerCrowd, O=Inocuo Sistemas Informáticos SL, C=ES` |
| Huella SHA-256 | la que imprime el script al terminar |
| Dónde está la copia | el sitio, fuera del ordenador de desarrollo |
| Creada / caduca | la fecha de creación y la de dentro de ~27 años |

La **huella SHA-256** es el campo que más se agradece con el tiempo: es lo que
permite comprobar que un APK está firmado con esta clave y no con otra, y es lo
que muestra Play Console para identificarla. Se puede volver a consultar cuando
haga falta:

```sh
keytool -list -v -keystore silosenosalgo-release.jks -alias silosenosalgo
```

El almacén **no va en el gestor de contraseñas**: es un fichero binario. Va en
la copia de seguridad, y la ficha solo dice dónde está.

### Construir

`app/build.gradle.kts` lee la clave de `keystore.properties` o, en integración
continua, de `SLSNS_STORE_FILE`, `SLSNS_STORE_PASSWORD`, `SLSNS_KEY_ALIAS` y
`SLSNS_KEY_PASSWORD`. Si no encuentra ninguna, **el build de release falla con
una explicación** en vez de escupir un APK sin firmar que el móvil rechaza al
instalar sin decir por qué.

```sh
npm run build                    # en la raíz
android/scripts/copy-webdist.sh  # o copy-webdist.ps1 en Windows
cd android

./gradlew assembleRelease   # APK  → app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease     # AAB  → app/build/outputs/bundle/release/app-release.aab
```

**APK para reparto directo** (enlace, correo, USB) y **AAB para Google Play**,
que desde 2021 no acepta APK para apps nuevas. Los dos salen de la misma clave.

### El versionCode se calcula solo

Cada subida a Play necesita un `versionCode` **mayor que el anterior**, y un
móvil tampoco instala encima un APK con uno menor. No se lleva a mano: sale del
número de commits del repositorio (`git rev-list --count HEAD`), así que crece
por su cuenta sin que nadie tenga que acordarse el día de publicar.

Se cuenta el repositorio entero, no solo lo que toca `android/`: filtrar por
ruta parece más fino, pero reescribir la historia o mover un fichero puede hacer
que el número **baje**, que es justo lo que no puede pasar. Que un cambio en la
web suba el número de la app es inofensivo — solo hace falta que crezca, los
saltos dan igual.

El build de release **se para** si no puede contar los commits o si el clon está
truncado (`git clone --depth 1`, lo habitual en integración continua), donde git
contaría 1 commit aunque haya mil. En GitHub Actions hay que pedir la historia
completa con `fetch-depth: 0`.

Al construir, el número aparece en la salida:

```
versionCode 240 (commits en git)
```

El `versionName` (`1.0`) sí es manual: es lo que lee la gente en la ficha de la
tienda, y ahí un número que salta de 240 a 253 no dice nada.

> Ojo con la primera publicación: el primer `versionCode` que subas queda
> reservado para siempre y ya no se puede bajar de ahí. Publicar hoy significa
> empezar en 240, no en 1.

### Play App Signing

Al publicar en Play se activa obligatoriamente. Cambia el papel de nuestra clave:
pasa a ser la **clave de subida**, Google genera y custodia la definitiva con la
que se firma lo que llega a los móviles. La diferencia práctica es buena: si se
pierde la clave de subida, Google deja registrar otra y no se pierde la app.

Es una razón de peso para ir a Play aunque el reparto directo siga: **es el
único escenario en el que perder la clave no es irreversible**.

## iOS

`ios/project.yml` fija `PRODUCT_BUNDLE_IDENTIFIER: com.themakercrowd.silosenosalgo`
y deja `DEVELOPMENT_TEAM` vacío. Cuando exista la cuenta de organización, poner
ahí el Team ID para que XcodeGen no lo pierda al regenerar el proyecto:

```yaml
settings:
  base:
    DEVELOPMENT_TEAM: "XXXXXXXXXX"
```

Pasos, en orden:

1. **D-U-N-S** para `Inocuo Sistemas Informáticos SL` (gratis, lo que más tarda).
2. **Apple Developer Program**, cuenta de organización, 99 €/año.
3. Registrar el App ID `com.themakercrowd.silosenosalgo` en el portal.
4. En Xcode, *Automatically manage signing* con el Team de la empresa: los
   certificados y perfiles los emite Apple.
5. **TestFlight** para el reparto a probadores, que es el equivalente de mandar
   el APK por un enlace. En iOS no hay reparto directo: sin cuenta de pago, una
   app instalada desde Xcode **caduca a los 7 días**.

## Qué cambió al unificar la identidad

El proyecto de iOS venía con el prefijo `app.silosenosalgo`, de un dominio que
no es nuestro. Se movió todo a `com.themakercrowd`:

| Sitio | Antes | Ahora |
|---|---|---|
| `ios/project.yml` | `app.silosenosalgo.tracker` | `com.themakercrowd.silosenosalgo` |
| `ios/Resources/Info.plist`, `GuidePackage.swift` | `app.silosenosalgo.slsnsguide` | `com.themakercrowd.slsnsguide` |
| `ios/Sources/Keychain.swift` | `app.silosenosalgo.tracker` | `com.themakercrowd.silosenosalgo` |

Android no se tocó: su `applicationId` ya era el bueno.

Dos consecuencias, ambas inofensivas **mientras no se haya publicado**:

- La app de pruebas del iPhone se instala como app **nueva**: hay que borrar la
  anterior y volver a iniciar sesión (el token vivía bajo el nombre viejo del
  Keychain).
- El UTI del formato `.slsnsguide` cambia, pero el formato **no**: una guía se
  reconoce por su extensión y por el manifiesto del ZIP, según
  `slsnsguide-v1.md`, así que los paquetes exportados antes se siguen abriendo y
  la interoperabilidad con Android se mantiene.
