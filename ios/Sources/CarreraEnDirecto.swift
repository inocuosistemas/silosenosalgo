import ActivityKit
import Foundation
import UIKit

/**
 La hoja de tramos de una carrera, tal como la calcula la web al empezar la
 baliza (ver `src/lib/hojaDeTramos.ts`): los puntos que cierran tramo con su
 corte, el perfil de la ruta y el horario previsto por el plan.
 */
struct HojaDeTramos: Codable, Equatable {
    struct Punto: Codable, Equatable {
        let nombre: String
        let km: Double
        let tipo: String
        /// Hora de corte en milisegundos, ya con su día.
        let corte: Double?
    }
    struct Muestra: Codable, Equatable {
        let km: Double
        let ele: Double
    }
    struct Previsto: Codable, Equatable {
        let km: Double
        let min: Double
    }
    let version: Int
    /// La salida oficial, en milisegundos.
    let salida: Double
    let totalKm: Double
    let perfil: [Muestra]
    let previsto: [Previsto]
    let puntos: [Punto]
}

/**
 Las REGLAS de la carrera en directo, sin estado para poder probarlas: de un km
 y una hora a lo que enseña la tarjeta del tramo.
 */
enum ReglasDeCarrera {
    /// Cuántas muestras del perfil del tramo viajan a la tarjeta: bastan para
    /// dibujarlo y caben de sobra en los 4 KB que admite el sistema.
    static let muestrasDelTramo = 40
    /// Un repecho de menos de esto no cuenta como subida: el GPS y el modelo
    /// de terreno tienen más ruido que eso.
    static let umbralDeDesnivel = 3.0

    /// El tramo en el que se va: desde el último punto pasado hasta el siguiente.
    static func tramo(en km: Double, de hoja: HojaDeTramos)
        -> (numero: Int, desde: PuntoDeCarrera, hasta: PuntoDeCarrera)? {
        guard !hoja.puntos.isEmpty else { return nil }
        let i = hoja.puntos.firstIndex(where: { $0.km > km + 0.05 }) ?? (hoja.puntos.count - 1)
        let hasta = punto(hoja.puntos[i])
        let desde = i == 0
            ? PuntoDeCarrera(nombre: "Salida", km: 0, tipo: nil)
            : punto(hoja.puntos[i - 1])
        return (i + 1, desde, hasta)
    }

    static func punto(_ p: HojaDeTramos.Punto) -> PuntoDeCarrera {
        PuntoDeCarrera(nombre: p.nombre, km: p.km, tipo: TipoDePunto(rawValue: p.tipo))
    }

    /// La altitud en un km, interpolada en el perfil.
    static func ele(en km: Double, _ perfil: [HojaDeTramos.Muestra]) -> Double {
        guard let i = perfil.firstIndex(where: { $0.km >= km }) else { return perfil.last?.ele ?? 0 }
        guard i > 0 else { return perfil[0].ele }
        let a = perfil[i - 1], b = perfil[i]
        let t = (km - a.km) / max(1e-9, b.km - a.km)
        return a.ele + (b.ele - a.ele) * t
    }

    /// Y del perfil de la carrera entera: más largo, pero sigue siendo un dibujo.
    static let muestrasGlobales = 60

    /// El perfil entre dos km, en `n` puntos parejos (así viaja compacto: ver
    /// `PerfilCompacto`).
    static func perfil(de desde: Double, a hasta: Double, _ hoja: HojaDeTramos,
                       muestras n: Int = muestrasDelTramo) -> [DatosDeTramo.Muestra] {
        guard hasta > desde, n > 1 else { return [] }
        return (0..<n).map { j in
            let km = desde + (hasta - desde) * Double(j) / Double(n - 1)
            return .init(km: (km * 1000).rounded() / 1000, ele: ele(en: km, hoja.perfil).rounded())
        }
    }

    /// Lo que queda por subir y por bajar entre dos km, sin contar el ruido.
    static func desnivel(de desde: Double, a hasta: Double, _ hoja: HojaDeTramos) -> (sube: Int, baja: Int) {
        guard hasta > desde else { return (0, 0) }
        var alturas = [ele(en: desde, hoja.perfil)]
        alturas += hoja.perfil.filter { $0.km > desde && $0.km < hasta }.map(\.ele)
        alturas.append(ele(en: hasta, hoja.perfil))
        var sube = 0.0, baja = 0.0
        var ancla = alturas[0]
        for e in alturas.dropFirst() {
            let d = e - ancla
            if d >= umbralDeDesnivel { sube += d; ancla = e }
            else if d <= -umbralDeDesnivel { baja -= d; ancla = e }
        }
        return (Int(sube.rounded()), Int(baja.rounded()))
    }

