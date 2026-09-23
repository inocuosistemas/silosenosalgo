import XCTest
import SwiftUI
import CoreLocation
@testable import SiLoSeNoSalgo

/**
 La propuesta del ARCO para los vuelos, pintada con las vistas de verdad.

 Escribe en la carpeta que diga `LAMINA_VIAJE` (si no, al temporal).
 */
@MainActor
final class LaminaArcoTests: XCTestCase {
    private let bcn = LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.2974, longitud: 2.0833)
    private let nrt = LugarDeViaje(nombre: "Tokio", abreviatura: "NRT", latitud: 35.7720, longitud: 140.3929)

    private func datos(_ p: Double, llegado: Bool = false, sinSenal: Bool = false,
                       titulo: String? = nil) -> DatosDeViaje {
        let total = Trayecto.km(bcn.coordenada, nrt.coordenada)
        return DatosDeViaje(
            titulo: titulo, origen: bcn, destino: nrt, transporte: .avion,
            restanteKm: total * (1 - p), progreso: p,
            llegada: Calendar.current.date(bySettingHour: 14, minute: 20, second: 0, of: Date()),
            llegado: llegado, sinSenal: sinSenal,
            actualizado: Date().addingTimeInterval(-25 * 60))
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

    private func serie(_ forma: TarjetaViajeArco.Forma, _ nombre: String) -> some View {
        VStack(spacing: 12) {
            rotulo("\(nombre) · despegando")
            caja(TarjetaViajeArco(datos: datos(0.04), forma: forma))
            rotulo("\(nombre) · en crucero, con título")
            caja(TarjetaViajeArco(datos: datos(0.5, titulo: "Viaje a Japón"), forma: forma))
            rotulo("\(nombre) · aterrizando")
            caja(TarjetaViajeArco(datos: datos(0.95), forma: forma))
            rotulo("\(nombre) · sin señal")
            caja(TarjetaViajeArco(datos: datos(0.7, sinSenal: true), forma: forma))
            rotulo("\(nombre) · llegado")
            caja(TarjetaViajeArco(datos: datos(1, llegado: true), forma: forma))
        }
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
        let carpeta = URL(fileURLWithPath: base).appendingPathComponent("arco")
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        try XCTUnwrap(img.pngData()).write(to: carpeta.appendingPathComponent("\(nombre).png"))
        print("LAMINA \(carpeta.path)/\(nombre).png")
    }

    /// Lo que salió apretado en el móvil: nombres largos debajo de los códigos.
    private var estambul: DatosDeViaje {
        let prat = LugarDeViaje(nombre: "El Prat de Llobregat", abreviatura: "BCN", latitud: 41.2886, longitud: 2.0743)
        let ist = LugarDeViaje(nombre: "Istanbul Airport", abreviatura: "IST", latitud: 41.2753, longitud: 28.7519)
        let total = Trayecto.km(prat.coordenada, ist.coordenada)
        return DatosDeViaje(titulo: "Algo muy especial...🎁", origen: prat, destino: ist, transporte: .avion,
                            colores: ColoresDeViaje(fondo: "#1a0b2e", trayecto: "#8b5cf6"),
                            restanteKm: total, progreso: 0)
    }

    func testPintaLaPropuestaDelArco() throws {
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Nombres largos · al salir")
            TarjetaViajeArco(datos: estambul, forma: .semicirculo)
                .frame(width: 361).background(Color(hexContador: "#1a0b2e"))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            rotulo("Nombres largos · a medio camino")
            TarjetaViajeArco(datos: { var d = estambul; d.progreso = 0.5; d.restanteKm = 1112; return d }(), forma: .semicirculo)
                .frame(width: 361).background(Color(hexContador: "#1a0b2e"))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }), "03-nombres-largos")
        try pinta(sobreFondo(serie(.tendido, "Arco tendido")), "01-arco-tendido")
        try pinta(sobreFondo(serie(.semicirculo, "Semicírculo")), "02-semicirculo")
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Ahora · barra recta")
            caja(TarjetaViaje(datos: datos(0.5, titulo: "Viaje a Japón")))
            rotulo("Arco tendido")
            caja(TarjetaViajeArco(datos: datos(0.5, titulo: "Viaje a Japón"), forma: .tendido))
            rotulo("Semicírculo")
            caja(TarjetaViajeArco(datos: datos(0.5, titulo: "Viaje a Japón"), forma: .semicirculo))
        }), "00-las-tres")
    }

    /// Las dos caben en los 160 puntos que deja el sistema, con título o sin él.
    func testCabenEnElAlto() {
        for forma in [TarjetaViajeArco.Forma.tendido, .semicirculo] {
            for t in [nil, "Viaje a Japón"] {
                for letra in [DynamicTypeSize.large, .accessibility5] {
                    var d = datos(0.5, titulo: t)
                    if forma == .semicirculo {
                        d.origen = estambul.origen
                        d.destino = estambul.destino
                    }
                    let host = UIHostingController(rootView: TarjetaViajeArco(datos: d, forma: forma)
                        .environment(\.dynamicTypeSize, letra))
                    let h = host.sizeThatFits(in: CGSize(width: 361, height: 1000)).height
                    print("ALTO \(forma) titulo=\(t == nil ? "no" : "si") \(letra) \(Int(h))")
                    XCTAssertLessThanOrEqual(h, 160, "\(forma) con título \(t ?? "-") mide \(h)")
                }
            }
        }
    }

    /// Los km, con el punto de los millares aunque el móvil esté en español.
    func testElPuntoDeLosMillaresSaleSiempre() {
        XCTAssertEqual(ColoresViaje.km(2224), "2.224")
    }

    /// El avión sigue la curva: morro arriba al salir, recto arriba del todo,
    /// morro abajo al llegar.
    func testElAvionSigueLaCurva() {
        let g = ArcoDeViaje.Geometria(tamano: CGSize(width: 200, height: 100), chapa: 24)
        XCTAssertLessThan(g.angulo(0.05), -0.5, "despegando, hacia arriba")
        XCTAssertEqual(g.angulo(0.5), 0, accuracy: 0.001, "en lo alto, recto")
        XCTAssertGreaterThan(g.angulo(0.95), 0.5, "aterrizando, hacia abajo")
        // Pero nunca en picado: ni en las mismas puntas pasa de 35°.
        XCTAssertLessThanOrEqual(abs(g.angulo(0)), 35 * .pi / 180 + 0.001)
        XCTAssertLessThanOrEqual(abs(g.angulo(1)), 35 * .pi / 180 + 0.001)
        XCTAssertLessThan(g.punto(0.5).y, g.punto(0).y, "a mitad de viaje, arriba del todo")
    }
}
