import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 Dónde quedan el viaje y la carrera en directo en la pantalla principal:
 «Mis carreras» con su tarjeta, la cuenta atrás y el viaje (sin viaje y con
 uno en marcha), el menú «Abrir» de la carrera, y lo que abre su «Tarjeta en
 directo». Con las piezas de verdad; el menú abierto, imitado (un menú del
 sistema no se puede pintar abierto).

 Escribe en la carpeta que diga `LAMINA_VIAJE` (si no, al temporal).
 */
@MainActor
final class LaminaEnDirectoTests: XCTestCase {
    private let ev = EventSummary(
        id: "e1", name: "Matxicots 26", planShareId: nil, planName: nil,
        startsAt: Date().addingTimeInterval(9 * 86400).timeIntervalSince1970 * 1000,
        endedAt: nil, myEmoji: "🦊", myColor: nil, activity: "run")

    private func cabecera(_ t: String, _ i: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: i).font(.caption2)
            Text(t.uppercased()).font(.caption.weight(.bold)).kerning(0.8)
        }
        .foregroundStyle(Theme.sky500)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 28)
    }

    private func misCarreras(enMarcha: Bool) -> some View {
        VStack(spacing: 12) {
            cabecera("Mis carreras", "flag.checkered")
            Group {
                TarjetaCarrera(ev: ev, cuando: TrackingView.whenLabel(ev.startsAt), hoy: false,
                               elegida: false, proxima: true, onElegir: {}) {
                    Text("Abrir").foregroundStyle(Theme.sky500)
                }
                FilaContadores(abierta: .constant(false))
                FilaViajeEnDirecto(abierta: .constant(false),
                                   muestra: enMarcha ? ("En marcha · BCN → AND · 42 km", "car.side.fill") : nil)
                FilaCarreraEnDirecto(abierta: .constant(false),
                                     muestra: enMarcha ? "En marcha · Vuelta al Montseny · Tramo 3/7" : nil)
            }
            .padding(.horizontal, 12)
        }
    }

    /// El menú «Abrir», imitado con sus entradas de verdad.
    private var menu: some View {
        let filas = WebDelEvento.secciones(de: ev).map(\.texto)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(filas, id: \.self) { t in
                Text(t).padding(.horizontal, 16).padding(.vertical, 11)
                Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5)
            }
            Rectangle().fill(.white.opacity(0.18)).frame(height: 6)
            Text("📲  Tarjeta en directo").padding(.horizontal, 16).padding(.vertical, 11)
        }
        .foregroundStyle(.white)
        .frame(width: 250, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(white: 0.17)))
    }

    private func pinta<V: View>(_ vista: V, _ nombre: String, ancho: CGFloat = 402) throws {
        let host = UIHostingController(rootView: vista
            .frame(width: ancho)
            .padding(.vertical, 20)
            .background(Theme.slate950)
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: "es_ES")))
        host.safeAreaRegions = []
        let tam = host.sizeThatFits(in: CGSize(width: ancho, height: 4000))
        host.view.frame = CGRect(origin: .zero, size: tam)
        let v = UIWindow(frame: host.view.frame)
        v.rootViewController = host
        v.isHidden = false
        v.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2
        fmt.preferredRange = .standard
        let img = UIGraphicsImageRenderer(bounds: host.view.bounds, format: fmt).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let base = ProcessInfo.processInfo.environment["LAMINA_VIAJE"] ?? NSTemporaryDirectory()
        let carpeta = URL(fileURLWithPath: base).appendingPathComponent("en-directo")
        try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        try XCTUnwrap(img.pngData()).write(to: carpeta.appendingPathComponent("\(nombre).png"))
        print("LAMINA \(carpeta.path)/\(nombre).png")
    }

    func testPintaDondeQuedan() throws {
        try pinta(VStack(spacing: 28) {
            misCarreras(enMarcha: false)
            misCarreras(enMarcha: true)
            VStack(alignment: .trailing, spacing: 8) {
                cabecera("«Abrir» de la carrera", "ellipsis.circle")
                menu.padding(.trailing, 20)
            }
        }, "01-pantalla-principal")
    }

    func testPintaLaTarjetaDeLaCarrera() throws {
        try pinta(NavigationStack {
            PantallaCarreraSimulada(evento: ev)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cerrar") {} }
                }
        }
        .frame(height: 874), "02-tarjeta-de-la-carrera")
    }
}