    /// Minutos desde la salida que el plan prevé para un km.
    static func previsto(en km: Double, _ hoja: HojaDeTramos) -> Double? {
        let p = hoja.previsto
        guard let i = p.firstIndex(where: { $0.km >= km }) else { return p.last?.min }
        guard i > 0 else { return p.first?.min }
        let a = p[i - 1], b = p[i]
        let t = (km - a.km) / max(1e-9, b.km - a.km)
        return a.min + (b.min - a.min) * t
    }

    /**
     A qué hora se llegará a `hasta` yendo como se va.

     El plan dice cuánto se tarda en cada trozo contando con el terreno; lo que
     no sabe es cómo está rindiendo quien corre. Así que se mide: cuánto ha
     tardado DE VERDAD en la última hora frente a lo que el plan preveía para
     ese mismo trozo, y en esa proporción se estira (o se encoge) lo que el
     plan prevé para lo que queda de tramo. Quien va un 20 % más lento que el
     plan en la subida lo irá también en la siguiente, que es lo que la cuenta
     de "el retraso de ahora se arrastra tal cual" no veía.

     Es la cuenta del visor web (`marginToNextCutoffConPerfil`: se conserva lo
     que se rinde respecto al plan, no un ritmo plano), con el rendimiento de
     la última hora en vez del de toda la carrera, que al final de una larga
     arrastra demasiado lo que pasó al principio.

     `historia` son las posiciones de antes: (hora, km). Sin historia bastante
     —los primeros minutos, o parado en la salida— se usa el plan tal cual.
     */
    static func prevision(de posicion: Double, a hasta: Double, ahora: Date,
                          historia: [(Date, Double)], _ hoja: HojaDeTramos) -> Date? {
        guard let aqui = previsto(en: posicion, hoja), let alli = previsto(en: hasta, hoja) else { return nil }
        let plan = max(0, alli - aqui)
        return ahora.addingTimeInterval(plan * rendimiento(ahora: ahora, posicion: posicion,
                                                          historia: historia, hoja) * 60)
    }

    /// Cuánto se tarda respecto al plan: 1 = como el plan, 1,2 = un 20 % más.
    static func rendimiento(ahora: Date, posicion: Double, historia: [(Date, Double)],
                            _ hoja: HojaDeTramos) -> Double {
        // Desde hace una hora o, si no hay tanta, desde lo más antiguo.
        let desde = ahora.addingTimeInterval(-3600)
        guard let inicio = historia.first(where: { $0.0 >= desde }) ?? historia.first,
              let pInicio = previsto(en: inicio.1, hoja), let pAhora = previsto(en: posicion, hoja)
        else { return 1 }
        let real = ahora.timeIntervalSince(inicio.0) / 60
        let esperado = pAhora - pInicio
        // Con poco recorrido la proporción es ruido: una parada de dos minutos
        // en un kilómetro daría el doble. Mínimos: 10 min y 0,5 km.
        guard real >= 10, posicion - inicio.1 >= 0.5, esperado > 0.5 else { return 1 }
        return min(3, max(0.5, real / esperado))
    }

    /// Todo lo que enseña la tarjeta, para un km y una hora.
    static func datos(carrera: String, km: Double, ahora: Date, historia: [(Date, Double)],
                      _ hoja: HojaDeTramos) -> DatosDeTramo? {
        guard let t = tramo(en: km, de: hoja) else { return nil }
        let salida = Date(timeIntervalSince1970: hoja.salida / 1000)
        let enMeta = km >= hoja.totalKm * 0.99
        let d = desnivel(de: km, a: t.hasta.km, hoja)
        let corte = hoja.puntos[t.numero - 1].corte.map { Date(timeIntervalSince1970: $0 / 1000) }
        return DatosDeTramo(
            carrera: carrera, numero: t.numero, deTramos: hoja.puntos.count,
            desde: t.desde, hasta: t.hasta, posicionKm: km,
            perfil: perfil(de: t.desde.km, a: t.hasta.km, hoja),
            subidaRestanteM: d.sube, bajadaRestanteM: d.baja,
            salida: salida,
            // En meta, la "previsión" es la hora de llegada: ahí se para el reloj.
            prevision: enMeta ? ahora : prevision(de: km, a: t.hasta.km, ahora: ahora, historia: historia, hoja),
            corte: enMeta ? nil : corte,
            enMeta: enMeta,
            actualizado: ahora)
    }

