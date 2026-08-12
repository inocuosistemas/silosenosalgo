import SwiftUI
import UIKit

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var guideLibrary = GuideLibrary.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
                .task { await auth.bootstrap() }
                // Busca visor web nuevo al arrancar, nunca con el visor abierto:
                // cambiar los assets bajo un WKWebView vivo lo romperia. Si hay
                // build nuevo, entra en la siguiente apertura del visor.
                .task { await WebOTAUpdater.shared.refresh() }
                .onOpenURL { url in
                    guard url.pathExtension.lowercased() == "slsnsguide" else { return }
                    Task { await guideLibrary.openImportedGuide(from: url) }
                }
                .fullScreenCover(item: $guideLibrary.presentedGuide) { guide in
                    LiveMapView(
                        source: .offline(token: guide.id), offlineToken: guide.id,
                        allowsEditing: false, title: "Guía offline"
                    )
                }
                .alert("Guías offline", isPresented: Binding(
                    get: { guideLibrary.importError != nil },
                    set: { if !$0 { guideLibrary.importError = nil } }
                )) {
                    Button("Aceptar", role: .cancel) { guideLibrary.importError = nil }
                } message: {
                    Text(guideLibrary.importError ?? "")
                }
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
