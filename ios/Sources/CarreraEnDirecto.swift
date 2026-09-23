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

    /// El perfil de un tramo en `muestrasDelTramo` puntos parejos.
    static func perfil(de desde: Double, a hasta: Double, _ hoja: HojaDeTramos) -> [DatosDeTramo.Muestra] {
        guard hasta > desde else { return [] }
        let n = muestrasDelTramo
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

    /// Si hay que mandar la tarjeta otra vez: al cambiar de tramo, al moverse
    /// lo bastante para que se note en el perfil, o cada minuto como mucho,
    /// para que el margen al corte no se quede viejo.
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
final class CarreraEnDirecto {
    static let shared = CarreraEnDirecto()

    private var actividad: Activity<CarreraAtributos>?
    private var hoja: HojaDeTramos?
    private var carrera = ""
    private var ultimo: DatosDeTramo?
    private var ultimoEnvio: Date?
    /// Las posiciones de la última hora y pico, para medir cómo se rinde.
    private var historia: [(Date, Double)] = []

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
        Task {
            if hoja == nil {
                hoja = await Self.hoja(sesion: sesion, token: token, eventoId: eventoId, salidaMs: salidaMs)
            }
            guard let hoja else { return }
            if let viva = Activity<CarreraAtributos>.activities.first(where: { $0.activityState == .active }) {
                actividad = viva
                carrera = viva.attributes.carrera
                ultimo = viva.content.state
                return
            }
            // Arrancar solo se puede con la app delante, y sabiendo la carrera.
            guard let nombre, eventoId != nil,
                  UIApplication.shared.applicationState != .background,
                  ActivityAuthorizationInfo().areActivitiesEnabled,
                  let inicial = ReglasDeCarrera.datos(carrera: nombre, km: 0, ahora: Date(),
                                                       historia: [], hoja)
            else { return }
            carrera = nombre
            actividad = try? Activity.request(
                attributes: CarreraAtributos(carrera: nombre),
                content: ActivityContent(state: inicial, staleDate: Date().addingTimeInterval(20 * 60)),
                pushType: nil)
            ultimo = inicial
            ultimoEnvio = Date()
        }
    }

    /// Cada posición con su km de la ruta.
    func recibe(km: Double, en fecha: Date) {
        historia.append((fecha, km))
        historia.removeAll { fecha.timeIntervalSince($0.0) > 2 * 3600 }
        guard let actividad, let hoja,
              let nuevo = ReglasDeCarrera.datos(carrera: carrera, km: km, ahora: fecha,
                                                historia: historia, hoja),
              ReglasDeCarrera.mereceMandar(nuevo, despuesDe: ultimo, ahora: fecha, ultimoEnvio: ultimoEnvio)
        else { return }
        ultimo = nuevo
        ultimoEnvio = fecha
        let contenido = ActivityContent(state: nuevo, staleDate: fecha.addingTimeInterval(20 * 60))
        if nuevo.enMeta {
            // En meta: se queda un rato enseñando el tiempo y se va sola.
            self.actividad = nil
            Task { await actividad.end(contenido, dismissalPolicy: .after(fecha.addingTimeInterval(2 * 3600))) }
        } else {
            Task { await actividad.update(contenido) }
        }
    }

    /// Solo para el arranque de prueba (`-PruebaDeCarrera`): una carrera con
    /// una hoja fija, sin baliza ni web, para ver la tarjeta del sistema.
    func empiezaDePrueba(hoja: HojaDeTramos, carrera: String, km: Double, ahora: Date) {
        self.hoja = hoja
        self.carrera = carrera
        guard let d = ReglasDeCarrera.datos(carrera: carrera, km: km, ahora: ahora, historia: [], hoja)
        else { return }
        actividad = try? Activity.request(
            attributes: CarreraAtributos(carrera: carrera),
            content: ActivityContent(state: d, staleDate: ahora.addingTimeInterval(20 * 60)),
            pushType: nil)
        ultimo = d
        ultimoEnvio = ahora
    }

    /// Al parar la baliza.
    func termina() {
        let a = actividad
        actividad = nil
        hoja = nil
        ultimo = nil
        ultimoEnvio = nil
        historia = []
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