    /// La vista de la carrera entera, para un km y una hora.
    static func global(km: Double, ahora: Date, historia: [(Date, Double)],
                       _ hoja: HojaDeTramos) -> DatosGlobales {
        let total = hoja.totalKm
        let d = desnivel(de: km, a: total, hoja)
        let enMeta = km >= total * 0.99
        let corte = hoja.puntos.first { $0.km > km + 0.05 && $0.corte != nil }
        return DatosGlobales(
            totalKm: total, posicionKm: km,
            perfil: perfil(de: 0, a: total, hoja, muestras: muestrasGlobales),
            marcas: hoja.puntos.filter { $0.tipo != "meta" }.map {
                .init(km: $0.km, tipo: TipoDePunto(rawValue: $0.tipo), conCorte: $0.corte != nil)
            },
            subidaAMetaM: d.sube, bajadaAMetaM: d.baja,
            llegadaAMeta: enMeta ? nil : prevision(de: km, a: total, ahora: ahora, historia: historia, hoja),
            proximoCorte: corte?.nombre,
            corte: corte?.corte.map { Date(timeIntervalSince1970: $0 / 1000) },
            previsionAlCorte: corte.flatMap { prevision(de: km, a: $0.km, ahora: ahora, historia: historia, hoja) })
    }

    /**
     Qué vista toca. Antes de la salida, la de la carrera (el tramo todavía no
     dice nada: se está en el km 0); a partir de la hora de salida, la del
     tramo. Pero si quien corre ha elegido una con el selector, esa manda: el
     cambio automático es solo para quien no ha tocado nada.
     */
    static func vista(anterior: EstadoDeCarrera?, salida: Date, ahora: Date) -> (VistaDeCarrera, elegida: Bool) {
        if let a = anterior, a.vistaElegida { return (a.vista, true) }
        return (ahora < salida ? .carrera : .tramo, false)
    }

    /// Todo lo que lleva la tarjeta: las dos vistas y cuál se enseña.
    /// Cuánto se enseña alrededor en la vista de corredores, a cada lado.
    static let radioDeCorredores = 4.0

    static func estado(carrera: String, km: Double, ahora: Date, historia: [(Date, Double)],
                       anterior: EstadoDeCarrera?, corredores: DatosCorredores? = nil,
                       _ hoja: HojaDeTramos) -> EstadoDeCarrera? {
        guard let tramo = datos(carrera: carrera, km: km, ahora: ahora, historia: historia, hoja) else { return nil }
        let v = vista(anterior: anterior, salida: tramo.salida, ahora: ahora)
        // La zona de alrededor, solo si hay corredores que pintar en ella; y
        // de 8 km aunque se esté cerca de la salida o de la meta.
        var cerca: [DatosDeTramo.Muestra] = []
        if corredores != nil {
            let ancho = min(hoja.totalKm, 2 * radioDeCorredores)
            let desde = min(max(0, km - radioDeCorredores), hoja.totalKm - ancho)
            cerca = perfil(de: desde, a: desde + ancho, hoja)
        }
        return EstadoDeCarrera(tramo: tramo, global: global(km: km, ahora: ahora, historia: historia, hoja),
                               vista: v.0, vistaElegida: v.elegida, corredores: corredores, perfilCerca: cerca)
    }

    /// Si hay que mandar la tarjeta otra vez: al cambiar de tramo, al moverse
    /// lo bastante para que se note en el perfil, o cada minuto como mucho,
    /// para que el margen al corte no se quede viejo.
    static func mereceMandar(_ nuevo: EstadoDeCarrera, despuesDe viejoEstado: EstadoDeCarrera?, ahora: Date,
                             ultimoEnvio: Date?) -> Bool {
        guard let viejoEstado, let ultimoEnvio else { return true }
        if nuevo.vista != viejoEstado.vista { return true }
        return mereceMandar(nuevo.tramo, despuesDe: viejoEstado.tramo, ahora: ahora, ultimoEnvio: ultimoEnvio)
    }

