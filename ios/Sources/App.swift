import SwiftUI
import UIKit

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
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

/// Handles LAUNCH — including a headless background relaunch by iOS for a
/// significant-location-change (the SwiftUI scene/`.task` may not run then). If a
/// beacon was left active, resume it right away so it survives an app kill.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // UIKit lifecycle callbacks run on the main thread, where TrackingStore
        // (a @MainActor singleton) is safe to touch.
        MainActor.assumeIsolated {
            if let token = Keychain.load() {
                TrackingStore.shared.configure(token: token)
                TrackingStore.shared.restoreActiveSession()
            }
        }
        return true
    }
}
