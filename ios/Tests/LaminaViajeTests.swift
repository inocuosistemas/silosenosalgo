import XCTest
import SwiftUI
import CoreLocation
@testable import SiLoSeNoSalgo

/**
 La propuesta del viaje en directo, pintada con las vistas DE VERDAD en una
 sola lámina: lo que se aprueba aquí es exactamente lo que luego sale en la
 pantalla de bloqueo, no un dibujo aparte.

 Escribe la lámina en la carpeta que diga `LAMINA_VIAJE` (si no, al temporal).
 */
@MainActor
final class LaminaViajeTests: XCTestCase {
    private let bcn = LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.2974, longitud: 2.0833)
    private let nrt = LugarDeViaje(nombre: "Tokio", abreviatura: "NRT", latitud: 35.7720, longitud: 140.3929)

    private let titulo = "Viaje a Japón"
    private let claro = ColoresDeViaje(fondo: "#fef3c7", trayecto: "#f43f5e")
    private let morado = ColoresDeViaje(fondo: "#3b0764", trayecto: "#f472b6", trayecto2: "#f59e0b")
    private let tituloLargo = "Viaje de fin de carrera a Japón con toda la cuadrilla del club"

    private func datos(_ p: Double, transporte: TransporteDeViaje = .avion,
                       llegado: Bool = false, sinSenal: Bool = false,
                       titulo: String? = nil,
                       colores: ColoresDeViaje = .porDefecto) -> DatosDeViaje {
        let total = Trayecto.km(bcn.coordenada, nrt.coordenada)
        let resta = total * (1 - p)
        return DatosDeViaje(
            titulo: titulo, origen: bcn, destino: nrt, transporte: transporte, colores: colores,
            restanteKm: resta, progreso: p,
            llegada: Calendar.current.date(bySettingHour: 14, minute: 20, second: 0, of: Date()),
            llegado: llegado, sinSenal: sinSenal,
            actualizado: Date().addingTimeInterval(-25 * 60))
    }

    /// La caja de la pantalla de bloqueo: así la recorta el sistema.
    private func bloqueo(_ v: TarjetaViaje) -> some View {
        v.frame(width: 361)
            .background(Color(hexContador: v.datos.colores.fondo))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func rotulo(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1)
            .foregroundStyle(.white.opacity(0.55))
            .frame(width: 361, alignment: .leading)
    }

    private var lamina: some View {
        VStack(spacing: 14) {
            rotulo("A · recién despegado")
            bloqueo(TarjetaViaje(datos: datos(0.12)))
            rotulo("A · a medio camino")
            bloqueo(TarjetaViaje(datos: datos(0.58)))
            rotulo("A · sin señal GPS")
            bloqueo(TarjetaViaje(datos: datos(0.74, sinSenal: true)))
            rotulo("A · llegado")
            bloqueo(TarjetaViaje(datos: datos(1, llegado: true)))
            rotulo("B · más apretada, a medio camino")
            bloqueo(TarjetaViaje(datos: datos(0.58), variante: .b))
            rotulo("A · con título")
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo)))
            rotulo("B · con título")
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo), variante: .b))
            rotulo("A · con un título demasiado largo")
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: tituloLargo)))

            rotulo("Isla Dinámica · recogida y mínima")
            HStack(spacing: 14) {
                HStack {
                    IslaViajeInicio(datos: datos(0.58))
                    Spacer()
                    IslaViajeFin(datos: datos(0.58))
                }
                .padding(.horizontal, 14)
                .frame(width: 250, height: 37)
                .background(Capsule().fill(.black))
                IslaViajeMinima(datos: datos(0.58))
                    .frame(width: 37, height: 37)
                    .background(Circle().fill(.black))
                Spacer()
            }
            .frame(width: 361)

            rotulo("Isla Dinámica · abierta, con título")
            IslaViajeAbierta(datos: datos(0.58, titulo: titulo))
                .padding(.horizontal, 22).padding(.vertical, 16)
                .frame(width: 371)
                .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))

            rotulo("Colores elegidos · fondo claro, trayecto de uno")
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo, colores: claro)))
            rotulo("Colores elegidos · fondo morado, degradado rosa → ámbar")
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo, colores: morado)))
            rotulo("Isla Dinámica con esos colores: el fondo sigue negro")
            IslaViajeAbierta(datos: datos(0.58, colores: claro))
                .padding(.horizontal, 22).padding(.vertical, 16)
                .frame(width: 371)
                .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))

            rotulo("Los medios de transporte")
            VStack(spacing: 6) {
                ForEach(TransporteDeViaje.allCases, id: \.self) { t in
                    HStack {
                        Text(t.nombre).font(.caption).foregroundStyle(.white.opacity(0.7))
                            .frame(width: 60, alignment: .leading)
                        BarraDeViaje(progreso: 0.5, transporte: t,
                                     pintura: PinturaDeViaje(.porDefecto), chapa: 22)
                    }
                }
            }
            .padding(12)
            .frame(width: 361)
            .background(Color(hexContador: ColoresDeViaje.porDefecto.fondo))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    /// El fondo de una pantalla de bloqueo cualquiera, para ver cada pieza
    /// donde va a vivir y no sobre blanco.
    private func sobreFondo<V: View>(_ v: V) -> some View {
        v.padding(24)
            .background(
                LinearGradient(colors: [Color(red: 0.18, green: 0.2, blue: 0.32), Color(red: 0.05, green: 0.05, blue: 0.1)],
                               startPoint: .top, endPoint: .bottom)
            )
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: "es_ES"))
    }

    /// Pinta una vista a PNG, a doble densidad como en el móvil.
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
        // Color normal de 8 bits: el ampliado del simulador sale a 16 por canal
        // y la lámina pesaba casi 5 MB sin verse mejor.
        fmt.preferredRange = .standard
        let img = UIGraphicsImageRenderer(bounds: host.view.bounds, format: fmt).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let carpeta = ProcessInfo.processInfo.environment["LAMINA_VIAJE"] ?? NSTemporaryDirectory()
        let destino = URL(fileURLWithPath: carpeta).appendingPathComponent("\(nombre).png")
        try XCTUnwrap(img.pngData()).write(to: destino)
        print("LAMINA \(destino.path) \(Int(tam.width))x\(Int(tam.height))")
    }

    func testPintaLaLamina() throws {
        try pinta(sobreFondo(lamina), "00-lamina-completa")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.12)))), "01-a-recien-despegado")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.58)))), "02-a-medio-camino")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.74, sinSenal: true)))), "03-a-sin-senal")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(1, llegado: true)))), "04-a-llegado")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.58), variante: .b))), "05-b-medio-camino")
        try pinta(sobreFondo(VStack(spacing: 14) {
            bloqueo(TarjetaViaje(datos: datos(0.58)))
            bloqueo(TarjetaViaje(datos: datos(0.58), variante: .b))
        }), "06-a-contra-b")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo)))), "07-a-con-titulo")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo), variante: .b))), "08-b-con-titulo")
        try pinta(sobreFondo(bloqueo(TarjetaViaje(datos: datos(0.58, titulo: tituloLargo)))), "09-a-titulo-largo")
        try pinta(sobreFondo(VStack(spacing: 14) {
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo, colores: claro)))
            bloqueo(TarjetaViaje(datos: datos(0.58, titulo: titulo, colores: morado)))
        }), "10-colores-elegidos")
    }

    /// Lo que mide la tarjeta a lo alto, al ancho de la pantalla de bloqueo.
    private func alto(_ d: DatosDeViaje, _ v: TarjetaViaje.Variante,
                      letra: DynamicTypeSize = .large) -> CGFloat {
        let host = UIHostingController(rootView: TarjetaViaje(datos: d, variante: v)
            .environment(\.dynamicTypeSize, letra)
            .environment(\.locale, Locale(identifier: "es_ES")))
        return host.sizeThatFits(in: CGSize(width: 361, height: 1000)).height
    }

    /// El sistema recorta la tarjeta de la pantalla de bloqueo a 160 puntos de
    /// alto. Con el título se añade una línea, y sin apretar el resto no cabía:
    /// se cortaba por abajo, justo donde van los kilómetros.
    func testCabeEnElAltoQueDejaElSistema() {
        for v in [TarjetaViaje.Variante.a, .b] {
            for t in [nil, titulo, tituloLargo] {
                for d in [datos(0.58, titulo: t), datos(0.74, sinSenal: true, titulo: t),
                          datos(1, llegado: true, titulo: t)] {
                    let h = alto(d, v)
                    XCTAssertLessThanOrEqual(h, 160, "la variante \(v) con título \(t ?? "-") mide \(h)")
                    // Y con la letra más grande de accesibilidad, igual.
                    let grande = alto(d, v, letra: .accessibility5)
                    XCTAssertLessThanOrEqual(grande, 160,
                        "con letra de accesibilidad, la variante \(v) mide \(grande)")
                    print("ALTO \(v) titulo=\(t == nil ? "no" : "si") \(Int(h))")
                }
            }
        }
    }

    /// Barcelona–Tokio por la superficie de la Tierra: unos 10.400 km.
    func testLaDistanciaEsLaDeVerdad() {
        let km = Trayecto.km(bcn.coordenada, nrt.coordenada)
        XCTAssertEqual(km, 10_400, accuracy: 150)
        // Madrid–Barcelona, que se sabe de memoria: unos 505 km.
        let mad = CLLocationCoordinate2D(latitude: 40.4168, longitude: -3.7038)
        let bar = CLLocationCoordinate2D(latitude: 41.3874, longitude: 2.1686)
        XCTAssertEqual(Trayecto.km(mad, bar), 505, accuracy: 5)
    }

    /// El punto de los millares sale siempre, sea cual sea el idioma del móvil.
    func testLosKilometrosSeEscribenSiempreIgual() {
        XCTAssertEqual(ColoresViaje.km(4389.4), "4.389")
        XCTAssertEqual(ColoresViaje.km(10_437), "10.437")
        XCTAssertEqual(ColoresViaje.km(7.25), "7,2")
    }

    /// Antes de salir puede quedar más que el total: eso es cero, no negativo.
    func testElProgresoNoSeSaleDeSusLimites() {
        XCTAssertEqual(Trayecto.progreso(restante: 10_500, total: 10_400), 0)
        XCTAssertEqual(Trayecto.progreso(restante: 5_200, total: 10_400), 0.5, accuracy: 0.001)
        XCTAssertEqual(Trayecto.progreso(restante: -1, total: 10_400), 1)
    }
}