    static func mereceMandar(_ nuevo: DatosDeTramo, despuesDe viejo: DatosDeTramo?, ahora: Date,
                             ultimoEnvio: Date?) -> Bool {
        guard let viejo, let ultimoEnvio else { return true }
        if nuevo.numero != viejo.numero || nuevo.enMeta != viejo.enMeta { return true }
        let largo = max(0.1, viejo.hasta.km - viejo.desde.km)
        if abs(nuevo.posicionKm - viejo.posicionKm) >= max(0.05, largo / 60) { return true }
        return ahora.timeIntervalSince(ultimoEnvio) >= 60
    }
}

/**
 La CARRERA EN DIRECTO: la tarjeta del tramo en la pantalla de bloqueo, que
 arranca sola al empezar la baliza de una carrera y se va al llegar a meta.

 La hoja de tramos se calcula con la web una vez, al empezar (la app está
 delante), y se guarda: si iOS cierra la app y la vuelve a abrir en segundo
 plano, se sigue con la guardada. Lo de cada posición es cuenta de aquí.
 */
@MainActor
final class CarreraEnDirecto: ObservableObject {
    static let shared = CarreraEnDirecto()

    /**
     De dónde sale la tarjeta. De la BALIZA de una carrera (arranca y se va con
     ella, con los tramos y cortes de la organización y los corredores), o de
     una RUTA propia, sin carrera, que se empieza y se termina a mano y sigue
     el GPS por su cuenta (ver `CarreraConTrazado`).

     No se mezclan: la baliza no toca una tarjeta de ruta (sus km serían de
     otro recorrido), ni la termina al pararse.
     */
    enum Origen { case baliza, trazado }
    @Published private(set) var origen: Origen = .baliza

    @Published private var actividad: Activity<CarreraAtributos>?
    /// Lo último que se mandó a la tarjeta, para enseñarlo en la app.
    var estadoActual: EstadoDeCarrera? { actividad?.content.state ?? ultimo }
    var enMarcha: Bool { actividad != nil }
    var nombre: String { carrera }
    /// Al acabarse la tarjeta de una ruta —en meta, o quitada desde la
    /// pantalla de bloqueo—, para apagar su GPS.
    var alAcabar: (() -> Void)?
    private var vigilancia: Task<Void, Never>?
    private var hoja: HojaDeTramos?
    private var carrera = ""
    private var ultimo: EstadoDeCarrera?
    private var ultimoEnvio: Date?
    /// Las posiciones de la última hora y pico, para medir cómo se rinde.
    private var historia: [(Date, Double)] = []
    /// Para pedir quién va cerca (ver `pideCorredores`).
    private var token: String?
    private var eventoId: String?
    private var corredores: DatosCorredores?
    private var vigilanteDeCorredores: Task<Void, Never>?
    /// Cada cuánto se pregunta quién va cerca. Poco: lo que cambia en ese rato
    /// es poco, y lo piden todos los que corren a la vez.
    static let cadaCuantoCorredores: TimeInterval = 3 * 60

    /**
     Preparar la carrera de una baliza que empieza (o que se retoma).

     Sin carrera detrás —una baliza suelta—, o sin recorrido, no hay tramos y
     no se hace nada. Si ya había una tarjeta de esta carrera (la app se cerró
     y se ha vuelto a abrir), se engancha a ella en vez de poner otra.
     */
    ///
    /// Al retomar una baliza tras un cierre de la app, la lista de eventos
    /// puede no haber llegado todavía y no se sabe de qué carrera es: basta con
    /// la tarjeta viva y la hoja guardada. El nombre lo lleva la propia tarjeta.
    func prepara(sesion: String, token: String, eventoId: String?, nombre: String?, salidaMs: Double?) {
        // Con una tarjeta de ruta en marcha, la baliza no pone otra.
        guard origen == .baliza, !CarreraConTrazado.hayUnaGuardada else { return }
        self.token = token
        if let eventoId { self.eventoId = eventoId }
        Task {
            if hoja == nil {
                hoja = await Self.hoja(sesion: sesion, token: token, eventoId: eventoId, salidaMs: salidaMs)
            }
            guard let hoja else { return }
            if let viva = Activity<CarreraAtributos>.activities.first(where: { $0.activityState == .active || $0.activityState == .stale }) {
                actividad = viva
                carrera = viva.attributes.carrera
                ultimo = viva.content.state
                corredores = viva.content.state.corredores
                vigilaCorredores()
                return
            }
            // Arrancar solo se puede con la app delante, y sabiendo la carrera.
            guard let nombre, eventoId != nil,
                  UIApplication.shared.applicationState != .background,
                  ActivityAuthorizationInfo().areActivitiesEnabled,
                  let inicial = ReglasDeCarrera.estado(carrera: nombre, km: 0, ahora: Date(),
                                                        historia: [], anterior: nil, hoja)
            else { return }
            carrera = nombre
            actividad = try? Activity.request(
                attributes: CarreraAtributos(carrera: nombre),
                content: ActivityContent(state: inicial, staleDate: Date().addingTimeInterval(20 * 60)),
                pushType: nil)
            ultimo = inicial
            ultimoEnvio = Date()
            vigilaCorredores()
        }
    }

