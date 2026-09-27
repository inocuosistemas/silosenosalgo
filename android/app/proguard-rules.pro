# Reglas de R8 para SiLoSeNoSalgo (encima de proguard-android-optimize.txt).
#
# kotlinx.serialization, OkHttp y las librerías de AndroidX traen sus propias
# reglas dentro de la librería; aquí va solo lo nuestro.

# Los fallos, con su fichero y su línea: sin esto, los informes de Google Play
# llegan con «Unknown Source» aunque se suba el mapa.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# El puente con la web del conversor de GPX (ConversorGpx.kt): la página llama a
# estos métodos por su NOMBRE desde JavaScript, así que no se pueden renombrar.
-keepclassmembers class com.themakercrowd.silosenosalgo.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Las clases @Serializable: el plugin genera su serializador, pero su nombre y
# sus campos viajan como texto (JSON con el servidor y guardado en disco).
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class com.themakercrowd.silosenosalgo.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.themakercrowd.silosenosalgo.** {
    kotlinx.serialization.KSerializer serializer(...);
}
