package com.themakercrowd.silosenosalgo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * La pastilla que dice que se está bajando una versión nueva de la web de la
 * app (el mapa, el visor), con su porcentaje. Solo sale si hay algo que bajar:
 * casi siempre son pocos ficheros y ni se llega a ver. Espejo de
 * `AvisoDeWebNueva` en iOS.
 */
@Composable
fun AvisoDeWebNueva() {
    val f by ProgresoDeWeb.fraccion.collectAsState()
    val fraccion = f ?: return
    Box(Modifier.fillMaxWidth().padding(bottom = 6.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .background(Paleta.slate900, RoundedCornerShape(50))
                .border(1.dp, Paleta.slate700, RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("⬇", color = Paleta.sky500, fontSize = 14.sp)
            Column {
                Text(
                    "Actualizando la app · ${(fraccion * 100).toInt()} %",
                    color = Paleta.slate100, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.padding(top = 3.dp))
                LinearProgressIndicator(progress = { fraccion }, modifier = Modifier.width(150.dp), color = Paleta.sky500)
            }
        }
    }
}
