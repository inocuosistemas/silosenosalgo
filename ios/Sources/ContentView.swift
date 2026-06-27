import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        switch auth.status {
        case .loading:
            ProgressView("Cargando…")
        case .anonymous:
            LoginView()
        case .authed:
            if let token = auth.token {
                TrackingView(token: token)
            } else {
                LoginView()
            }
        }
    }
}
