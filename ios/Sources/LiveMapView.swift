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

    var body: some View {
        NavigationStack {
            WebView(source: source)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button { dismiss() } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left")
                                    .font(.body.weight(.semibold))
                                Text("Volver")
                            }
                        }
                        .tint(Theme.sky500)
                        .accessibilityLabel("Volver")
                    }
                    if offlineToken != nil {
                        ToolbarItemGroup(placement: .navigationBarTrailing) {
                            if allowsEditing {
                                Button { showNotes = true } label: {
                                    Image(systemName: "list.bullet.rectangle")
                                }
                                .tint(Theme.sky500)
                                .accessibilityLabel("Ver notas, \(store.noteCount)")

                                Button { showAddNote = true } label: {
                                    Image(systemName: "square.and.pencil")
                                }
                                .tint(Theme.sky500)
                                .disabled(store.isStandby)
                                .accessibilityLabel("Añadir nota aquí")
                            }

                            Button { showDownload = true } label: {
                                Image(systemName: "arrow.down.circle")
                            }
                            .tint(Theme.sky500)
                            .accessibilityLabel("Descargar mapa offline")
                        }
                    }
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
