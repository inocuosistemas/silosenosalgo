import Foundation

/// Usar la app SIN CUENTA: se graba la salida en el móvil y se ve en su mapa, sin
/// pasar por nuestro servidor. Lo que necesita servidor —que te sigan en directo
/// por un enlace, las carreras, los ánimos— pide entrar con una cuenta, que es
/// por invitación. Es lo que deja probar la app a quien la baja de la tienda sin
/// invitación, y lo que cuesta cero: no escribe nada en el servidor. Espejo de
/// `ModoLocal` en Android.
enum ModoLocal {
    private static let clave = "modoLocal"
    static var activo: Bool {
        get { UserDefaults.standard.bool(forKey: clave) }
        set { UserDefaults.standard.set(newValue, forKey: clave) }
    }
}

/// Una salida grabada SOLO en este móvil: sin cuenta, o empezada sin cobertura y
/// terminada antes de poder darse de alta. El servidor no la conoce, así que sin
/// este apunte no tendría nombre ni fecha en el Archivo, y la poda —que conserva
/// solo lo que lista el servidor— la tiraría al entrar con una cuenta.
struct SalidaLocal: Codable, Equatable, Identifiable {
    let id: String
    var titulo: String?
    let startedAt: Double
    /// nil mientras se graba.
    var endedAt: Double?
    var actividad: BeaconActivity?

    /// Como las del servidor, para la misma lista del Archivo. No caduca: está
    /// en el móvil y no depende de nadie.
    var comoResumen: TrackSessionSummary {
        TrackSessionSummary(
            id: id, title: titulo, planName: nil, status: endedAt == nil ? "active" : "ended",
            startedAt: startedAt, expiresAt: .greatestFiniteMagnitude, updatedAt: nil,
            endedAt: endedAt, pinned: nil, activity: actividad, eventId: nil, device: nil,
        )
    }
}

/// El índice de las salidas de este móvil. Como el de las guías: lista corta, en
/// preferencias.
enum SalidasLocales {
    private static let clave = "salidasLocales-v1"

    static var todas: [SalidaLocal] {
        guard let d = UserDefaults.standard.data(forKey: clave),
              let l = try? JSONDecoder().decode([SalidaLocal].self, from: d) else { return [] }
        return l
    }

    private static func guarda(_ l: [SalidaLocal]) {
        if let d = try? JSONEncoder().encode(l) { UserDefaults.standard.set(d, forKey: clave) }
    }

    static func contiene(_ id: String) -> Bool { todas.contains { $0.id == id } }
    static func una(_ id: String) -> SalidaLocal? { todas.first { $0.id == id } }

    /// Apunta o actualiza.
    static func apunta(_ s: SalidaLocal) { guarda([s] + todas.filter { $0.id != s.id }) }

    static func olvida(_ id: String) { guarda(todas.filter { $0.id != id }) }

    static func cambia(_ id: String, _ cambio: (inout SalidaLocal) -> Void) {
        guard var s = una(id) else { return }
        cambio(&s)
        apunta(s)
    }

    /// Borrarla es borrarla del todo: no hay copia en ningún otro sitio.
    static func borra(_ id: String) {
        olvida(id)
        LocalStore.remove(id)
    }
}

/// Las rutas de GPX cargadas sin cuenta: se quedan en el móvil en vez de subirse
/// (la conversión ya es local). Su índice, como las del servidor, y su blob fuera
/// de las carpetas que poda `LocalStore.prune`.
enum PlanesLocales {
    private static let clave = "planesLocales-v1"

    private static var carpeta: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("planes-locales", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static var todos: [PlanSummary] {
        guard let d = UserDefaults.standard.data(forKey: clave),
              let l = try? JSONDecoder().decode([PlanSummary].self, from: d) else { return [] }
        return l
    }

    static func guarda(_ plan: PlanSummary, bytes: Data) {
        try? bytes.write(to: carpeta.appendingPathComponent("\(plan.id).gz"), options: .atomic)
        let l = [plan] + todos.filter { $0.id != plan.id }
        if let d = try? JSONEncoder().encode(l) { UserDefaults.standard.set(d, forKey: clave) }
    }

    static func bytes(_ planId: String) -> Data? {
        try? Data(contentsOf: carpeta.appendingPathComponent("\(planId).gz"))
    }
}
