import Foundation

/**
 Los CONTADORES: lo que enseña el widget de la pantalla de inicio.

 Hay de dos clases y se guardan juntos porque el widget los pinta igual:

 - Los de **carrera**: los pone la app con lo que dice el servidor (nombre y
   salida oficial). No se editan —si el organizador mueve la salida, el
   contador se mueve con ella—, solo su aspecto: color, emoji y si sale el
   cartel.
 - Los **propios**: los crea uno a mano ("las vacaciones", "la Up'26 del año que
   viene") con su fecha, su color y su icono. Viven solo en este móvil.

 Vive en el contenedor COMPARTIDO (App Group) porque el widget es otro proceso:
 no puede leer los datos de la app ni llamar a la API con garantías. La app
 escribe aquí cada vez que refresca sus carreras y el widget solo lee.
 */

/// El identificador del grupo compartido entre la app y el widget.
public let grupoCompartido = "group.com.themakercrowd.silosenosalgo"

/// Qué hacer cuando la fecha ya ha pasado.
public enum AlPasar: String, Codable, CaseIterable, Sendable {
    /// Se deja de enseñar (el widget pasa al siguiente contador).
    case ocultar
    /// Sigue contando, ahora hacia arriba: el tiempo que lleva corriendo.
    case contarArriba
}

/// Cómo se enseña el número.
public enum EstiloContador: String, Codable, CaseIterable, Sendable {
    /// "12 días 8 h": lo que se lee de un vistazo desde la otra punta de la mesa.
    case compacto
    /// "12 : 02:37:25", con los segundos corriendo (ver `VistaContador`).
    case completo
}

public struct Contador: Codable, Identifiable, Hashable, Sendable {
    public enum Origen: String, Codable, Sendable { case carrera, propio }

    public var id: String
    public var origen: Origen
    public var nombre: String
    /// Cuándo. Para los de carrera, la salida oficial.
    public var fecha: Date
    /// Si la hora importa. Sin ella se cuentan días enteros: "un viaje en
    /// abril" no tiene hora, una carrera sí.
    public var conHora: Bool
    /// Color en hexadecimal (`#7c3aed`), el de su marca en el evento si lo hay.
    public var color: String
    public var emoji: String?
    /// El fichero de la foto dentro del contenedor compartido, si tiene.
    public var foto: String?
    /// Se repite cada año (el cumpleaños, la carrera de siempre).
    public var anual: Bool
    public var alPasar: AlPasar
    /// El evento del que salió, para los de carrera.
    public var eventoId: String?
    public var estilo: EstiloContador
    /// Si alguien ha tocado su aspecto: entonces la sincronización con el
    /// servidor respeta el color y el emoji elegidos.
    public var aspectoPropio: Bool

    public init(
        id: String = UUID().uuidString,
        origen: Origen = .propio,
        nombre: String,
        fecha: Date,
        conHora: Bool = true,
        color: String = "#7c3aed",
        emoji: String? = nil,
        foto: String? = nil,
        anual: Bool = false,
        alPasar: AlPasar = .ocultar,
        estilo: EstiloContador = .completo,
        eventoId: String? = nil,
        aspectoPropio: Bool = false
    ) {
        self.id = id
        self.origen = origen
        self.nombre = nombre
        self.fecha = fecha
        self.conHora = conHora
        self.color = color
        self.emoji = emoji
        self.foto = foto
        self.anual = anual
        self.alPasar = alPasar
        self.estilo = estilo
        self.eventoId = eventoId
        self.aspectoPropio = aspectoPropio
    }

    /// Los días enteros que faltan, y el momento en que ese número baja: la
    /// misma hora de la carrera, un día antes. Es lo que permite enseñar los
    /// segundos corriendo sin pintar el widget cada segundo —el reloj del
    /// sistema cuenta hasta ahí solo— y cambiar el número de días cuando toca.
    public func diasYCorte(desde ahora: Date = Date()) -> (dias: Int, corte: Date) {
        let fecha = fechaVigente(desde: ahora)
        let faltan = fecha.timeIntervalSince(ahora)
        guard faltan > 0 else { return (0, fecha) }
        let dias = Int(faltan / 86_400)
        return (dias, fecha.addingTimeInterval(-Double(dias) * 86_400))
    }

