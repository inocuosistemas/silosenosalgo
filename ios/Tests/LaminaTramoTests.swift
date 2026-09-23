import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 La propuesta de la carrera en directo por tramos, pintada con las vistas de
 verdad. Los datos son de un tramo inventado pero verosímil: un collado, una
 subida de 300 m, y la bajada a un refugio con avituallamiento sólido.

 Escribe en `LAMINA_VIAJE`/carreras (si no, al temporal).
 */
@MainActor
final class LaminaTramoTests: XCTestCase {
    /// Un tramo de 6,2 km: sube de 2.100 a 2.420 y baja a 2.060.
    private let perfil: [DatosDeTramo.Muestra] = stride(from: 0.0, through: 6.2, by: 0.155).map { d in
        let km = 18.4 + d
        let ele: Double
        if d < 2.8 {
            ele = 2100 + 320 * sin(d / 2.8 * .pi / 2) + 12 * sin(d * 7)
        } else {
            ele = 2420 - 360 * (1 - cos((d - 2.8) / 3.4 * .pi)) / 2 + 10 * sin(d * 5)
        }
        return .init(km: km, ele: ele)
    }

    private func datos(en km: Double, margen: Int, forma: String = "") -> DatosDeTramo {
        let hoy = Calendar.current.startOfDay(for: Date())
        let salida = Date().addingTimeInterval(-(3 * 3600 + 42 * 60 + 15))
        let corte = hoy.addingTimeInterval(13.5 * 3600)
        // Lo que queda por subir y bajar desde aquí hasta el final del tramo.
        var sube = 0.0, baja = 0.0
        let delante = perfil.filter { $0.km >= km }
        for (a, b) in zip(delante, delante.dropFirst()) {
            let d = b.ele - a.ele
            if d > 0 { sube += d } else { baja -= d }
        }
        return DatosDeTramo(
            carrera: "Matxicots 26", numero: 3, deTramos: 7,
            desde: PuntoDeCarrera(nombre: "Coll de Pal", km: 18.4, tipo: .control),
            hasta: PuntoDeCarrera(nombre: "Refugi del Rebost", km: 24.6, tipo: .solido),
            posicionKm: km, perfil: perfil,
            subidaRestanteM: Int(sube.rounded()), bajadaRestanteM: Int(baja.rounded()),
            salida: salida,
            prevision: corte.addingTimeInterval(-Double(margen) * 60), corte: corte)
    }

    private func caja<V: View>(_ v: V) -> some View {
        v.frame(width: 361)
            .background(Color(hexContador: "#0f1729"))
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

    private func serie(_ forma: TarjetaTramo.Forma, _ nombre: String) -> some View {
        VStack(spacing: 12) {
            rotulo("\(nombre) · empezando la subida · margen holgado")
            caja(TarjetaTramo(datos: datos(en: 19.2, margen: 48), forma: forma))
            rotulo("\(nombre) · en lo alto · margen justo")
            caja(TarjetaTramo(datos: datos(en: 21.3, margen: 18), forma: forma))
            rotulo("\(nombre) · bajando al refugio · fuera de corte")
            caja(TarjetaTramo(datos: datos(en: 23.9, margen: -6), forma: forma))
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
        let carpeta = URL(fileURLWithPath: base).deletingLastPathComponent().appendingPathComponent("carreras")
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        try XCTUnwrap(img.pngData()).write(to: carpeta.appendingPathComponent("\(nombre).png"))
        print("LAMINA \(carpeta.path)/\(nombre).png")
    }

    func testPintaLaPropuesta() throws {
        try pinta(sobreFondo(serie(.perfilGrande, "A · perfil grande")), "01-perfil-grande")
        try pinta(sobreFondo(serie(.proximoPunto, "B · próximo punto")), "02-proximo-punto")
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("A · perfil grande")
            caja(TarjetaTramo(datos: datos(en: 21.3, margen: 18), forma: .perfilGrande))
            rotulo("B · próximo punto")
            caja(TarjetaTramo(datos: datos(en: 21.3, margen: 18), forma: .proximoPunto))
            rotulo("Isla Dinámica · recogida")
            HStack {
                ForEach([48, 18, -6], id: \.self) { m in
                    HStack {
                        IslaTramoInicio(datos: self.datos(en: 21.3, margen: m))
                        Spacer()
                        IslaTramoFin(datos: self.datos(en: 21.3, margen: m))
                    }
                    .padding(.horizontal, 12)
                    .frame(width: 112, height: 34)
                    .background(Capsule().fill(.black))
                    .foregroundStyle(.white)
                }
            }
            .frame(width: 361)
        }), "00-las-dos")
    }

    /// Las dos caben en los 160 puntos de la pantalla de bloqueo, también con
    /// la letra grande de accesibilidad.
    func testCabenEnElAlto() {
        for forma in [TarjetaTramo.Forma.perfilGrande, .proximoPunto] {
            for letra in [DynamicTypeSize.large, .accessibility5] {
                let host = UIHostingController(rootView: TarjetaTramo(datos: datos(en: 21.3, margen: 18), forma: forma)
                    .environment(\.dynamicTypeSize, letra))
                let h = host.sizeThatFits(in: CGSize(width: 361, height: 1000)).height
                print("ALTO \(forma) \(letra) \(Int(h))")
                XCTAssertLessThanOrEqual(h, 160, "\(forma) mide \(h)")
            }
        }
    }
}
