import XCTest
import SwiftUI
import MapKit
@testable import SiLoSeNoSalgo

/**
 La propuesta de los viajes POR CARRETERA, con una ruta de verdad pedida a
 Apple Maps: la barra de siempre con los km por carretera, contra la forma de
 la ruta dibujada. Hace falta red; sin ella, se salta.

 Escribe en la carpeta que diga `LAMINA_VIAJE` (si no, al temporal).
 */
@MainActor
final class LaminaCarreteraTests: XCTestCase {
    private let bcn = LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.3874, longitud: 2.1686)
    private let and = LugarDeViaje(nombre: "Andorra la Vella", abreviatura: "AND", latitud: 42.5063, longitud: 1.5218)
    private let mad = LugarDeViaje(nombre: "Madrid", abreviatura: "MAD", latitud: 40.4168, longitud: -3.7038)

    private func ruta(_ a: LugarDeViaje, _ b: LugarDeViaje) async throws -> RutaPorCarretera {
        do {
            return try await Carreteras.pide(desde: a.coordenada, hasta: b.coordenada, tipo: .automobile)
        } catch {
            throw XCTSkip("Sin ruta de Apple Maps (¿sin red?): \(error)")
        }
    }

    private func datos(_ a: LugarDeViaje, _ b: LugarDeViaje, _ r: RutaPorCarretera, _ p: Double,
                       titulo: String? = nil, porRuta: Bool = true, forma: Bool = true,
                       llegado: Bool = false) -> DatosDeViaje {
        let restante = porRuta ? r.km * (1 - p) : Trayecto.km(a.coordenada, b.coordenada) * (1 - p)
        return DatosDeViaje(titulo: titulo, origen: a, destino: b, transporte: .coche,
                            restanteKm: restante, progreso: p,
                            llegada: Date().addingTimeInterval(r.segundos * (1 - p)),
                            llegado: llegado, porRuta: porRuta,
                            forma: forma ? Carreteras.forma(r.geometria) : nil)
    }

    private func caja<V: View>(_ v: V) -> some View {
        v.frame(width: 361)
            .background(Color(hexContador: ColoresDeViaje.porDefecto.fondo))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func rotulo(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1)
            .foregroundStyle(.white.opacity(0.55))
            .frame(width: 361, alignment: .leading)
    }

    private func sobreFondo<V: View>(_ v: V) -> some View {
        v.padding(24)
            .background(LinearGradient(colors: [Color(red: 0.18, green: 0.2, blue: 0.32),
                                                Color(red: 0.05, green: 0.05, blue: 0.1)],
                                       startPoint: .top, endPoint: .bottom))
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: "es_ES"))
    }

    private func pinta<V: View>(_ vista: V, _ nombre: String) throws {
        let host = UIHostingController(rootView: vista.fixedSize())
        host.safeAreaRegions = []
        let tam = host.sizeThatFits(in: CGSize(width: 420, height: 4000))
        host.view.frame = CGRect(origin: .zero, size: tam)
        let v = UIWindow(frame: host.view.frame)
        v.rootViewController = host
        v.isHidden = false
        v.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2
        fmt.preferredRange = .standard
        let img = UIGraphicsImageRenderer(bounds: host.view.bounds, format: fmt).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let base = ProcessInfo.processInfo.environment["LAMINA_VIAJE"] ?? NSTemporaryDirectory()
        let carpeta = URL(fileURLWithPath: base).appendingPathComponent("carretera")
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        try XCTUnwrap(img.pngData()).write(to: carpeta.appendingPathComponent("\(nombre).png"))
        print("LAMINA \(carpeta.path)/\(nombre).png")
    }

    func testPintaLaPropuestaPorCarretera() async throws {
        let andorra = try await ruta(bcn, and)
        let madrid = try await ruta(bcn, mad)
        print("RUTA BCN-AND \(andorra.km) km, \(andorra.segundos / 60) min, \(andorra.geometria.points.count) puntos")
        print("RUTA BCN-MAD \(madrid.km) km, \(madrid.segundos / 60) min")
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Ahora · en línea recta")
            caja(TarjetaViaje(datos: datos(bcn, and, andorra, 0.4, porRuta: false, forma: false)))
            rotulo("A · la barra, con km y hora por carretera")
            caja(TarjetaViaje(datos: datos(bcn, and, andorra, 0.4, forma: false)))
            rotulo("B · la ruta dibujada · Andorra, 40 %")
            caja(TarjetaViajeRuta(datos: datos(bcn, and, andorra, 0.4),
                                  forma: Carreteras.forma(andorra.geometria)))
            rotulo("B · con título · Andorra, 85 %")
            caja(TarjetaViajeRuta(datos: datos(bcn, and, andorra, 0.85, titulo: "Esquí en Grandvalira"),
                                  forma: Carreteras.forma(andorra.geometria)))
            rotulo("B · Madrid, 15 %")
            caja(TarjetaViajeRuta(datos: datos(bcn, mad, madrid, 0.15),
                                  forma: Carreteras.forma(madrid.geometria)))
            rotulo("B · Madrid, llegado")
            caja(TarjetaViajeRuta(datos: datos(bcn, mad, madrid, 1, llegado: true),
                                  forma: Carreteras.forma(madrid.geometria)))
        }), "01-barra-o-ruta")
    }
}
