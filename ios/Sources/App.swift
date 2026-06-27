import SwiftUI

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .task { await auth.bootstrap() }
        }
    }
}
