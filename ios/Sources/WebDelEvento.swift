import SwiftUI
import SafariServices

/// Una sección de la web de una carrera: su clave en la dirección (`v=`) y cómo
/// se nombra en el menú. Espejo de `pestanasDelEvento` en `src/lib/vistaEvento.ts`.
struct SeccionEvento: Hashable {
    let vista: String
    let texto: String
}

/// Abrir la web de una carrera DESDE LA APP, en su sección y con la sesión ya
/// iniciada.
///
/// Antes solo había un "Parrilla" que abría Safari, y Safari no sabe nada del
/// token de la app: la web pedía entrar otra vez, y la porra o tu plan quedaban
/// a tres toques más. Ahora la app pide un pase de un solo uso y abre la
/// sección directamente (ver `functions/api/auth/pase.ts`).
enum WebDelEvento {
    /// Las secciones que tiene sentido abrir, en el mismo orden que la barra de
    /// la web. Terminada, resultados y replay van primero: es lo que se busca.
    static func secciones(de ev: EventSummary) -> [SeccionEvento] {
        var s: [SeccionEvento] = []
        if ev.isOver {
            s.append(SeccionEvento(vista: "meta", texto: "🏆  Resultados"))
            s.append(SeccionEvento(vista: "replay", texto: "⏱️  Replay"))
        }
        s.append(SeccionEvento(vista: "parrilla", texto: "🏁  Parrilla"))
        s.append(SeccionEvento(vista: "mapa", texto: "🗺️  Mapa"))
        if ev.betsEnabled != false { s.append(SeccionEvento(vista: "porra", texto: "🔮  Porra")) }
        if ev.isMember != false && !ev.isOver { s.append(SeccionEvento(vista: "plan", texto: "🧭  Mi plan")) }
        return s
    }

    /// La dirección de la sección, con un pase si se consigue. Sin cobertura o
    /// contra un servidor anterior al pase, la dirección a secas: la web pedirá
    /// entrar, como antes, pero se abre igual.
    static func enlace(eventId: String, vista: String, token: String?) async -> URL? {
        let destino = "/?e=\(eventId)&v=\(vista)"
        if let token, let pase = try? await API.pase(token: token) {
            var c = URLComponents(url: Config.baseURL.appendingPathComponent("api/auth/entra"),
                                  resolvingAgainstBaseURL: false)
            c?.queryItems = [URLQueryItem(name: "pase", value: pase), URLQueryItem(name: "a", value: destino)]
            if let url = c?.url { return url }
        }
        return URL(string: Config.publicURL + destino)
    }
}

/// Una dirección que enseñar en una hoja: `Identifiable` para `.sheet(item:)`.
struct EnlaceWeb: Identifiable {
    let id = UUID()
    let url: URL
}

/// La web dentro de la app, con los mandos de Safari. Guarda su sesión de una
/// vez para otra, así que el pase solo hace falta la primera.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.sky500)
        vc.dismissButtonStyle = .close
        return vc
    }

    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
