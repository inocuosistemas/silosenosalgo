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

    private func datos(_ p: Double, transporte: TransporteDeViaje = .avion,
                       llegado: Bool = false, sinSenal: Bool = false) -> DatosDeViaje {
        let total = Trayecto.km(bcn.coordenada, nrt.coordenada)
        let resta = total * (1 - p)
        return DatosDeViaje(
            origen: bcn, destino: nrt, transporte: transporte,
            restanteKm: resta, progreso: p,
            llegada: Calendar.current.date(bySettingHour: 14, minute: 20, second: 0, of: Date()),
            llegado: llegado, sinSenal: sinSenal,
            actualizado: Date().addingTimeInterval(-25 * 60))
    }

    /// La caja de la pantalla de bloqueo: así la recorta el sistema.
    private func bloqueo<V: View>(_ v: V) -> some View {
        v.frame(width: 361)
            .background(ColoresViaje.fondo.opacity(0.92))
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

            rotulo("Isla Dinámica · recogida y mínima")
            HStack(spacing: 14) {
                HStack {
                    IslaViajeInicio(transporte: .avion)
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

            rotulo("Isla Dinámica · abierta")
            VStack(spacing: 10) {
                HStack(alignment: .top) {
                    ExtremoDeViaje(lugar: bcn, alineado: .leading, tamano: 24)
                    Spacer()
                    ExtremoDeViaje(lugar: nrt, alineado: .trailing, tamano: 24)
                }
                BarraDeViaje(progreso: 0.58, transporte: .avion, chapa: 24)
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(ColoresViaje.km(datos(0.58).restanteKm))
                        .font(.system(size: 18, weight: .bold)).monospacedDigit()
                    Text("km").font(.caption).foregroundStyle(ColoresViaje.apagado)
                    Spacer()
                    (Text("llegada ") + Text(datos(0.58).llegada!, style: .time).bold())
                        .font(.caption).foregroundStyle(ColoresViaje.apagado)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 22).padding(.vertical, 16)
            .frame(width: 371)
            .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))

            rotulo("Los medios de transporte")
            VStack(spacing: 6) {
                ForEach(TransporteDeViaje.allCases, id: \.self) { t in
                    HStack {
                        Text(t.nombre).font(.caption).foregroundStyle(.white.opacity(0.7))
                            .frame(width: 60, alignment: .leading)
                        BarraDeViaje(progreso: 0.5, transporte: t, chapa: 22)
                    }
                }
            }
            .padding(12)
            .frame(width: 361)
            .background(ColoresViaje.fondo.opacity(0.92))
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
