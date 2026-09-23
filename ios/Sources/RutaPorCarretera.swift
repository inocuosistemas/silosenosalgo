import CoreLocation
import MapKit

/**
 La RUTA de verdad de un viaje por carretera (o a pie): la pide la app a
 Apple Maps —el mismo servicio que usa Mapas, sin servidor nuestro— y con ella
 los km que quedan dejan de ser en línea recta.

 La ruta se pide una vez, al empezar (hace falta cobertura); después, dónde se
 va sobre ella se calcula en el móvil, sin red, igual que la baliza sitúa al
 corredor sobre el recorrido de una carrera (`PlanGeometry.projectKm`). La hora
 de llegada sí se vuelve a pedir de vez en cuando, con el tráfico del momento.
 */
struct RutaPorCarretera {
    /// El trazado, con un punto cada 100 m como mucho (ver `rellena`).
    let geometria: PlanGeometry.Route
    /// Lo que Apple calcula que se tarda desde donde se pidió, con tráfico.
    let segundos: TimeInterval
    let pedida: Date

    var km: Double { geometria.totalKm }
}

enum Carreteras {
    /// Cómo se pide la ruta según cómo se viaja; nil, en línea recta (el avión
    /// y el barco, que no van por carretera, y el tren: Apple solo da
    /// transporte público en algunas ciudades y no sirve para un trayecto largo).
    static func tipo(_ t: TransporteDeViaje) -> MKDirectionsTransportType? {
        switch t {
        case .coche, .autobus: return .automobile
        case .andando, .bici: return .walking
        case .avion, .barco, .tren: return nil
        }
    }

    /// Pedir la ruta a Apple Maps. Hace falta red.
    static func pide(desde: CLLocationCoordinate2D, hasta: CLLocationCoordinate2D,
                     tipo: MKDirectionsTransportType) async throws -> RutaPorCarretera {
        let peticion = MKDirections.Request()
        peticion.source = MKMapItem(placemark: MKPlacemark(coordinate: desde))
        peticion.destination = MKMapItem(placemark: MKPlacemark(coordinate: hasta))
        peticion.transportType = tipo
        // Salir ahora: así el tiempo lleva el tráfico de este momento.
        peticion.departureDate = Date()
        let respuesta = try await MKDirections(request: peticion).calculate()
        guard let ruta = respuesta.routes.first else { throw MKError(.directionsNotFound) }
        return RutaPorCarretera(geometria: geometria(de: ruta.polyline), segundos: ruta.expectedTravelTime,
                                pedida: Date())
    }

    /// Solo el tiempo, desde donde se esté: para refrescar la hora de llegada
    /// con el tráfico del momento sin cambiar la ruta.
    static func tiempo(desde: CLLocationCoordinate2D, hasta: CLLocationCoordinate2D,
                       tipo: MKDirectionsTransportType) async throws -> TimeInterval {
        let peticion = MKDirections.Request()
        peticion.source = MKMapItem(placemark: MKPlacemark(coordinate: desde))
        peticion.destination = MKMapItem(placemark: MKPlacemark(coordinate: hasta))
        peticion.transportType = tipo
        peticion.departureDate = Date()
        return try await MKDirections(request: peticion).calculateETA().expectedTravelTime
    }

    static func geometria(de linea: MKPolyline) -> PlanGeometry.Route {
        var coords = [CLLocationCoordinate2D](repeating: .init(), count: linea.pointCount)
        linea.getCoordinates(&coords, range: NSRange(location: 0, length: linea.pointCount))
        return rellena(coords.map { ($0.latitude, $0.longitude) })
    }

