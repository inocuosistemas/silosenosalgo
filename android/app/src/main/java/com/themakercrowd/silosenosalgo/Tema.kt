package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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

    /**
     * Los doce colores de los participantes de un evento (shared/eventColors.ts).
     *
     * Duplicados aquí a propósito, como los umbrales de TrackingRules: son doce
     * constantes que no cambian, y pedirle al servidor un color para pintar un
     * punto en una pantalla que tiene que funcionar sin cobertura sería peor. Un
     * slug que no se reconozca —porque la web añadiera uno— cae en gris, no en
     * un fallo.
     */
    private val coloresEvento = mapOf(
        "sky" to Color(0xFF0EA5E9), "emerald" to Color(0xFF10B981), "amber" to Color(0xFFF59E0B),
        "rose" to Color(0xFFF43F5E), "violet" to Color(0xFF8B5CF6), "lime" to Color(0xFFA3E635),
        "orange" to Color(0xFFFB923C), "cyan" to Color(0xFF22D3EE), "fuchsia" to Color(0xFFE879F9),
        "teal" to Color(0xFF2DD4BF), "indigo" to Color(0xFF818CF8), "pink" to Color(0xFFF472B6),
    )

    fun colorEvento(slug: String?): Color = coloresEvento[slug] ?: slate400
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

/**
 * Una sección PLEGADA que enseña lo elegido y se abre para cambiarlo.
 *
 * La pantalla de la baliza acumula decisiones que se toman una vez —el evento,
 * la ruta, la hora, el ritmo, la retención— y luego solo se consultan. Con todo
 * desplegado a la vez, lo que hay es un muro de mandos donde cuesta encontrar
 * el que se busca y, peor, cuesta ver de un vistazo QUÉ está elegido.
 *
 * Plegada muestra el resumen —lo que está puesto— y basta tocarla para
 * cambiarlo. Abierta es exactamente la sección de siempre.
 */
@Composable
fun SeccionPlegable(
    titulo: String,
    resumen: String,
    pie: String? = null,
    /** Abierta de partida: para lo que aún está sin decidir. */
    abiertaPorDefecto: Boolean = false,
    contenido: @Composable () -> Unit,
) {
    var abierta by remember { mutableStateOf(abiertaPorDefecto) }
    Seccion(titulo = titulo, pie = if (abierta) pie else null) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { abierta = !abierta },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                resumen,
                style = MaterialTheme.typography.bodyMedium,
                color = Paleta.slate100,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                if (abierta) "▾" else "▸",
                style = MaterialTheme.typography.bodyMedium,
                color = Paleta.sky500,
            )
        }
        if (abierta) {
            Spacer(Modifier.height(12.dp))
            contenido()
        }
    }
}
