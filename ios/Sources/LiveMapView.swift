import SwiftUI

/// Full-screen in-app "live" view of a beacon: the same web viewer followers see,
/// but served locally (offline) for the current session, or online for a finished
/// one. When offline, exposes the corridor map-download screen.
struct LiveMapView: View {
    let source: WebView.Source
    /// Session id whose route to pre-download tiles for; nil hides the map-download
    /// button (online sessions use live tiles directly).
    let offlineToken: String?

    @Environment(\.dismiss) private var dismiss
    @State private var showDownload = false

    var body: some View {
        NavigationStack {
            WebView(source: source)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("En directo")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Cerrar") { dismiss() }.tint(Theme.sky500)
                    }
                    if offlineToken != nil {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button { showDownload = true } label: {
                                Image(systemName: "arrow.down.circle")
                            }
                            .tint(Theme.sky500)
                            .accessibilityLabel("Descargar mapa offline")
                        }
                    }
                }
                .sheet(isPresented: $showDownload) {
                    MapDownloadView(token: offlineToken)
                }
        }
    }
}
