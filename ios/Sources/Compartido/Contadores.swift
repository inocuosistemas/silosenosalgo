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

/**
 Cómo quedó encuadrada la foto: cuánto se acercó y cuánto se movió.

 Se guarda APARTE de la foto recortada, que es lo que enseña el widget. Con
 solo el recorte, volver a «Ajustar el encuadre» abría el original otra vez en
 el centro y al 100 %: el trabajo anterior seguía en el fichero, pero la
 pantalla no lo enseñaba y parecía que no se hubiera guardado nada.

 El desplazamiento va en FRACCIÓN del marco y no en puntos de pantalla: el
 marco mide lo que mida el móvil donde se encuadre, y en puntos el encuadre
 saldría descolocado en otro.
 */
public struct EncuadreFoto: Codable, Hashable, Sendable {
    /// 1 = la foto justo llenando el marco; hasta 4.
    public var escala: Double
    public var x: Double
    public var y: Double

    public init(escala: Double = 1, x: Double = 0, y: Double = 0) {
        self.escala = escala
        self.x = x
        self.y = y
    }
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
    /// El segundo color, si el número va en DEGRADADO (de `color` a este, de
    /// izquierda a derecha). Nil = un solo color.
    public var color2: String?
    public var emoji: String?
    /// El fichero de la foto dentro del contenedor compartido, si tiene.
    public var foto: String?
    /// Cuándo se guardó la foto. El fichero se llama siempre igual, así que
    /// sin esto un encuadre nuevo no se notaba: las vistas seguían con la
    /// imagen que ya tenían leída.
    public var fotoVersion: Double = 0
    /// Cómo se dejó encuadrada la foto, para poder retocarla sin empezar de
    /// cero (ver `EncuadreFoto`).
    public var encuadre: EncuadreFoto?
    /// Se repite cada año (el cumpleaños, la carrera de siempre).
    public var anual: Bool
    public var alPasar: AlPasar
    /// Avisar en el móvil cuando llegue (notificación local; ver `AvisosDeContadores`).
    public var aviso: Bool
    /// El evento del que salió, para los de carrera.
    public var eventoId: String?
    public var estilo: EstiloContador
    /// De fondo va el CARTEL de la carrera (solo los de carrera). La app lo
    /// copia al cajón compartido, reducido, y lo renueva si el cartel cambia.
    public var usaCartel: Bool
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
        color2: String? = nil,
        emoji: String? = nil,
        foto: String? = nil,
        fotoVersion: Double = 0,
        encuadre: EncuadreFoto? = nil,
        anual: Bool = false,
        alPasar: AlPasar = .ocultar,
        aviso: Bool = false,
        estilo: EstiloContador = .completo,
        usaCartel: Bool = false,
        eventoId: String? = nil,
        aspectoPropio: Bool = false
    ) {
        self.id = id
        self.origen = origen
        self.nombre = nombre
        self.fecha = fecha
        self.conHora = conHora
        self.color = color
        self.color2 = color2
        self.emoji = emoji
        self.foto = foto
        self.fotoVersion = fotoVersion
        self.encuadre = encuadre
        self.anual = anual
        self.alPasar = alPasar
        self.aviso = aviso
        self.estilo = estilo
        self.usaCartel = usaCartel
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

    /// Lo que hay que escribir DELANTE del reloj del sistema para que lleve
    /// siempre dos cifras de horas: "7:48:38" tiene que leerse "07:48:38"; con
    /// menos de una hora deja de escribir las horas ("48:38") y hay que ponerle
    /// el "00:"; y con menos de diez minutos, además, el cero del minuto.
    ///
    /// Dentro de una misma tanda las horas solo BAJAN, así que mirarlas una vez
    /// vale para toda la tanda; los cambios de prefijo (a las diez horas y a la
    /// una) piden tanda nueva (ver `ContadorWidget`).
    public func prefijoHoras(desde ahora: Date = Date()) -> String {
        let faltan = diasYCorte(desde: ahora).corte.timeIntervalSince(ahora)
        // Por debajo de diez minutos el reloj escribe "9:59", con el minuto de
        // una cifra: también hay que completarlo, o las columnas se descuadran
        // justo al final, que es cuando más se mira.
        if faltan < 600 { return "00:0" }
        if faltan < 3600 { return "00:" }
        if faltan < 10 * 3600 { return "0" }
        return ""
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
            color2: try c.decodeIfPresent(String.self, forKey: .color2),
            emoji: try c.decodeIfPresent(String.self, forKey: .emoji),
            foto: try c.decodeIfPresent(String.self, forKey: .foto),
            fotoVersion: try c.decodeIfPresent(Double.self, forKey: .fotoVersion) ?? 0,
            encuadre: try c.decodeIfPresent(EncuadreFoto.self, forKey: .encuadre),
            anual: try c.decode(Bool.self, forKey: .anual),
            alPasar: try c.decode(AlPasar.self, forKey: .alPasar),
            aviso: try c.decodeIfPresent(Bool.self, forKey: .aviso) ?? false,
            estilo: try c.decodeIfPresent(EstiloContador.self, forKey: .estilo) ?? .completo,
            usaCartel: try c.decodeIfPresent(Bool.self, forKey: .usaCartel) ?? false,
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
