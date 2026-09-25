import Foundation
import ImageIO
import CoreLocation

/**
 Dónde va una foto en una salida ya terminada.

 Tres maneras, de más fiable a menos:
 - POR LA HORA: la foto se hizo a las 10:42 y a las 10:42 estabas en tal punto
   del trazado. Es la buena casi siempre —la foto la hizo el mismo móvil que
   grababa— y además cae encima de la línea.
 - POR EL GPS de la foto: cuando la hora no cae dentro de la salida, o cuando
   el GPS de la foto está lejos de donde dice la hora (la hizo otra cámara con
   el reloj mal puesto): entonces manda el GPS, que no depende de ningún reloj.
 - A MANO: sin hora ni GPS (la que llega por WhatsApp los pierde), se toca en
   el mapa y se pega al punto del trazado más cercano.

 La distancia (`distM`) se cuenta como en la baliza: la del trazado hasta ese
 punto, con el mismo umbral que no suma el temblor del GPS parado (ver
 `TrackingRules.trailDistanceMeters`).
 */
enum ColocaFotos {
    enum Modo: Equatable { case porHora, porGPS, aMano }

    struct Sitio: Equatable {
        var lat: Double
        var lon: Double
        /// Metros recorridos hasta ahí.
        var distM: Double
        /// La hora del trazado en ese punto (epoch ms): la de la nota cuando la
        /// foto no trae la suya.
        var t: Double
        var modo: Modo
    }

    /// Lo que se acepta fuera del trazado, antes de la primera posición o
    /// después de la última: la foto de la salida, o la de la meta con el
    /// móvil ya parado.
    static let margenMs: Double = 15 * 60_000
    /// Si el GPS de la foto está más lejos que esto de donde dice la hora, la
    /// hora está mal (otra cámara, otro reloj) y manda el GPS.
    static let desacuerdoM: Double = 500

    /// Los metros recorridos hasta cada punto del trazado.
    static func acumulado(_ trail: [TrailPoint]) -> [Double] {
        guard !trail.isEmpty else { return [] }
        var acum = [0.0]
        acum.reserveCapacity(trail.count)
        for i in 1..<trail.count {
            let a = trail[i - 1], b = trail[i]
            let d: Double = TrackingRules.distanceMeters(a.lat, a.lon, b.lat, b.lon)
            let umbral: Double = TrackingRules.movementThreshold(a.a.map(Double.init), b.a.map(Double.init))
            acum.append(acum[i - 1] + (d >= umbral ? d : 0))
        }
        return acum
    }

    /// Si una hora cae dentro de la salida (con su margen).
    static func dentro(_ t: Double, _ trail: [TrailPoint]) -> Bool {
        guard let a = trail.first?.t, let b = trail.last?.t else { return false }
        return t >= a - margenMs && t <= b + margenMs
    }

    /// Dónde estabas a esa hora: entre los dos puntos que la rodean, en
    /// proporción al tiempo. Fuera del margen, nada.
    static func porHora(_ t: Double, _ trail: [TrailPoint], _ acum: [Double]) -> Sitio? {
        guard dentro(t, trail), let primero = trail.first, let ultimo = trail.last else { return nil }
        if t <= primero.t { return Sitio(lat: primero.lat, lon: primero.lon, distM: 0, t: primero.t, modo: .porHora) }
        if t >= ultimo.t {
            return Sitio(lat: ultimo.lat, lon: ultimo.lon, distM: acum.last ?? 0, t: ultimo.t, modo: .porHora)
        }
        // El primer punto posterior, por bisección: el trazado viene ordenado.
        var lo = 0, hi = trail.count - 1
        while lo < hi {
            let m = (lo + hi) / 2
            if trail[m].t < t { lo = m + 1 } else { hi = m }
        }
        let b = trail[lo], a = trail[lo - 1]
        let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
        return Sitio(
            lat: a.lat + (b.lat - a.lat) * f,
            lon: a.lon + (b.lon - a.lon) * f,
            distM: acum[lo - 1] + (acum[lo] - acum[lo - 1]) * f,
            t: t, modo: .porHora
        )
    }

    /// El punto del trazado más cercano a una posición.
    static func masCercano(lat: Double, lon: Double, _ trail: [TrailPoint]) -> Int? {
        guard !trail.isEmpty else { return nil }
        var mejor = 0
        var dMin = Double.infinity
        for (i, p) in trail.enumerated() {
            let d = TrackingRules.distanceMeters(lat, lon, p.lat, p.lon)
            if d < dMin { dMin = d; mejor = i }
        }
        return mejor
    }

    /// Con el GPS de la foto: en su sitio exacto, con los metros del punto del
    /// trazado más cercano.
    static func porGPS(lat: Double, lon: Double, _ trail: [TrailPoint], _ acum: [Double]) -> Sitio? {
        guard let i = masCercano(lat: lat, lon: lon, trail) else { return nil }
        return Sitio(lat: lat, lon: lon, distM: acum[i], t: trail[i].t, modo: .porGPS)
    }

