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

    var body: some View {
        // El mapa de borde a borde, bajo una barra de navegación TRANSPARENTE:
        // los botones los dibuja iOS —el cristal de iOS 26, con el contraste
        // que el sistema ajusta según lo que tienen debajo— y el mapa llega
        // hasta arriba por detrás. Probé a pintarlos a mano, flotando, y se
        // perdían sobre un mapa claro: el sistema hace algo que no se imita.
        NavigationStack {
            WebView(source: source, barraApp: Self.altoBarra)
                .ignoresSafeArea()
                // Sin título en la sesión que emite: lo que decía lo dice la
                // pastilla de abajo del mapa.
                .navigationTitle(esLaDeAhora ? "" : title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.hidden, for: .navigationBar)
                // El cristal de los botones, en su variante OSCURA y con el
                // texto en blanco: el claro, con el azul encima, se deshacía
                // sobre un mapa claro. Sigue siendo el botón del sistema; solo
                // cambia su esquema. La hora y la batería, en claro sobre el
                // difuminado oscuro de arriba.
                .toolbarColorScheme(.dark, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button { dismiss() } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left")
                                    .font(.body.weight(.semibold))
                                Text("Volver")
                            }
                        }
                        .tint(.white)
                        .accessibilityLabel("Volver")
                    }
                    if offlineToken != nil {
                        ToolbarItemGroup(placement: .navigationBarTrailing) {
                            if allowsEditing {
                                Button { showNotes = true } label: {
                                    Image(systemName: "list.bullet.rectangle")
                                }
                                .tint(.white)
                                .accessibilityLabel("Ver notas, \(store.noteCount)")

                                Button { showAddNote = true } label: {
                                    Image(systemName: "square.and.pencil")
                                }
                                .tint(.white)
                                .disabled(store.isStandby)
                                .accessibilityLabel("Añadir nota aquí")
                            }
                            Button { showDownload = true } label: {
                                Image(systemName: "arrow.down.circle")
                            }
                            .tint(.white)
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

    /// Lo que el visor aparta su tarjeta de datos además de su margen seguro.
    /// Cero: con una barra de navegación de verdad encima, el margen seguro que
    /// le llega al visor YA incluye la barra, y sumarla otra vez bajaba la
    /// tarjeta el doble.
    private static let altoBarra: CGFloat = 0
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
