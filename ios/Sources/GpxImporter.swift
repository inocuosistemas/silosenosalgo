import Foundation
import UIKit
import WebKit

/**
 Convierte un GPX en ruta con el MISMO código que la web.

 La app no sabe leer GPX, y reescribir el lector en Swift sería tener dos que
 acaban diciendo cosas distintas (distancias, desnivel, waypoints). Así que se
 carga, en un visor oculto, la web que la app ya lleva dentro para ir sin
 cobertura —`index.html?convierte=gpx`, una página sin interfaz—, se le pasa el
 fichero y devuelve la ruta hecha: el documento comprimido listo para subir y
 los datos para la lista. Todo en el móvil: funciona en modo avión.

 Ver `src/lib/convierteGpx.ts`.
 */
@MainActor
final class GpxImporter: NSObject {
    struct Ruta {
        let nombre: String
        let distanciaKm: Double
        let desnivelM: Double
        /// El documento de la ruta, comprimido: lo que se sube tal cual.
        let cuerpo: Data
    }

    enum Fallo: LocalizedError {
        case noArranca
        case conversion(String)
        var errorDescription: String? {
            switch self {
            case .noArranca: return "No se pudo preparar el lector de GPX. Vuelve a intentarlo."
            case .conversion(let m): return m
            }
        }
    }

    private let manejador = AppWebSchemeHandler()
    private var web: WKWebView?

    func convierte(texto: String, fichero: String, actividad: String?) async throws -> Ruta {
        let web = try await preparado()
        let resultado: Any?
        do {
            // `callAsyncJavaScript` pasa los argumentos como valores de verdad
            // —sin montar a mano una cadena JS con un GPX de megas dentro— y
            // espera a la promesa.
            resultado = try await web.callAsyncJavaScript(
                "return await window.slsnsGpxARuta(texto, fichero, actividad)",
                arguments: ["texto": texto, "fichero": fichero, "actividad": actividad ?? ""],
                contentWorld: .page
            )
        } catch {
            // Los errores del lector vienen en castellano ("El GPX no contiene
            // puntos de track"): se enseñan tal cual.
            let ns = error as NSError
            let mensaje = (ns.userInfo["WKJavaScriptExceptionMessage"] as? String)?
                .replacingOccurrences(of: "Error: ", with: "")
            throw Fallo.conversion(mensaje ?? "Ese fichero no es un GPX que se pueda leer.")
        }
        guard let d = resultado as? [String: Any],
              let nombre = d["nombre"] as? String,
              let km = d["distanciaKm"] as? Double,
              let desnivel = d["desnivelM"] as? Double,
              let b64 = d["cuerpoBase64"] as? String,
              let cuerpo = Data(base64Encoded: b64) else {
            throw Fallo.conversion("Ese fichero no es un GPX que se pueda leer.")
        }
        return Ruta(nombre: nombre, distanciaKm: km, desnivelM: desnivel, cuerpo: cuerpo)
    }

    /// El visor oculto, cargado y con el conversor a punto. Se crea una vez.
    private func preparado() async throws -> WKWebView {
        if let web { return web }
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(manejador, forURLScheme: AppWebSchemeHandler.scheme)
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: cfg)
        // Colgado de la ventana, invisible y sin tocarse. Por prudencia: a un
        // visor que no está en ninguna ventana iOS puede suspenderle el proceso
        // web, y dentro de ella WebKit lo trata como uno más.
        //
        // (Si el conversor no dice "listo", mirar antes la copia OTA de la web:
        // manda sobre la empaquetada, y una copia anterior al conversor no lo
        // trae. Fue eso, no la suspensión, lo que falló en las pruebas.)
        web.alpha = 0
        web.isUserInteractionEnabled = false
        let ventana = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow ?? ($0 as? UIWindowScene)?.windows.first }
            .first
        ventana?.addSubview(web)
        var comps = URLComponents()
        comps.scheme = AppWebSchemeHandler.scheme
        comps.host = "viewer"
        comps.path = "/index.html"
        comps.queryItems = [URLQueryItem(name: "convierte", value: "gpx")]
        web.load(URLRequest(url: comps.url!))
        // Hasta diez segundos a que la página diga que está lista.
        for _ in 0..<50 {
            try await Task.sleep(nanoseconds: 200_000_000)
            if (try? await web.evaluateJavaScript("window.slsnsConversorListo === true")) as? Bool == true {
                self.web = web
                return web
            }
        }
        web.removeFromSuperview()
        throw Fallo.noArranca
    }
}
