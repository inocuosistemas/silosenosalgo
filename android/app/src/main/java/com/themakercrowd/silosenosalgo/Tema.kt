package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * La misma piel que iOS. Los colores están copiados uno a uno de `Theme` en
 * `ios/Sources/ContentView.swift`, que a su vez son los de la web (la escala
 * `slate` y `sky` de Tailwind).
 *
 * Que las tres coincidan no es coquetería: quien sale a andar mira el visor web
 * desde el móvil, la app y a veces el ordenador de casa en la misma tarde, y una
 * app clara junto a un visor oscuro se lee como dos productos distintos.
 *
 * Es un tema OSCURO fijo, no uno que siga al sistema. Tampoco es capricho: esto
 * se usa de noche en el monte, y una pantalla blanca a las cuatro de la mañana
 * te deja sin visión nocturna y se ve a un kilómetro.
 */
object Paleta {
    val slate950 = Color(0xFF020617)
    val slate900 = Color(0xFF0F172A)
    val slate800 = Color(0xFF1E293B)
    val slate700 = Color(0xFF334155)
    val slate400 = Color(0xFF94A3B8)
    val slate100 = Color(0xFFF1F5F9)
    val sky600 = Color(0xFF0284C7)
    val sky500 = Color(0xFF0EA5E9)
    val verde = Color(0xFF22C55E)
    val ambar = Color(0xFFF59E0B)
    val rojo = Color(0xFFF87171)
}

private val esquemaOscuro = darkColorScheme(
    primary = Paleta.sky500,
    onPrimary = Paleta.slate950,
    primaryContainer = Paleta.sky600,
    onPrimaryContainer = Paleta.slate100,
    background = Paleta.slate950,
    onBackground = Paleta.slate100,
    surface = Paleta.slate900,
    onSurface = Paleta.slate100,
    surfaceVariant = Paleta.slate800,
    onSurfaceVariant = Paleta.slate400,
    outline = Paleta.slate700,
    error = Paleta.rojo,
    onError = Paleta.slate950,
)

@Composable
fun TemaSlsns(contenido: @Composable () -> Unit) {
    MaterialTheme(colorScheme = esquemaOscuro, content = contenido)
}

/**
 * Una sección con cabecera y pie, como las del formulario de iOS: el contenido
 * en una tarjeta y, colgando fuera, un título arriba y una explicación abajo.
 *
 * El pie no es relleno: es donde iOS cuenta *por qué* importa cada ajuste, y es
 * lo que evita que alguien elija "Ahorro" sin saber qué está cediendo.
 */
@Composable
fun Seccion(
    titulo: String? = null,
    pie: String? = null,
    modifier: Modifier = Modifier,
    contenido: @Composable () -> Unit,
) {
    Column(modifier.fillMaxWidth().padding(bottom = 22.dp)) {
        titulo?.let {
            Text(
                it.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = Paleta.slate400,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(start = 6.dp, bottom = 7.dp),
            )
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Paleta.slate900),
            shape = RoundedCornerShape(14.dp),
            // Un borde tenue además del color: sobre fondo oscuro la diferencia
            // entre dos grises cercanos se pierde según el brillo de la pantalla
            // y el sol de la calle, y el borde sostiene la separación igual.
            border = BorderStroke(1.dp, Paleta.slate800),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) { contenido() }
        }
        pie?.let {
            Spacer(Modifier.height(7.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = Paleta.slate400,
                modifier = Modifier.padding(horizontal = 6.dp),
            )
        }
    }
}