    /**
     El trazado con un punto cada `paso` metros como mucho.

     Las rutas de Apple ponen pocos puntos en los tramos rectos —en autopista,
     a kilómetros unos de otros—, y lo que sitúa sobre la ruta busca el PUNTO
     más cercano: yendo por el medio de uno de esos tramos, el más cercano
     quedaba a más de 250 m y se daba por fuera de la ruta. Rellenando, eso no
     pasa.
     */
    static func rellena(_ puntos: [(lat: Double, lon: Double)], paso: Double = 100) -> PlanGeometry.Route {
        guard var anterior = puntos.first else { return PlanGeometry.Route(points: [], cumKm: []) }
        var pts = [anterior]
        var cum = [0.0]
        for p in puntos.dropFirst() {
            let a = CLLocation(latitude: anterior.lat, longitude: anterior.lon)
            let d = a.distance(from: CLLocation(latitude: p.lat, longitude: p.lon))
            let n = max(1, Int((d / paso).rounded(.up)))
            for k in 1...n {
                let t = Double(k) / Double(n)
                pts.append((anterior.lat + (p.lat - anterior.lat) * t, anterior.lon + (p.lon - anterior.lon) * t))
                cum.append(cum[cum.count - 1] + d / Double(n) / 1000)
            }
            anterior = p
        }
        return PlanGeometry.Route(points: pts, cumKm: cum)
    }

    /**
     Dónde se va sobre la ruta, en km desde su principio.

     Primero cerca de donde se iba (lo normal); si no, en toda la ruta (la app
     ha estado dormida y se ha avanzado mucho de golpe). Nil si se está fuera de
     ella: entonces toca recalcularla desde donde se esté.
     */
    static func km(en pos: CLLocationCoordinate2D, de ruta: RutaPorCarretera, antes: Double?) -> Double? {
        PlanGeometry.projectKm(ruta.geometria, lat: pos.latitude, lon: pos.longitude, previousKm: antes)
            ?? PlanGeometry.projectKm(ruta.geometria, lat: pos.latitude, lon: pos.longitude, previousKm: nil)
    }

    /**
     La FORMA de la ruta, para dibujarla en la tarjeta: `n` puntos repartidos
     por km, en una caja de 0 a 1 con su proporción (la x ya corregida por la
     latitud, para que no salga aplastada).

     Girada para que vaya de izquierda (el origen) a derecha (el destino),
     como la barra y los códigos de la tarjeta: tal como está en el mapa, un
     Barcelona–Madrid iba de derecha a izquierda con BCN puesto a la izquierda.
     Se gira, no se refleja: la forma sigue siendo la de la ruta.

     Viaja en la tarjeta, así que va compacta: cada coordenada en un byte, y
     el conjunto en texto (unos 110 caracteres para 40 puntos).
     */
    static func forma(_ geo: PlanGeometry.Route, puntos n: Int = 40) -> String {
        guard geo.points.count > 1, geo.totalKm > 0 else { return "" }
        var muestras: [(x: Double, y: Double)] = []
        let latMedia = geo.points.map(\.lat).reduce(0, +) / Double(geo.points.count)
        let k = cos(latMedia * .pi / 180)
        for j in 0..<n {
            let objetivo = geo.totalKm * Double(j) / Double(n - 1)
            let i = geo.cumKm.firstIndex(where: { $0 >= objetivo }) ?? geo.points.count - 1
            muestras.append((geo.points[i].lon * k, -geo.points[i].lat))
        }
        let a = muestras[0], b = muestras[muestras.count - 1]
        let giro = -atan2(b.y - a.y, b.x - a.x)
        muestras = muestras.map { m in
            let x = m.x - a.x, y = m.y - a.y
            return (x * cos(giro) - y * sin(giro), x * sin(giro) + y * cos(giro))
        }
        let xs = muestras.map(\.x), ys = muestras.map(\.y)
        let ancho = max(1e-9, xs.max()! - xs.min()!), alto = max(1e-9, ys.max()! - ys.min()!)
        let lado = max(ancho, alto)
        var bytes: [UInt8] = []
        for m in muestras {
            bytes.append(UInt8(((m.x - xs.min()!) / lado * 255).rounded()))
            bytes.append(UInt8(((m.y - ys.min()!) / lado * 255).rounded()))
        }
        return Data(bytes).base64EncodedString()
    }
}
