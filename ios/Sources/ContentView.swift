import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        ZStack {
            Theme.slate950.ignoresSafeArea()
            switch auth.status {
            case .loading:
                ProgressView("Cargando…")
                    .tint(Theme.sky500)
                    .foregroundStyle(Theme.slate400)
            case .anonymous:
                LoginView()
            case .authed:
                if auth.token != nil {
                    TrackingView()
                } else {
                    LoginView()
                }
            }
        }
    }
}

/// Palette mirroring the web app (Tailwind slate + sky).
enum Theme {
    static let slate950 = Color(red: 0.008, green: 0.024, blue: 0.090) // #020617
    static let slate900 = Color(red: 0.059, green: 0.090, blue: 0.165) // #0f172a
    static let slate800 = Color(red: 0.118, green: 0.161, blue: 0.231) // #1e293b
    static let slate700 = Color(red: 0.200, green: 0.255, blue: 0.333) // #334155
    static let slate400 = Color(red: 0.580, green: 0.639, blue: 0.722) // #94a3b8
    static let slate100 = Color(red: 0.945, green: 0.961, blue: 0.976) // #f1f5f9
    static let sky600   = Color(red: 0.008, green: 0.518, blue: 0.780) // #0284c7
    static let sky500   = Color(red: 0.055, green: 0.647, blue: 0.914) // #0ea5e9

    /// Los doce colores de los participantes de un evento (shared/eventColors.ts).
    ///
    /// Duplicados aquí a propósito, como los umbrales de TrackingRules: son doce
    /// constantes que no cambian, y pedirle al servidor un color para pintar un
    /// punto en una pantalla que tiene que funcionar sin cobertura sería peor.
    /// Un slug que no se reconozca cae en gris, no en un fallo.
    private static let eventColors: [String: Color] = [
        "sky": Color(red: 0.055, green: 0.647, blue: 0.914),
        "emerald": Color(red: 0.063, green: 0.725, blue: 0.506),
        "amber": Color(red: 0.961, green: 0.620, blue: 0.043),
        "rose": Color(red: 0.957, green: 0.247, blue: 0.369),
        "violet": Color(red: 0.545, green: 0.361, blue: 0.965),
        "lime": Color(red: 0.639, green: 0.902, blue: 0.208),
        "orange": Color(red: 0.984, green: 0.573, blue: 0.235),
        "cyan": Color(red: 0.133, green: 0.827, blue: 0.933),
        "fuchsia": Color(red: 0.910, green: 0.475, blue: 0.976),
        "teal": Color(red: 0.176, green: 0.831, blue: 0.749),
        "indigo": Color(red: 0.506, green: 0.549, blue: 0.973),
        "pink": Color(red: 0.957, green: 0.447, blue: 0.714),
    ]

    static func eventColor(_ slug: String?) -> Color {
        guard let slug, let c = eventColors[slug] else { return slate400 }
        return c
    }
}

/// La marca de un participante: su emoji dentro de un aro de su color.
///
/// Mismo dibujo que en la web y por la misma razón: el emoji tiene sus propios
/// colores y sobre un disco relleno se ensucian los dos. El aro identifica de
/// lejos y el emoji de cerca.
struct MarcaEvento: View {
    let emoji: String
    let colorSlug: String?
    var size: CGFloat = 28

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 0.55))
            .frame(width: size, height: size)
            .background(Theme.slate900)
            .clipShape(Circle())
            .overlay(Circle().stroke(Theme.eventColor(colorSlug), lineWidth: 2))
    }
}

extension View {
    /// Dark, rounded text-field surface to match the web inputs.
    func appField() -> some View {
        self
            .padding(12)
            .background(Theme.slate900)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.slate700, lineWidth: 1))
            .cornerRadius(10)
            .foregroundStyle(Theme.slate100)
            .tint(Theme.sky500)
    }
}
