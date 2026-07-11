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
