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
    /// Alto de la fila de botones que la app pone flotando encima del mapa. El
    /// visor va de borde a borde (bajo la muesca y la barra de inicio) y aparta
    /// su tarjeta de datos esto más la muesca. Ver `bordeABorde` en `main.tsx`.
    var barraApp: CGFloat = 0

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        if case .offline = source {
            cfg.setURLSchemeHandler(context.coordinator.handler, forURLScheme: AppWebSchemeHandler.scheme)
        }
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.scrollView.bounces = false
        // De borde a borde de verdad: sin que la vista de desplazamiento meta
        // sus propios márgenes; los pone la página con `env(safe-area-inset-*)`.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // Bajo la barra de navegación, iOS 26 pone una franja para que se lean
        // la hora y los botones. Se deja —es lo que las hace legibles—, pero en
        // su modo suave, un degradado: el mapa se sigue viendo hasta arriba.
        if #available(iOS 26.0, *) {
            web.scrollView.topEdgeEffect.style = .soft
        }
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.008, green: 0.024, blue: 0.090, alpha: 1) // slate-950
        web.load(request())
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// Lo que le pide al visor que vaya de borde a borde.
    private var bordeABorde: [URLQueryItem] {
        [URLQueryItem(name: "bordeABorde", value: "1"),
         URLQueryItem(name: "barraApp", value: String(Int(barraApp.rounded())))]
    }

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
            ] + bordeABorde
            return URLRequest(url: comps.url!)
        case .online(let url):
            guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return URLRequest(url: url) }
            comps.queryItems = (comps.queryItems ?? []) + bordeABorde
            return URLRequest(url: comps.url ?? url)
        }
    }

    /// Retains the scheme handler for the web view's lifetime.
    final class Coordinator {
        let handler = AppWebSchemeHandler()
    }
}
