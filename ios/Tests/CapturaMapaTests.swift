import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// No es una prueba: abre el mapa de la baliza en la ventana de la app y lo
/// deja 25 s a la vista para capturar la pantalla del simulador desde fuera.
/// Solo corre si se pide (`CAPTURA_MAPA=1`).
@MainActor
final class CapturaMapaTests: XCTestCase {
    func testAbreElMapaParaCapturar() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["CAPTURA_MAPA"] == "1")
        let url = URL(string: "https://silosenosalgo.themakercrowd.com/?demo=canfranc-2026&baliza=Soriano&en=2026-09-12T10:00")!
        let vista = LiveMapView(source: .online(url: url), offlineToken: "captura", allowsEditing: true, title: "Guía de prueba")
        let ventana = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first }.first!
        ventana.rootViewController = UIHostingController(rootView: vista)
        ventana.makeKeyAndVisible()
        try await Task.sleep(nanoseconds: 25_000_000_000)
    }
}
