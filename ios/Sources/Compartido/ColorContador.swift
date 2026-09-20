import SwiftUI
import UIKit

/**
 Los colores de un contador, compartidos entre la app y el widget.

 Los doce de los participantes de un evento son los mismos que ya duplica
 `Theme.eventColors` (y que `shared/eventColors.ts` en la web), pero aquí van
 en hexadecimal: un contador guarda su color como texto —sobrevive a que lo
 escriba la app y lo lea otro proceso— y el widget no puede usar el `Theme` de
 la app, que vive en otro objetivo.
 */
public enum ColoresContador {
    /// Slug del evento → hexadecimal.
    public static let porSlug: [String: String] = [
        "sky": "#0ea5e9", "emerald": "#10b981", "amber": "#f59e0b", "rose": "#f43f5e",
        "violet": "#8b5cf6", "lime": "#a3e635", "orange": "#fb923c", "cyan": "#22d3ee",
        "fuchsia": "#e879f9", "teal": "#2dd4bf", "indigo": "#818cf8", "pink": "#f472b6",
    ]

    /// Los que se ofrecen al crear un contador propio, en el orden en que se enseñan.
    public static let paleta: [String] = [
        // El blanco, el primero: es el de la tarjeta de «Mis carreras», y sobre
        // un cartel es lo que mejor se lee.
        "#f8fafc",
        "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e",
        "#22d3ee", "#a3e635", "#fb923c", "#e879f9", "#f472b6",
    ]

    public static let porDefecto = "#8b5cf6"

    public static func hex(deSlug slug: String?) -> String {
        guard let slug, let hex = porSlug[slug] else { return porDefecto }
        return hex
    }
}

public extension Color {
    /// Un color a partir de "#rrggbb". Lo que no se entienda sale violeta, que
    /// es el color de la casa: un contador sin color no puede quedarse en negro.
    init(hexContador hex: String) {
        let limpio = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard limpio.count == 6, let n = UInt32(limpio, radix: 16) else {
            self = Color(red: 0.545, green: 0.361, blue: 0.965)
            return
        }
        self = Color(
            red: Double((n >> 16) & 0xff) / 255,
            green: Double((n >> 8) & 0xff) / 255,
            blue: Double(n & 0xff) / 255
        )
    }
}

/// Una muestra de la paleta: un color, o dos en degradado.
public struct MuestraColor: Codable, Hashable, Sendable {
    public var a: String
    public var b: String?

    public init(a: String, b: String? = nil) {
        self.a = a
        self.b = b
    }
}

public extension ColoresContador {
    private static func rgb(_ hex: String) -> (Double, Double, Double) {
        let limpio = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard limpio.count == 6, let n = UInt32(limpio, radix: 16) else { return (0.545, 0.361, 0.965) }
        return (Double((n >> 16) & 0xff) / 255, Double((n >> 8) & 0xff) / 255, Double(n & 0xff) / 255)
    }

    /// El color del degradado en el punto `t` (0 = el primero, 1 = el segundo).
    ///
    /// Hace falta calcularlo a mano porque el número no es UNA pieza: los días,
    /// los dos puntos y el reloj del sistema son textos distintos, y a cada uno
    /// se le da su trozo del degradado para que juntos se lean como uno solo.
    /// (Con una máscara sería una línea, pero en un widget un reloj metido en
    /// una máscara deja de correr.)
    static func mezcla(_ hexA: String, _ hexB: String, _ t: Double) -> Color {
        let a = rgb(hexA), b = rgb(hexB)
        let k = min(1, max(0, t))
        return Color(red: a.0 + (b.0 - a.0) * k, green: a.1 + (b.1 - a.1) * k, blue: a.2 + (b.2 - a.2) * k)
    }

    /// Un color de SwiftUI (el del selector) a "#rrggbb".
    static func hex(de color: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        let c = { (v: CGFloat) in Int(round(min(1, max(0, v)) * 255)) }
        return String(format: "#%02x%02x%02x", c(r), c(g), c(b))
    }

    // ── Las muestras que uno se hace ─────────────────────────────────────

    private static let claveGuardadas = "contadores.muestras"
    private static let topeGuardadas = 12

    /// Las de la casa y, detrás, las que se han ido guardando.
    static func muestras() -> [MuestraColor] {
        paleta.map { MuestraColor(a: $0) } + guardadas()
    }

    static func guardadas() -> [MuestraColor] {
        guard let datos = UserDefaults.standard.data(forKey: claveGuardadas),
              let lista = try? JSONDecoder().decode([MuestraColor].self, from: datos) else { return [] }
        return lista
    }

    /// Guarda una combinación propia como muestra nueva, si no estaba ya (ni es
    /// una de las de la casa). Las más viejas se van al pasar del tope.
    static func recuerda(_ muestra: MuestraColor) {
        let normal = MuestraColor(a: muestra.a.lowercased(), b: muestra.b?.lowercased())
        guard !muestras().contains(where: { $0.a.lowercased() == normal.a && $0.b?.lowercased() == normal.b }) else { return }
        var lista = guardadas() + [normal]
        if lista.count > topeGuardadas { lista.removeFirst(lista.count - topeGuardadas) }
        if let datos = try? JSONEncoder().encode(lista) { UserDefaults.standard.set(datos, forKey: claveGuardadas) }
    }

    static func olvida(_ muestra: MuestraColor) {
        let lista = guardadas().filter { $0 != muestra }
        if let datos = try? JSONEncoder().encode(lista) { UserDefaults.standard.set(datos, forKey: claveGuardadas) }
    }
}