    /// Tocado en el mapa: pegado al punto del trazado más cercano, que es donde
    /// se estuvo de verdad.
    static func aMano(lat: Double, lon: Double, _ trail: [TrailPoint], _ acum: [Double]) -> Sitio? {
        guard let i = masCercano(lat: lat, lon: lon, trail) else { return nil }
        return Sitio(lat: trail[i].lat, lon: trail[i].lon, distM: acum[i], t: trail[i].t, modo: .aMano)
    }

    /// Lo que se puede decir sin que nadie toque nada: por la hora, por el GPS,
    /// o nada (y entonces, a mano).
    static func coloca(fecha: Double?, gps: CLLocationCoordinate2D?, _ trail: [TrailPoint], _ acum: [Double]) -> Sitio? {
        if let fecha, let s = porHora(fecha, trail, acum) {
            if let gps, TrackingRules.distanceMeters(gps.latitude, gps.longitude, s.lat, s.lon) > desacuerdoM {
                return porGPS(lat: gps.latitude, lon: gps.longitude, trail, acum)
            }
            return s
        }
        if let gps { return porGPS(lat: gps.latitude, lon: gps.longitude, trail, acum) }
        return nil
    }

    // MARK: Las que ya están

    /// Cuánto puede pasar entre hacer la foto con la cámara de la app y
    /// guardar la nota: el tiempo de escribir dos líneas, o de dictarlas.
    static let ventanaDeNotaMs: Double = 3 * 60_000

    /**
     Cuáles de las fotos del carrete (`fotos`: id y hora) están ya en alguna
     nota con foto de la salida (`notas`: su `createdAt` y su `fixAt`).

     - EXACTAS: las que se añadieron desde aquí llevan la hora de la foto (en
       `fixAt`, y en `createdAt` si se colocaron por la hora). Un segundo de
       margen por el redondeo.
     - Las hechas EN MARCHA con la cámara de la app: la foto va al carrete al
       dispararla y la nota se guarda un rato después. Para cada nota que no
       casó exacta, la última foto hecha en los tres minutos antes de guardarla.
       Una por nota como mucho: con una ráfaga de fotos, marcar todas las de esos
       minutos sería decir que ya está lo que no está.
     */
    static func yaAnadidas(_ fotos: [(id: String, t: Double)], notas: [(createdAt: Double, fixAt: Double?)]) -> Set<String> {
        var hechas = Set<String>()
        var sinCasar: [Double] = []
        for n in notas {
            let exacta = fotos.first { f in
                abs(f.t - n.createdAt) <= 1000 || n.fixAt.map { abs(f.t - $0) <= 1000 } == true
            }
            if let exacta { hechas.insert(exacta.id) } else { sinCasar.append(n.createdAt) }
        }
        for guardada in sinCasar {
            let antes = fotos.filter { !hechas.contains($0.id) && $0.t <= guardada && $0.t >= guardada - ventanaDeNotaMs }
            if let ultima = antes.max(by: { $0.t < $1.t }) { hechas.insert(ultima.id) }
        }
        return hechas
    }

    // MARK: Lo que trae la foto

    /// La hora y el GPS que lleva dentro el fichero (EXIF). Sirve para las que
    /// se eligen en la galería con el selector del sistema, que no dice nada
    /// de la foto pero sí entrega el fichero entero.
    static func metadatos(_ datos: Data) -> (fecha: Date?, gps: CLLocationCoordinate2D?) {
        guard let src = CGImageSourceCreateWithData(datos as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return (nil, nil) }
        var fecha: Date?
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
           let s = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
            fecha = fechaExif(s, desfase: exif[kCGImagePropertyExifOffsetTimeOriginal] as? String)
        }
        var gps: CLLocationCoordinate2D?
        if let g = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
           let lat = g[kCGImagePropertyGPSLatitude] as? Double,
           let lon = g[kCGImagePropertyGPSLongitude] as? Double {
            let s = (g[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -1.0 : 1.0
            let w = (g[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -1.0 : 1.0
            gps = CLLocationCoordinate2D(latitude: lat * s, longitude: lon * w)
        }
        return (fecha, gps)
    }

    /// "2026:09:20 10:42:07" con su desfase ("+02:00") si lo trae. Sin él, la
    /// zona del móvil: es la de casi todas las fotos que se suben al volver.
    static func fechaExif(_ s: String, desfase: String?, zona: TimeZone = .current) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy:MM:dd HH:mm:ss"
        f.timeZone = desfase.flatMap(zonaDe) ?? zona
        return f.date(from: s)
    }

    private static func zonaDe(_ desfase: String) -> TimeZone? {
        let partes = desfase.dropFirst().split(separator: ":")
        guard let signo = desfase.first, signo == "+" || signo == "-", partes.count == 2,
              let h = Int(partes[0]), let m = Int(partes[1]) else { return nil }
        return TimeZone(secondsFromGMT: (signo == "-" ? -1 : 1) * (h * 3600 + m * 60))
    }
}
