import SwiftUI

/**
 La pastilla que dice que se está bajando una versión nueva de la web de la
 app (el mapa, el visor): con su porcentaje mientras se baja, y «lista» si se
 bajó con el mapa abierto y entrará al volver a abrirlo. Solo sale si hay algo
 que bajar: casi siempre son pocos ficheros y ni se llega a ver.
 */
struct AvisoDeWebNueva: View {
    @ObservedObject private var progreso = ProgresoDeWeb.shared

    var body: some View {
        Group {
            if let f = progreso.fraccion {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.down.circle").foregroundStyle(Theme.sky500)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Actualizando la app · \(Int((f * 100).rounded())) %")
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.slate100)
                        ProgressView(value: f).tint(Theme.sky500).frame(width: 150)
                    }
                }
            } else if progreso.lista {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("Mapa nuevo listo: se verá al volver a abrirlo")
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.slate100)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Theme.slate900.opacity(0.95), in: Capsule())
        .overlay(Capsule().stroke(Theme.slate700, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
        .opacity(progreso.fraccion != nil || progreso.lista ? 1 : 0)
        .animation(.easeInOut(duration: 0.25), value: progreso.fraccion != nil || progreso.lista)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
    }
}
