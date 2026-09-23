import Foundation

/**
 Una CARRERA SIMULADA para la vista previa de la tarjeta en la app: se mueve
 un deslizador de tiempo y se ve la tarjeta tal como iría quedando, de antes de
 la salida a la meta, pasando por todas sus vistas.

 El corredor sigue el horario del plan al ritmo que se elija (1 = como el plan,
 1,2 = un 20 % más lento), así que se ve también cómo cambia el margen al
 corte. Los demás corredores son inventados: siete, cada uno a su ritmo.

 Sin estado y sin reloj de verdad: todo sale del minuto virtual, para poder
 probarlo y para que el deslizador mande.
 */
struct SimulacionDeCarrera {
    let hoja: HojaDeTramos
    let carrera: String
    /// Cuánto se tarda respecto al plan: 1 = como el plan.
    var ritmo: Double = 1
    /// Minutos desde la salida; negativo, antes.
    var minuto: Double = -20
    /// La vista elegida con el selector; nil, la automática.
    var vistaElegida: VistaDeCarrera?

    var salida: Date { Date(timeIntervalSince1970: hoja.salida / 1000) }
    var ahora: Date { salida.addingTimeInterval(minuto * 60) }

    /// Cuánto dura la carrera a este ritmo, en minutos.
    var duracion: Double { (hoja.previsto.last?.min ?? 0) * ritmo }

    /// Lo que recorre el deslizador: media hora antes de salir y un rato
    /// después de llegar, para ver la cuenta atrás y la meta.
    var rango: ClosedRange<Double> { -30...max(1, duracion + 20) }

    /// El km al que se llega en un minuto DEL PLAN (a su ritmo): el horario del
    /// plan, al revés.
    static func km(enMinutoDelPlan m: Double, _ hoja: HojaDeTramos) -> Double {
        let p = hoja.previsto
        guard let ultimo = p.last else { return 0 }
        if m <= 0 { return 0 }
        if m >= ultimo.min { return ultimo.km }
        guard let i = p.firstIndex(where: { $0.min >= m }), i > 0 else { return 0 }
        let a = p[i - 1], b = p[i]
        let t = (m - a.min) / max(1e-9, b.min - a.min)
        return a.km + (b.km - a.km) * t
    }

    /// Dónde va quien corre a un ritmo dado en un minuto de la carrera.
    func km(enMinuto m: Double, ritmo r: Double) -> Double {
        Self.km(enMinutoDelPlan: m / r, hoja)
    }

    var km: Double { km(enMinuto: minuto, ritmo: ritmo) }

    /// Lo que se ha ido corriendo en la última hora, como lo guardaría la app:
    /// con esto la previsión mide el ritmo, igual que en carrera.
    var historia: [(Date, Double)] {
        guard minuto > 0 else { return [] }
        let hace = max(0, minuto - 60)
        return [(salida.addingTimeInterval(hace * 60), km(enMinuto: hace, ritmo: ritmo)), (ahora, km)]
    }

    /// Los demás, inventados: cada uno con su emoji, su nombre y su ritmo.
    static let otros: [(emoji: String, nombre: String, ritmo: Double)] = [
        ("🦅", "Aitor", 0.72), ("🐐", "Nerea", 0.9), ("🐺", "Pau", 0.95), ("🦊", "Marta", 0.98),
        ("🐢", "Jon", 1.03), ("🦔", "Laia", 1.08), ("🐻", "Iker", 1.2),
    ]

    /// Quién va cerca, con las mismas reglas que el servidor (ver
    /// `functions/lib/corredoresCerca.ts`): el primero y los de alrededor.
    var corredores: DatosCorredores {
        let mio = km
        let todos = Self.otros.map { (emoji: $0.emoji, nombre: $0.nombre, km: km(enMinuto: minuto, ritmo: $0.ritmo)) }
            .sorted { $0.km > $1.km }
        let posicion = todos.filter { $0.km > mio }.count + 1
        var salida: [CorredorEnPerfil] = []
        let lider = todos.first
        let primeroSoyYo = lider.map { mio >= $0.km } ?? true
        if let lider, !primeroSoyYo {
            salida.append(.init(km: lider.km, emoji: lider.emoji, nombre: lider.nombre, lider: true))
        }
        let cerca = todos.dropFirst(primeroSoyYo ? 0 : 1)
            .filter { abs($0.km - mio) <= 4 }
            .sorted { abs($0.km - mio) < abs($1.km - mio) }
            .prefix(6)
        salida += cerca.map { .init(km: $0.km, emoji: $0.emoji, nombre: $0.nombre) }
        return DatosCorredores(posicion: posicion, de: todos.count + 1, actualizado: ahora, corredores: salida)
    }

    /// La tarjeta en este momento de la simulación.
    var estado: EstadoDeCarrera? {
        guard var e = ReglasDeCarrera.estado(carrera: carrera, km: km, ahora: ahora, historia: historia,
                                             anterior: nil, corredores: corredores, hoja)
        else { return nil }
        if let v = vistaElegida {
            e.vista = v
            e.vistaElegida = true
        }
        return e
    }
}

extension HojaDeTramos {
    /**
     Una carrera de ejemplo: 42 km de montaña con dos subidas, siete puntos y
     tres cortes. Para la simulación cuando no hay carrera propia, y para las
     pruebas.

     El horario es el de un plan de montaña de verdad: 9 min por km en llano y
     10 más por cada 100 m de subida. Los cortes van con un 25 % de holgura
     sobre el plan: a su ritmo se llega con margen, y muy lento, fuera.
     */
    static func ejemplo(salida: Date) -> HojaDeTramos {
        func ele(_ km: Double) -> Double {
            let base: Double
            switch km {
            case ..<13: base = 1200 + 1100 * sin(km / 13 * .pi / 2)
            case ..<21: base = 2300 - 800 * (km - 13) / 8
            case ..<30: base = 1500 + 600 * sin((km - 21) / 9 * .pi / 2)
            default: base = 2100 - 900 * (km - 30) / 12
            }
            return base + 18 * sin(km * 2.3)
        }
        let total = 42.0
        let perfil = stride(from: 0.0, through: total, by: 0.05).map { Muestra(km: $0, ele: ele($0)) }
        var previsto: [Previsto] = [.init(km: 0, min: 0)]
        var min = 0.0
        for km in stride(from: 0.25, through: total, by: 0.25) {
            let sube = max(0, ele(km) - ele(km - 0.25))
            min += 0.25 * 9 + sube / 100 * 10
            previsto.append(.init(km: km, min: min))
        }
        func corte(_ km: Double) -> Double {
            let plan = previsto.first { $0.km >= km }?.min ?? min
            return salida.addingTimeInterval(plan * 1.25 * 60).timeIntervalSince1970 * 1000
        }
        return HojaDeTramos(
            version: 1, salida: salida.timeIntervalSince1970 * 1000, totalKm: total,
            perfil: perfil, previsto: previsto,
            puntos: [
                .init(nombre: "Font del Gel", km: 5, tipo: "liquido", corte: nil),
                .init(nombre: "Coll de Pal", km: 9.5, tipo: "control", corte: corte(9.5)),
                .init(nombre: "Refugi del Rebost", km: 15, tipo: "solido", corte: nil),
                .init(nombre: "La Pleta", km: 21, tipo: "liquido", corte: corte(21)),
                .init(nombre: "Collada Verda", km: 28, tipo: "completo", corte: corte(28)),
                .init(nombre: "Font Baixa", km: 35, tipo: "liquido", corte: nil),
                .init(nombre: "Meta", km: total, tipo: "meta", corte: nil),
            ])
    }
}
