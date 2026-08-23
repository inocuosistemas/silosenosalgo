import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

// La clave de firma NUNCA vive en el repositorio: sale de `android/keystore.properties`
// (git-ignored, ver `keystore.properties.example`) o, en integración continua, de
// variables de entorno. Ver `../docs/firma-y-publicacion.md`.
val propiedadesFirma = Properties().apply {
    val fichero = rootProject.file("keystore.properties")
    // Con `load(InputStream)`, java.util.Properties decodifica en ISO-8859-1
    // pase lo que pase, y el fichero lo escribe el script en UTF-8: una
    // contraseña con una tilde o una eñe se leería mal y la firma fallaría con
    // un "contraseña incorrecta" imposible de relacionar con la causa. Con
    // `load(Reader)` manda la codificación del lector.
    if (fichero.exists()) fichero.reader(Charsets.UTF_8).use { load(it) }
}

fun datoDeFirma(clave: String, variable: String): String? =
    (propiedadesFirma.getProperty(clave) ?: System.getenv(variable))?.takeIf { it.isNotBlank() }

val ficheroDeClave: File? = datoDeFirma("storeFile", "SLSNS_STORE_FILE")
    ?.let { rootProject.file(it) }
    ?.takeIf { it.exists() }

// El `versionCode` NO se toca a mano: es el número de commits. Play exige que
// cada subida lleve uno mayor que el anterior, y un móvil se niega a instalar
// encima un APK con uno menor — otra vez con el escueto "aplicación no
// instalada". Contarlo de git lo hace crecer solo, sin que nadie tenga que
// acordarse justo el día de publicar, que es cuando se olvida.
//
// Se cuenta el repositorio ENTERO, no solo los commits que tocan `android/`.
// Filtrar por ruta parece más fino pero no lo es: reescribir la historia o
// mover un fichero de sitio puede hacer que el número BAJE, y bajar es
// exactamente lo que no puede pasar. Que la web haga subir el número de la app
// es inofensivo: solo hace falta que crezca, los saltos dan igual.
//
// `providers.exec` y no `ProcessBuilder`: lo primero convive con la caché de
// configuración de Gradle y lo segundo la invalida en cada build.
val directorioRaiz = rootDir

fun ordenGit(vararg argumentos: String): String? {
    val salida = providers.exec {
        workingDir = directorioRaiz
        commandLine(listOf("git") + argumentos)
        isIgnoreExitValue = true
    }
    if (salida.result.get().exitValue != 0) return null
    return salida.standardOutput.asText.get().trim().ifBlank { null }
}

val commitsDeGit: Int? = ordenGit("rev-list", "--count", "HEAD")?.toIntOrNull()

// Un clon truncado (`git clone --depth 1`, lo normal en integración continua)
// cuenta 1 commit aunque haya mil. Publicar eso reservaría el `versionCode` 1
// para siempre y dejaría la app sin poder actualizarse nunca más.
val repositorioTruncado: Boolean = ordenGit("rev-parse", "--is-shallow-repository") == "true"

