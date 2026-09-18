import SwiftUI

/// Full-screen in-app "live" view of a beacon: the same web viewer followers see,
/// but served locally (offline) for the current session, or online for a finished
/// one. When offline, exposes the corridor map-download screen.
struct LiveMapView: View {
    let source: WebView.Source
    /// Session id whose route to pre-download tiles for; nil hides the map-download
    /// button (online sessions use live tiles directly).
    let offlineToken: String?
    var allowsEditing = true
    var title = "En directo"

    @ObservedObject private var store = TrackingStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var showDownload = false
    @State private var showAddNote = false
    @State private var showNotes = false
    /// Si lo que se está viendo es la sesión que emite AHORA (y no un
    /// seguimiento acabado ni una guía).
    private var esLaDeAhora: Bool {
        store.isSharing && offlineToken != nil && offlineToken == store.claveDeDatos
    }

    /// Alto de la fila de botones flotantes: el de la barra de navegación de
    /// iOS a la que sustituye, para que la tarjeta de datos del visor quede
    /// exactamente donde estaba. Lo que crece es el mapa, no se mueve la tarjeta.
    private static let altoBarra: CGFloat = 44

    var body: some View {
        // El mapa de borde a borde —bajo la muesca y hasta la barra de inicio—
        // con los botones flotando encima, como en cualquier app de mapas. Antes
        // iba debajo de una barra de navegación que se comía la franja de
        // arriba y en la que "En directo", "Volver" y tres botones no cabían.
        ZStack(alignment: .top) {
            WebView(source: source, barraApp: Self.altoBarra)
                .ignoresSafeArea()

            HStack(spacing: 8) {
                Button { dismiss() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.body.weight(.semibold))
                        Text("Volver")
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                }
                .foregroundStyle(Theme.sky500)
                .background(.ultraThinMaterial, in: Capsule())
                .accessibilityLabel("Volver")

                // El nombre, solo cuando no es la sesión que emite (una guía,
                // un seguimiento anterior): de esa ya habla la pastilla de abajo.
                if !esLaDeAhora && !title.isEmpty {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.slate100)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(.ultraThinMaterial, in: Capsule())
                }

                Spacer(minLength: 0)

                if offlineToken != nil {
                    HStack(spacing: 2) {
                        if allowsEditing {
                            botonFlotante("list.bullet.rectangle", "Ver notas, \(store.noteCount)") { showNotes = true }
                            botonFlotante("square.and.pencil", "Añadir nota aquí") { showAddNote = true }
                                .disabled(store.isStandby)
                        }
                        botonFlotante("arrow.down.circle", "Descargar mapa offline") { showDownload = true }
                    }
                    .padding(.horizontal, 4)
                    .background(.ultraThinMaterial, in: Capsule())
                }
            }
            .environment(\.colorScheme, .dark)
            .padding(.horizontal, 12)
            .padding(.top, 2)
            .frame(height: Self.altoBarra, alignment: .top)
        }
        .sheet(isPresented: $showDownload) {
            MapDownloadView(routeName: nil,
                            polyline: offlineToken.flatMap { PlanGeometry.routePolyline(forSession: $0) })
        }
        .sheet(isPresented: $showAddNote) {
            AddNoteView()
        }
        .sheet(isPresented: $showNotes) {
            NotesListView()
        }
    }

    private func botonFlotante(_ icono: String, _ etiqueta: String, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            Image(systemName: icono)
                .font(.body)
                .frame(width: 40, height: 40)
        }
        .foregroundStyle(Theme.sky500)
        .accessibilityLabel(etiqueta)
    }
}

/// La salida de emergencia de una pantalla completa que no tiene nada que
/// enseñar.
///
/// Un `fullScreenCover` cuyo contenido se evalúa a vacío no se queda a medias:
/// presenta una pantalla NEGRA, sin barra de navegación y sin gesto para
/// cerrarla, y deja la app encerrada hasta que la matan. Pasó de verdad, con la
/// baliza grabando sin cobertura. Así que ninguna de esas presentaciones se
/// queda sin contenido: si no hay mapa, hay esto, que al menos sabe volver.
struct SinMapa: View {
    let volver: () -> Void

    var body: some View {
        ZStack {
            Theme.slate950.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "map")
                    .font(.system(size: 40))
                    .foregroundStyle(Theme.slate400)
                Text("Todavía no hay mapa que enseñar")
                    .font(.headline)
                    .foregroundStyle(Theme.slate100)
                Text("La baliza sigue grabando. Vuelve a intentarlo en un momento.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.slate400)
                    .multilineTextAlignment(.center)
                Button("Volver", action: volver)
                    .font(.body.weight(.semibold))
                    .tint(Theme.sky500)
                    .padding(.top, 8)
            }
            .padding(32)
        }
    }
}