    /**
     Preguntar cada poco quién va cerca, mientras dure la tarjeta.

     Necesita cobertura: sin ella, la pregunta falla y se deja lo último que
     llegó (la tarjeta dice de qué hora es). Los datos entran en la tarjeta al
     momento, sin esperar a la siguiente posición.
     */
    private func vigilaCorredores() {
        guard vigilanteDeCorredores == nil, eventoId != nil else { return }
        vigilanteDeCorredores = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pideCorredores()
                try? await Task.sleep(nanoseconds: UInt64(Self.cadaCuantoCorredores * 1_000_000_000))
            }
        }
    }

    private func pideCorredores() async {
        guard let token, let eventoId, let actividad, let hoja else { return }
        let km = historia.last?.1
        guard let nuevos = try? await API.corredoresCerca(token: token, eventId: eventoId, km: km) else { return }
        corredores = nuevos
        let ahora = Date()
        guard let e = ReglasDeCarrera.estado(carrera: carrera, km: km ?? 0, ahora: ahora, historia: historia,
                                             anterior: actividad.content.state, corredores: nuevos, hoja)
        else { return }
        ultimo = e
        ultimoEnvio = ahora
        await actividad.update(ActivityContent(state: e, staleDate: ahora.addingTimeInterval(20 * 60)))
    }

    /// La posición de la baliza: solo para la tarjeta de su carrera.
    func recibeDeLaBaliza(km: Double, en fecha: Date) {
        guard origen == .baliza else { return }
        recibe(km: km, en: fecha)
    }

    /// Al parar la baliza: su tarjeta, no la de una ruta.
    func terminaLaDeLaBaliza() {
        guard origen == .baliza else { return }
        termina()
    }

    /**
     Empezar la tarjeta de una RUTA propia, sin carrera (ver `CarreraConTrazado`).
     Sin corredores: nadie más va por esa ruta.
     */
    func empiezaConTrazado(hoja: HojaDeTramos, nombre: String) throws {
        if actividad != nil, origen == .baliza {
            throw ErrorDeCarrera("Ya hay una tarjeta de carrera en marcha, la de la baliza. Para la baliza para empezar esta.")
        }
        termina()
        origen = .trazado
        self.hoja = hoja
        carrera = nombre
        eventoId = nil
        guard let inicial = ReglasDeCarrera.estado(carrera: nombre, km: 0, ahora: Date(),
                                                    historia: [], anterior: nil, hoja)
        else { throw ErrorDeCarrera("La ruta no tiene recorrido con el que hacer tramos.") }
        let a = try Activity.request(
            attributes: CarreraAtributos(carrera: nombre),
            content: ActivityContent(state: inicial, staleDate: Date().addingTimeInterval(20 * 60)),
            pushType: nil)
        engancha(a)
        ultimo = inicial
        ultimoEnvio = Date()
    }

    /// Al relanzar la app con la tarjeta de una ruta en marcha: engancharse a
    /// ella (activa o caducada) con la hoja guardada. False si ya no está.
    func reenganchaTrazado(hoja: HojaDeTramos) -> Bool {
        guard let viva = Activity<CarreraAtributos>.activities.first(where: {
            $0.activityState == .active || $0.activityState == .stale
        }) else { return false }
        origen = .trazado
        self.hoja = hoja
        carrera = viva.attributes.carrera
        ultimo = viva.content.state
        engancha(viva)
        return true
    }

    /// Si la quitan desde la pantalla de bloqueo (o el sistema la acaba), se
    /// avisa para apagar el GPS de la ruta.
    private func engancha(_ a: Activity<CarreraAtributos>) {
        actividad = a
        vigilancia?.cancel()
        vigilancia = Task { [weak self] in
            for await e in a.activityStateUpdates where e == .dismissed || e == .ended {
                await MainActor.run {
                    guard let self, self.actividad?.id == a.id else { return }
                    self.actividad = nil
                    self.alAcabar?()
                }
                return
            }
        }
    }

    /// Cada posición con su km de la ruta.
    func recibe(km: Double, en fecha: Date) {
        historia.append((fecha, km))
        historia.removeAll { fecha.timeIntervalSince($0.0) > 2 * 3600 }
        // La vista, de la tarjeta viva y no de la última que se mandó: el
        // selector la cambia directamente en la tarjeta (ver
        // `CambiaVistaDeCarrera`), sin pasar por aquí.
        guard let actividad, let hoja,
              let nuevo = ReglasDeCarrera.estado(carrera: carrera, km: km, ahora: fecha, historia: historia,
                                                 anterior: actividad.content.state, corredores: corredores, hoja),
              ReglasDeCarrera.mereceMandar(nuevo, despuesDe: actividad.content.state, ahora: fecha,
                                           ultimoEnvio: ultimoEnvio)
        else { return }
        ultimo = nuevo
        ultimoEnvio = fecha
        let contenido = ActivityContent(state: nuevo, staleDate: fecha.addingTimeInterval(20 * 60))
        if nuevo.tramo.enMeta {
            // En meta: se queda un rato enseñando el tiempo y se va sola.
            self.actividad = nil
            vigilanteDeCorredores?.cancel()
            vigilanteDeCorredores = nil
            vigilancia?.cancel()
            Task { await actividad.end(contenido, dismissalPolicy: .after(fecha.addingTimeInterval(2 * 3600))) }
            alAcabar?()
        } else {
            Task { await actividad.update(contenido) }
        }
    }

    /// Solo para el arranque de prueba (`-PruebaDeCarrera`): una carrera con
    /// una hoja fija, sin baliza ni web, para ver la tarjeta del sistema.
    func empiezaDePrueba(hoja: HojaDeTramos, carrera: String, km: Double, ahora: Date,
                         corredores: DatosCorredores? = nil) {
        self.hoja = hoja
        self.carrera = carrera
        self.corredores = corredores
        guard let d = ReglasDeCarrera.estado(carrera: carrera, km: km, ahora: ahora, historia: [],
                                             anterior: nil, corredores: corredores, hoja)
        else { return }
        actividad = try? Activity.request(
            attributes: CarreraAtributos(carrera: carrera),
            content: ActivityContent(state: d, staleDate: ahora.addingTimeInterval(20 * 60)),
            pushType: nil)
        ultimo = d
        ultimoEnvio = ahora
    }

    /// Quitar la tarjeta, sea de donde sea.
    func termina() {
        let a = actividad
        actividad = nil
        vigilancia?.cancel()
        origen = .baliza
        hoja = nil
        ultimo = nil
        ultimoEnvio = nil
        historia = []
        corredores = nil
        vigilanteDeCorredores?.cancel()
        vigilanteDeCorredores = nil
        guard let a else { return }
        Task { await a.end(nil, dismissalPolicy: .immediate) }
    }

    /// La hoja guardada de esta sesión, o calculada ahora con la web.
    private static func hoja(sesion: String, token: String, eventoId: String?, salidaMs: Double?) async -> HojaDeTramos? {
        let guardada = LocalStore.hojaURL(sesion)
        if let d = try? Data(contentsOf: guardada),
           let h = try? JSONDecoder().decode(HojaDeTramos.self, from: d) { return h }
        // Calcularla necesita la carrera y la web, y la web solo corre con la
        // app delante.
        guard let eventoId, UIApplication.shared.applicationState != .background,
              let plan = try? Data(contentsOf: LocalStore.planURL(sesion)) else { return nil }
        let ajustes = try? await API.ajustesDelEvento(token: token, eventId: eventoId)
        let web = GpxImporter()
        defer { web.suelta() }
        guard let datos = try? await web.hojaDeTramos(
                planGz: plan, ajustes: ajustes, salidaMs: salidaMs),
              let h = try? JSONDecoder().decode(HojaDeTramos.self, from: datos)
        else { return nil }
        try? datos.write(to: guardada, options: .atomic)
        return h
    }
}

struct ErrorDeCarrera: LocalizedError {
    let errorDescription: String?
    init(_ texto: String) { errorDescription = texto }
}
