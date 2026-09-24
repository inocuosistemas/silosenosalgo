import SwiftUI

/// Las pestañas de la pantalla principal.
enum PestanaPrincipal: Hashable {
    case baliza, carreras, enDirecto, archivo
}

/**
 La pantalla principal, en cuatro pestañas: lo que era una sola lista con
 todo —la baliza, las carreras, las tarjetas en directo, lo grabado y la
 cuenta— abrumaba al entrar.

 - Baliza: lo de salir, y en marcha, solo lo de la salida.
 - Carreras: las tuyas, con su menú «Abrir».
 - En directo: las tarjetas de la pantalla de bloqueo y el widget. Lleva un
   punto cuando hay una en marcha.
 - Archivo: salidas, guías y la cuenta.

 Cada pestaña es la misma `TrackingView` enseñando solo sus secciones: así no
 cambia cómo funciona nada, solo dónde está.
 */
struct PantallaPrincipal: View {
    @ObservedObject private var navegacion = Navegacion.shared
    @ObservedObject private var viaje = ViajeEnDirecto.shared
    @ObservedObject private var carrera = CarreraEnDirecto.shared

    /// La pestaña elegida, compartida: al elegir una carrera para la baliza
    /// se salta a la pestaña de la baliza (ver `TrackingView.tocaCarrera`).
    @MainActor
    final class Navegacion: ObservableObject {
        static let shared = Navegacion()
        @Published var pestana: PestanaPrincipal = .baliza
    }

    private var enMarcha: Int { (viaje.enMarcha ? 1 : 0) + (carrera.enMarcha ? 1 : 0) }

    var body: some View {
        TabView(selection: $navegacion.pestana) {
            TrackingView(pestana: .baliza)
                .tabItem { Label("Baliza", systemImage: "dot.radiowaves.left.and.right") }
                .tag(PestanaPrincipal.baliza)
            TrackingView(pestana: .carreras)
                .tabItem { Label("Carreras", systemImage: "flag.checkered") }
                .tag(PestanaPrincipal.carreras)
            TrackingView(pestana: .enDirecto)
                .tabItem { Label("En directo", systemImage: "rectangle.inset.filled") }
                .badge(enMarcha)
                .tag(PestanaPrincipal.enDirecto)
            TrackingView(pestana: .archivo)
                .tabItem { Label("Archivo", systemImage: "tray.full") }
                .tag(PestanaPrincipal.archivo)
        }
        .tint(Theme.sky500)
    }
}
