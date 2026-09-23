import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 La propuesta de la vista GLOBAL de la carrera y del selector Tramo / Carrera,
 pintada con las vistas de verdad. Datos inventados: 42 km de montaña con dos
 subidas, y siete puntos que cierran tramo.

 Escribe en `LAMINA_VIAJE`/../carreras/global (si no, al temporal).
 */
@MainActor
final class LaminaGlobalTests: XCTestCase {
    private let totalKm = 42.0

    /// Sube de 1.200 a 2.300 hasta el km 13, baja a 1.500 en el 21, vuelve a
    /// subir a 2.100 en el 30 y baja a meta, a 1.200.
    private func ele(_ km: Double) -> Double {
        let base: Double
        switch km {
        case ..<13: base = 1200 + 1100 * sin(km / 13 * .pi / 2)
        case ..<21: base = 2300 - 800 * (km - 13) / 8
        case ..<30: base = 1500 + 600 * sin((km - 21) / 9 * .pi / 2)
        default: base = 2100 - 900 * (km - 30) / 12
        }
        return base + 18 * sin(km * 2.3)
    }

    private let puntos: [(String, Double, TipoDePunto, Bool)] = [
        ("Font del Gel", 5, .liquido, false),
        ("Coll de Pal", 9.5, .control, true),
        ("Refugi del Rebost", 15, .solido, false),
        ("La Pleta", 21, .liquido, true),
        ("Collada Verda", 28, .completo, true),
        ("Font Baixa", 35, .liquido, false),
        ("Meta", 42, .meta, false),
    ]

    private func momento(km: Double, margen: Int) -> (DatosDeTramo, DatosGlobales) {
        let ahora = Date()
        let salida = ahora.addingTimeInterval(-(3 * 3600 + 42 * 60 + 15))
        let i = puntos.firstIndex { $0.1 > km + 0.05 } ?? puntos.count - 1
        let hasta = puntos[i]
        let desdeKm = i == 0 ? 0 : puntos[i - 1].1
        let desde = i == 0 ? PuntoDeCarrera(nombre: "Salida", km: 0)
            : PuntoDeCarrera(nombre: puntos[i - 1].0, km: puntos[i - 1].1, tipo: puntos[i - 1].2)
        func desnivel(_ a: Double, _ b: Double) -> (Int, Int) {
            var s = 0.0, d = 0.0, k = a
            while k < b { let e = ele(min(b, k + 0.1)) - ele(k); if e > 0 { s += e } else { d -= e }; k += 0.1 }
            return (Int(s), Int(d))
        }
        let proximoCorte = puntos.first { $0.1 > km && $0.3 }
        // El corte con el margen pedido; la llegada a meta, a 9 min/km.
        let corte = ahora.addingTimeInterval(Double(Int(((proximoCorte?.1 ?? km) - km) * 12) + margen) * 60)
        let previsionCorte = corte.addingTimeInterval(-Double(margen) * 60)
        let tramo = DatosDeTramo(
            carrera: "Matxicots 26", numero: i + 1, deTramos: puntos.count,
            desde: desde, hasta: PuntoDeCarrera(nombre: hasta.0, km: hasta.1, tipo: hasta.2),
            posicionKm: km,
            perfil: stride(from: desdeKm, through: hasta.1, by: (hasta.1 - desdeKm) / 39).map { .init(km: $0, ele: ele($0)) },
            subidaRestanteM: desnivel(km, hasta.1).0, bajadaRestanteM: desnivel(km, hasta.1).1,
            salida: salida,
            prevision: hasta.3 ? previsionCorte : ahora.addingTimeInterval((hasta.1 - km) * 12 * 60),
            corte: hasta.3 ? corte : nil)
        let global = DatosGlobales(
            totalKm: totalKm, posicionKm: km,
            perfil: stride(from: 0, through: totalKm, by: totalKm / 59).map { .init(km: $0, ele: ele($0)) },
            marcas: puntos.dropLast().map { .init(km: $0.1, tipo: $0.2, conCorte: $0.3) },
            subidaAMetaM: desnivel(km, totalKm).0, bajadaAMetaM: desnivel(km, totalKm).1,
            llegadaAMeta: ahora.addingTimeInterval((totalKm - km) * 12 * 60 + Double(margen)),
            proximoCorte: proximoCorte?.0, corte: proximoCorte == nil ? nil : corte,
            previsionAlCorte: proximoCorte == nil ? nil : previsionCorte)
        return (tramo, global)
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
        let carpeta = URL(fileURLWithPath: base).deletingLastPathComponent()
            .appendingPathComponent("carreras").appendingPathComponent("global")
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        try XCTUnwrap(img.pngData()).write(to: carpeta.appendingPathComponent("\(nombre).png"))
        print("LAMINA \(carpeta.path)/\(nombre).png")
    }

