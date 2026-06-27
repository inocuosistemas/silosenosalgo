import SwiftUI

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
                .task { await auth.bootstrap() }
        }
    }
}
