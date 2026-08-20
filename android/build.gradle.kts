plugins {
    // 8.9 es la primera rama probada contra compileSdk 36; con la anterior el
    // build funcionaba pero avisaba de que el SDK le venía de nuevas.
    id("com.android.application") version "8.9.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
}