    func testPintaLaPropuesta() throws {
        let (t, g) = momento(km: 21.3, margen: 18)
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Vista de tramo, con el selector")
            caja(TarjetaTramo(datos: t, forma: .perfilGrande, selector: .tramo))
            rotulo("Vista de carrera, en el mismo momento")
            caja(TarjetaCarreraGlobal(tramo: t, global: g))
        }), "00-tramo-y-carrera")

        let a = momento(km: 6, margen: 52), b = momento(km: 21.3, margen: 18), c = momento(km: 26, margen: -8)
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Carrera · km 6 · margen holgado")
            caja(TarjetaCarreraGlobal(tramo: a.0, global: a.1))
            rotulo("Carrera · km 21,3 · margen justo")
            caja(TarjetaCarreraGlobal(tramo: b.0, global: b.1))
            rotulo("Carrera · km 26 · fuera de corte")
            caja(TarjetaCarreraGlobal(tramo: c.0, global: c.1))
        }), "01-carrera-tres-momentos")

        // Los demás: los de alrededor y el primero.
        let otros = DatosCorredores(posicion: 34, de: 120, actualizado: Date().addingTimeInterval(-120), corredores: [
            .init(km: 31.2, emoji: "🦅", nombre: "Aitor", lider: true),
            .init(km: 23.9, emoji: "🐐", nombre: "Nerea"),
            .init(km: 22.4, emoji: "🐺", nombre: "Pau"),
            .init(km: 21.7, emoji: "🦊", nombre: "Marta"),
            .init(km: 21.0, emoji: "🐢", nombre: "Jon"),
            .init(km: 20.2, emoji: "🦔", nombre: "Laia"),
            .init(km: 19.1, emoji: "🐻", nombre: "Iker"),
        ])
        let ahora = Date()
        var antes = momento(km: 0, margen: 40)
        antes.0.salida = ahora.addingTimeInterval(25 * 60 + 12)
        antes.1.llegadaAMeta = ahora.addingTimeInterval(25 * 60 + 42 * 12 * 60)
        // La zona de alrededor: 4 km por detrás y 4 por delante, con más detalle.
        var ventana = b.1
        ventana.inicioKm = b.1.posicionKm - 4
        ventana.totalKm = b.1.posicionKm + 4
        ventana.perfil = stride(from: ventana.inicioKm, through: ventana.totalKm, by: 8.0 / 39).map { .init(km: $0, ele: ele($0)) }
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Corredores · 34.º de 120: la zona de alrededor y el primero")
            caja(TarjetaCarreraGlobal(tramo: b.0, global: b.1, corredores: otros, ventana: ventana))
            rotulo("Carrera · antes de la salida: cuenta atrás")
            caja(TarjetaCarreraGlobal(tramo: antes.0, global: antes.1, ahora: ahora))
        }), "03-corredores-y-antes-de-salir")

        let d = momento(km: 33, margen: 0)
        try pinta(sobreFondo(VStack(spacing: 12) {
            rotulo("Carrera · km 33 · sin más cortes por delante")
            caja(TarjetaCarreraGlobal(tramo: d.0, global: d.1))
        }), "02-sin-mas-cortes")
    }

    /// Las dos caben en los 160 puntos de la pantalla de bloqueo.
    func testCabenEnElAlto() {
        let (t, g) = momento(km: 21.3, margen: 18)
        for letra in [DynamicTypeSize.large, .accessibility5] {
            let vistas: [(String, AnyView)] = [
                ("tramo", AnyView(TarjetaTramo(datos: t, forma: .perfilGrande, selector: .tramo))),
                ("carrera", AnyView(TarjetaCarreraGlobal(tramo: t, global: g))),
                ("corredores", AnyView(TarjetaCarreraGlobal(tramo: t, global: g, corredores: DatosCorredores(
                    posicion: 34, de: 120, actualizado: Date(), corredores: [
                        .init(km: 22, emoji: "🦊", nombre: "Marta Garcia"), .init(km: 20, emoji: "🐢", nombre: "Jon Etxeberria"),
                    ])))),
            ]
            for (nombre, v) in vistas {
                let host = UIHostingController(rootView: v.environment(\.dynamicTypeSize, letra))
                let h = host.sizeThatFits(in: CGSize(width: 361, height: 1000)).height
                print("ALTO \(nombre) \(letra) \(Int(h))")
                XCTAssertLessThanOrEqual(h, 160, "\(nombre) mide \(h)")
            }
        }
    }
}