android {
    namespace = "com.themakercrowd.silosenosalgo"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.themakercrowd.silosenosalgo"
        // Android 10: cubre de sobra el parque real y evita el laberinto de
        // permisos de ubicación anteriores a Q.
        minSdk = 29
        // Android 16. El dispositivo de pruebas (Galaxy A26) ya va con API 36, y
        // es justo la versión que aprieta lo nuestro: servicios en primer plano
        // de tipo `location` y ubicación en segundo plano. Compilar por debajo
        // dejaría la app en modo compatibilidad y probaríamos algo que no es lo
        // que verá el usuario cuando Play obligue a subir el objetivo.
        targetSdk = 36
        // Sale de git (ver arriba). El 1 solo aparece sin git, y entonces el
        // build de release se para antes de llegar a usarlo.
        versionCode = commitsDeGit ?: 1
        versionName = "1.0"
    }

    signingConfigs {
        // Solo se declara si la clave está de verdad en el disco. Declararla
        // siempre haría fallar cualquier tarea (hasta `assembleDebug`) en un
        // clon recién hecho, que es justo donde no hay clave ni tiene que haberla.
        if (ficheroDeClave != null) {
            create("release") {
                storeFile = ficheroDeClave
                storePassword = datoDeFirma("storePassword", "SLSNS_STORE_PASSWORD")
                keyAlias = datoDeFirma("keyAlias", "SLSNS_KEY_ALIAS")
                keyPassword = datoDeFirma("keyPassword", "SLSNS_KEY_PASSWORD")
                // AGP firma con UN esquema, no con varios a la vez. Medido con
                // `apksigner verify -v` sobre el APK resultante:
                //   sin banderas            -> v2 sí, v3 no
                //   enableV1+V2Signing=true -> v2 sí, v1 NO (la bandera no manda)
                //   enableV2+V3Signing=true -> v3 sí, v2 no
                // O sea que pedir el v2 aquí no aporta nada y engaña al que lo
                // lea. Se pide solo el v3, que es el que permite ROTAR la clave
                // más adelante demostrando la continuidad con la anterior: la
                // única salida que existe si algún día hay que cambiarla fuera
                // de Play. Se puede porque el v3 lo entiende Android 9 y el
                // mínimo aquí es el 10; el v1 solo haría falta por debajo del 7.
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            // Android identifica una app por la pareja (identificador, clave), y
            // debug y release se firman con claves distintas: con el mismo
            // identificador NO pueden convivir en un móvil, y cambiar de una a
            // otra obliga a desinstalar y perder la sesión y los seguimientos
            // locales. El sufijo le da al build de desarrollo un identificador
            // propio, así que el móvil de pruebas puede tener las dos a la vez.
            // El release NO se toca: su identificador es el publicado y ese no
            // puede cambiar nunca.
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Red y modelos: el contrato con el backend es JSON puro, sin ORM.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // El token de sesión, cifrado en reposo (espejo de Keychain.swift).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // El visor web incrustado se sirve desde los assets/copia OTA.
    implementation("androidx.webkit:webkit:1.12.1")

    // Las fotos de las notas llegan con la rotación en el EXIF, no aplicada:
    // sin leerlo se suben tumbadas las tomadas en vertical.
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Sin clave, `assembleRelease` NO falla: escupe un `app-release-unsigned.apk`
// que el móvil rechaza al instalar con un escueto "aplicación no instalada".
// Se tarda un rato en relacionar una cosa con la otra, así que se para aquí.
gradle.taskGraph.whenReady {
    val pideRelease = allTasks.any { tarea ->
        (tarea.name.startsWith("assemble") || tarea.name.startsWith("bundle")) &&
            tarea.name.contains("Release")
    }
    if (!pideRelease) return@whenReady

    if (ficheroDeClave == null) {
        throw GradleException(
            """
            No hay clave de firma y sin ella el artefacto de release no se puede instalar.

            Crea la clave una sola vez:   .\scripts\crear-keystore.ps1     (Windows)
                                          ./scripts/crear-keystore.sh      (macOS/Linux)

            El script deja la clave y `keystore.properties` en `android/`, los dos
            fuera de git. Detalles en ../docs/firma-y-publicacion.md
            """.trimIndent()
        )
    }

    // Un versionCode equivocado no da la cara hasta que ya está publicado, y
    // entonces no hay vuelta atrás: el número gastado queda gastado para
    // siempre. Más vale no construir que construir con uno inventado.
    if (commitsDeGit == null) {
        throw GradleException(
            "No consigo contar los commits con git, y el versionCode sale de ahí. " +
                "¿Es esto un clon del repositorio y está `git` en el PATH?"
        )
    }
    if (repositorioTruncado) {
        throw GradleException(
            """
            El repositorio está truncado (clon superficial) y ahí git cuenta $commitsDeGit
            commits en vez de todos. Publicar con ese versionCode lo dejaría bloqueado
            para siempre en un número bajo.

            Clónalo entero, o en integración continua pide la historia completa
            (`fetch-depth: 0` en GitHub Actions).
            """.trimIndent()
        )
    }

    logger.lifecycle("versionCode $commitsDeGit (commits en git)")
}