    /// Si al reloj del sistema hay que ponerle un cero delante: enseña "7:48:38"
    /// y el formato de la referencia es "07:48:38".
    ///
    /// Dentro de una misma tanda las horas solo BAJAN, así que mirarlas una vez
    /// vale para toda la tanda: si ahora quedan menos de diez horas hasta el
    /// corte, va a seguir siendo así hasta que el número de días baje. Y si
    /// quedan más, se pide tanda nueva justo al cruzar las diez.
    func ceroDelante(desde ahora: Date = Date()) -> Bool {
        diasYCorte(desde: ahora).corte.timeIntervalSince(ahora) < 10 * 3600
    }

    /// La fecha que cuenta AHORA: la suya, o la del año que viene si es anual y
    /// la de este año ya pasó.
    public func fechaVigente(desde ahora: Date = Date()) -> Date {
        guard anual, fecha < ahora else { return fecha }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        var proxima = fecha
        while proxima < ahora, let mas = cal.date(byAdding: .year, value: 1, to: proxima) {
            proxima = mas
        }
        return proxima
    }

    /// Si todavía tiene algo que enseñar: no ha pasado, o cuenta hacia arriba.
    public func vigente(_ ahora: Date = Date()) -> Bool {
        alPasar == .contarArriba || fechaVigente(desde: ahora) > ahora
    }
}

public extension Contador {
    /// Los guardados antes de que existiera el estilo entran como `completo`.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            origen: try c.decode(Origen.self, forKey: .origen),
            nombre: try c.decode(String.self, forKey: .nombre),
            fecha: try c.decode(Date.self, forKey: .fecha),
            conHora: try c.decode(Bool.self, forKey: .conHora),
            color: try c.decode(String.self, forKey: .color),
            emoji: try c.decodeIfPresent(String.self, forKey: .emoji),
            foto: try c.decodeIfPresent(String.self, forKey: .foto),
            anual: try c.decode(Bool.self, forKey: .anual),
            alPasar: try c.decode(AlPasar.self, forKey: .alPasar),
            estilo: try c.decodeIfPresent(EstiloContador.self, forKey: .estilo) ?? .completo,
            eventoId: try c.decodeIfPresent(String.self, forKey: .eventoId),
            aspectoPropio: try c.decode(Bool.self, forKey: .aspectoPropio)
        )
    }
}

/// Lo que la app le deja puesto al widget.
public struct ContadoresGuardados: Codable, Sendable {
    public var contadores: [Contador]
    /// Cuándo se escribió, para poder decir "esto es de hace dos días" si la
    /// app lleva sin abrirse.
    public var at: Date

    public init(contadores: [Contador], at: Date = Date()) {
        self.contadores = contadores
        self.at = at
    }
}

/// Leer y escribir los contadores en el contenedor compartido.
///
/// En la copia de DESARROLLO no hay grupo compartido —se firma con el perfil
/// comodín, que no lo admite— así que se cae a la carpeta de la propia app: la
/// app funciona igual y el widget, que ahí no existe, no se entera.
public enum AlmacenContadores {
    private static var carpeta: URL {
        let fm = FileManager.default
        let base = fm.containerURL(forSecurityApplicationGroupIdentifier: grupoCompartido)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private static var fichero: URL { carpeta.appendingPathComponent("contadores.json") }

    /// La carpeta de las fotos de los contadores, dentro del contenedor compartido.
    public static var fotos: URL {
        let dir = carpeta.appendingPathComponent("fotos-contadores", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public static func lee() -> ContadoresGuardados {
        guard let datos = try? Data(contentsOf: fichero) else { return ContadoresGuardados(contadores: []) }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return (try? dec.decode(ContadoresGuardados.self, from: datos)) ?? ContadoresGuardados(contadores: [])
    }

    public static func guarda(_ contadores: [Contador]) {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        guard let datos = try? enc.encode(ContadoresGuardados(contadores: contadores)) else { return }
        try? datos.write(to: fichero, options: .atomic)
    }

    /// Los que el widget puede enseñar, el más cercano primero.
    public static func vigentes(_ ahora: Date = Date()) -> [Contador] {
        lee().contadores
            .filter { $0.vigente(ahora) }
            .sorted { $0.fechaVigente(desde: ahora) < $1.fechaVigente(desde: ahora) }
    }
}
