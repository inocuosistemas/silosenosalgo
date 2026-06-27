import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        ZStack {
            Theme.slate950.ignoresSafeArea()
            switch auth.status {
            case .loading:
                ProgressView("Cargando…")
                    .tint(Theme.sky500)
                    .foregroundStyle(Theme.slate400)
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
}

/// Palette mirroring the web app (Tailwind slate + sky).
enum Theme {
    static let slate950 = Color(red: 0.008, green: 0.024, blue: 0.090) // #020617
    static let slate900 = Color(red: 0.059, green: 0.090, blue: 0.165) // #0f172a
    static let slate800 = Color(red: 0.118, green: 0.161, blue: 0.231) // #1e293b
    static let slate700 = Color(red: 0.200, green: 0.255, blue: 0.333) // #334155
    static let slate400 = Color(red: 0.580, green: 0.639, blue: 0.722) // #94a3b8
    static let slate100 = Color(red: 0.945, green: 0.961, blue: 0.976) // #f1f5f9
    static let sky600   = Color(red: 0.008, green: 0.518, blue: 0.780) // #0284c7
    static let sky500   = Color(red: 0.055, green: 0.647, blue: 0.914) // #0ea5e9
}

extension View {
    /// Dark, rounded text-field surface to match the web inputs.
    func appField() -> some View {
        self
            .padding(12)
            .background(Theme.slate900)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.slate700, lineWidth: 1))
            .cornerRadius(10)
            .foregroundStyle(Theme.slate100)
            .tint(Theme.sky500)
    }
}
