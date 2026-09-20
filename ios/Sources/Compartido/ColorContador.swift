import SwiftUI

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
