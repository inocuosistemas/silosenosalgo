import Foundation
import CoreLocation
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 Un VIAJE EN DIRECTO: de un sitio a otro, con el GPS diciendo por dónde se va.

 Es una Actividad en Directo (pantalla de bloqueo e Isla Dinámica), no un
 widget: un widget no ejecuta nada mientras se mira y no puede seguir el GPS.
 La arranca la app, que es la que tiene el GPS, y la va actualizando ella misma
 mientras sigue despierta en segundo plano.

 Nació para un vuelo —dos ciudades y un avión—, y la idea es que luego sirva
 para las carreras.
 */
public struct LugarDeViaje: Codable, Hashable, Sendable {
    public var nombre: String
    /// Lo que va en grande, como en los paneles de los aeropuertos: «BCN».
    public var abreviatura: String
    public var latitud: Double
    public var longitud: Double

    public init(nombre: String, abreviatura: String, latitud: Double, longitud: Double) {
        self.nombre = nombre
        self.abreviatura = abreviatura
        self.latitud = latitud
        self.longitud = longitud
    }

    public var coordenada: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitud, longitude: longitud)
    }
}

public enum TransporteDeViaje: String, Codable, CaseIterable, Hashable, Sendable {
    case avion, tren, coche, autobus, barco, bici, andando

    public var nombre: String {
        switch self {
        case .avion: return "Avión"
        case .tren: return "Tren"
        case .coche: return "Coche"
        case .autobus: return "Autobús"
        case .barco: return "Barco"
        case .bici: return "Bici"
        case .andando: return "A pie"
        }
    }

    /// El símbolo del sistema, visto de lado para que pueda ir de izquierda a
    /// derecha sobre la barra.
    public var simbolo: String {
        switch self {
        case .avion: return "airplane"
        case .tren: return "tram.fill"
        case .coche: return "car.side.fill"
        case .autobus: return "bus.fill"
        case .barco: return "ferry.fill"
        case .bici: return "bicycle"
        case .andando: return "figure.walk"
        }
    }

    /// El dibujo del sistema mira hacia la izquierda, y aquí se viaja hacia la
    /// derecha: se le da la vuelta para que no parezca que va marcha atrás.
    public var miraALaIzquierda: Bool { self == .coche }
}

/// Las cuentas del trayecto: cuánto hay en línea recta y qué parte va hecha.
///
/// En línea recta de verdad —por la superficie de la Tierra, no en un plano—,
/// que para un vuelo largo es la única que tiene sentido.
public enum Trayecto {
    /// Kilómetros entre dos puntos por la superficie de la Tierra.
    public static func km(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let r = 6371.0088
        let f1 = a.latitude * .pi / 180, f2 = b.latitude * .pi / 180
        let df = (b.latitude - a.latitude) * .pi / 180
        let dl = (b.longitude - a.longitude) * .pi / 180
        let h = sin(df / 2) * sin(df / 2) + cos(f1) * cos(f2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * asin(min(1, sqrt(h)))
    }

    /// Qué parte del camino va hecha, de 0 a 1, por lo que FALTA hasta el
    /// destino. Se mide así y no por lo recorrido: un avión da vueltas al
    /// despegar y al esperar para aterrizar, y lo que importa es lo que queda.
    /// Antes de salir —en el aeropuerto, fuera de la ciudad— puede quedar más
    /// que el total, y entonces es cero, no un número negativo.
    public static func progreso(restante: Double, total: Double) -> Double {
        guard total > 0 else { return 1 }
        return min(1, max(0, 1 - restante / total))
    }
}

#if canImport(ActivityKit)
public struct ViajeAtributos: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var restanteKm: Double
        public var progreso: Double
        /// A qué hora se llega a este ritmo; nil si no hay velocidad con la
        /// que calcularlo (parado, o sin señal).
        public var llegada: Date?
        public var llegado: Bool
        /// Cuándo fue la última posición buena.
        public var actualizado: Date

        public init(restanteKm: Double, progreso: Double, llegada: Date? = nil,
                    llegado: Bool = false, actualizado: Date = Date()) {
            self.restanteKm = restanteKm
            self.progreso = progreso
            self.llegada = llegada
            self.llegado = llegado
            self.actualizado = actualizado
        }
    }

    public var origen: LugarDeViaje
    public var destino: LugarDeViaje
    public var transporte: TransporteDeViaje

    public init(origen: LugarDeViaje, destino: LugarDeViaje, transporte: TransporteDeViaje) {
        self.origen = origen
        self.destino = destino
        self.transporte = transporte
    }

    public var totalKm: Double { Trayecto.km(origen.coordenada, destino.coordenada) }
}
#endif
