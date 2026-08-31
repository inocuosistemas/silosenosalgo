import Foundation
import UserNotifications

/// Posts a system notification when followers leave new cheers, mirroring the
/// Android "ánimos" channel: whoever walks carries the phone in a pocket, and a
/// message that only shows when the map is opened reaches nobody — the point of
/// a cheer is to arrive when it arrives.
final class CheerNotifier {
    static let shared = CheerNotifier()
    private init() {}

    private let lock = NSLock()

    /// The newest cheer instant already known (epoch ms). The cut means the
    /// first batch after a launch only primes it: opening the app on a route
    /// with twenty messages must not fire twenty alerts.
    private var lastSeenMs: Double = 0

    /// Ask for permission when the tracking screen opens (like Android asks for
    /// POST_NOTIFICATIONS on the portal), not mid-route when the first cheer
    /// lands and it's too late to answer a dialog.
    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Called with every cheers payload fetched from the public endpoint.
    /// Thread-safe; the payload stays untyped on purpose — its shape belongs to
    /// the backend and the viewer, and only three fields matter here.
    func notifyNew(_ cheers: [[String: Any]]) {
        lock.lock()
        let firstBatch = lastSeenMs == 0
        let cut = lastSeenMs
        if let newest = cheers.compactMap({ $0["createdAt"] as? Double }).max(), newest > lastSeenMs {
            lastSeenMs = newest
        }
        lock.unlock()

        // Own reactions come back with mine=true; being congratulated by
        // yourself is not news.
        let fresh = cheers.filter {
            (($0["createdAt"] as? Double) ?? 0) > cut && (($0["mine"] as? Bool) ?? false) == false
        }
        guard !firstBatch, !fresh.isEmpty else { return }

        let latest = fresh.max { (($0["createdAt"] as? Double) ?? 0) < (($1["createdAt"] as? Double) ?? 0) }
        let nick = ((latest?["nick"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        let content = UNMutableNotificationContent()
        content.title = fresh.count > 1
            ? "💬 \(fresh.count) ánimos nuevos"
            : (nick.isEmpty ? "💬 Un ánimo nuevo" : "💬 \(nick) te anima")
        content.body = (latest?["body"] as? String) ?? ""
        content.sound = .default
        // A fixed identifier: a burst of cheers replaces the banner instead of
        // stacking one notification per fetch.
        let request = UNNotificationRequest(identifier: "cheer", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
