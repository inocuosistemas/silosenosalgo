import SwiftUI
import WebKit
import UIKit

/// Hosts the embedded web viewer.
///  - `.offline(token:)` serves the CURRENT session's data locally under the
///    `appweb://` scheme (works with no connectivity).
///  - `.online(url:)` loads any URL directly (e.g. a finished session's public link).
struct WebView: UIViewRepresentable {
    enum Source {
        case offline(token: String)
        case online(url: URL)
    }

    let source: Source

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        if case .offline = source {
            cfg.setURLSchemeHandler(context.coordinator.handler, forURLScheme: AppWebSchemeHandler.scheme)
        }
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.scrollView.bounces = false
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.008, green: 0.024, blue: 0.090, alpha: 1) // slate-950
        web.load(request())
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func request() -> URLRequest {
        switch source {
        case .offline(let token):
            var comps = URLComponents()
            comps.scheme = AppWebSchemeHandler.scheme
            comps.host = "viewer"
            comps.path = "/index.html"
            comps.queryItems = [
                URLQueryItem(name: "t", value: token),
                URLQueryItem(name: "embedded", value: "1"),
            ]
            return URLRequest(url: comps.url!)
        case .online(let url):
            return URLRequest(url: url)
        }
    }

    /// Retains the scheme handler for the web view's lifetime.
    final class Coordinator {
        let handler = AppWebSchemeHandler()
    }
}
