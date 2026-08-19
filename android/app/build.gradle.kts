plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

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
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
