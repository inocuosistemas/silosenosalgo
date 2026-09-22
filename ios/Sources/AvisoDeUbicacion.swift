import CoreLocation
import SwiftUI
import UIKit

/**
 El aviso de que falta el permiso de ubicación «Siempre», con un botón para
 darlo desde la app.

 El botón PIDE el permiso, y si iOS no enseña nada, abre los Ajustes de la app
 donde se cambia. Hace falta lo segundo porque iOS solo pregunta por «Permitir
 siempre» UNA vez en la vida de la app, y esta ya lo pide al empezar a
 compartir: en casi todos los móviles esa pregunta ya está gastada, y pedirla
 otra vez no hace nada. Se sabe que no ha salido porque, cuando sale, la app
 deja de estar activa mientras está la pregunta delante.
 */
struct AvisoDeUbicacion: View {
    let estado: CLAuthorizationStatus
    let pide: () -> Void

    private var denegado: Bool { estado == .denied || estado == .restricted }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: denegado ? "location.slash.fill" : "location.fill")
                    .foregroundStyle(denegado ? .red : .orange)
                Text(denegado
                     ? "El permiso de ubicación está desactivado: la baliza y el viaje en directo no pueden saber dónde estás."
                     : "Tienes la ubicación en «Mientras se usa». Para seguir compartiendo con la pantalla apagada hace falta «Siempre».")
                    .font(.footnote)
                    .foregroundStyle(denegado ? .red : .orange)
                    // Entero, en las líneas que haga falta: cortado con «…» no
                    // se sabía qué había que hacer.
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                if denegado { abreAjustes() } else { pideOAbreAjustes() }
            } label: {
                Label(denegado ? "Abrir Ajustes" : "Permitir siempre", systemImage: "location.circle")
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(denegado ? .red : .orange)
        }
        .padding(.vertical, 4)
    }

    private func pideOAbreAjustes() {
        pide()
        // Si al cabo de un momento la app sigue activa, es que iOS no ha
        // enseñado la pregunta (ya la había hecho alguna vez): a Ajustes.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if UIApplication.shared.applicationState == .active,
               CLLocationManager().authorizationStatus != .authorizedAlways {
                abreAjustes()
            }
        }
    }

    private func abreAjustes() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}
