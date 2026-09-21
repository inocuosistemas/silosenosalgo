import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 Que el encuadre no se pierda al repintarse la pantalla que lo abre.

 Es el fallo que se coló: la hoja de encuadre recibía una identidad NUEVA en
 cada repintado del editor, y el editor se repinta solo cada 15 s —la vista
 previa lleva la cuenta atrás corriendo—. SwiftUI, al ver otra identidad, tira
 la hoja y la crea de cero: el paneo y el zoom se iban con ella, y "Usar"
 guardaba el encuadre por defecto.

 Aquí se reproduce esa regla de identidad tal cual —una vista con `.id(...)` se
 vuelve a crear cuando el id cambia, que es lo que hace `sheet(item:)` por
 dentro— y se comprueba que con lo de antes el estado se perdía y con lo de
 ahora aguanta.
 */
@MainActor
final class HojaDeEncuadreTests: XCTestCase {
    /// Lo que se mira: cuántas veces ha APARECIDO la hoja.
    ///
    /// Aparecer y no "nacer": SwiftUI llama al `init` de una vista en cada
    /// repintado aunque le conserve el estado, así que contar inicializaciones
    /// no dice nada. Lo que solo pasa al crearla de cero —y por tanto al
    /// perder el encuadre— es `onAppear`.
    final class Testigo: ObservableObject {
        var apariciones = 0
        @Published var tic = 0
    }

    private struct Envoltorio: Identifiable {
        let id = UUID()
    }

    /// Hace de hoja de encuadre: nace con el zoom a 1 y lo sube al aparecer,
    /// como quien acerca la foto con los dedos.
    private struct Hoja: View {
        let testigo: Testigo
        @State private var escala: CGFloat = 1

        var body: some View {
            Text(String(format: "%.1f", escala))
                .onAppear {
                    testigo.apariciones += 1
                    escala = 2.5
                }
        }
    }

    /// Lo de ANTES: la identidad se fabrica al vuelo en cada repintado.
    private struct PantallaVieja: View {
        @ObservedObject var testigo: Testigo
        @State private var abierta = true

        var body: some View {
            VStack {
                Text("tic \(testigo.tic)")
                if abierta {
                    Hoja(testigo: testigo).id(Envoltorio().id)
                }
            }
        }
    }

    /// Lo de AHORA: la identidad se guarda una vez y no cambia.
    private struct PantallaNueva: View {
        @ObservedObject var testigo: Testigo
        @State private var envoltorio: Envoltorio? = Envoltorio()

        var body: some View {
            VStack {
                Text("tic \(testigo.tic)")
                if let envoltorio {
                    Hoja(testigo: testigo).id(envoltorio.id)
                }
            }
        }
    }

    /// Pinta la vista de verdad y la hace repintarse unas cuantas veces.
    private func repinta<V: View>(_ vista: V, _ testigo: Testigo, veces: Int = 4) {
        let host = UIHostingController(rootView: vista)
        host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 200)
        let ventana = UIWindow(frame: host.view.frame)
        ventana.rootViewController = host
        ventana.isHidden = false
        ventana.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        for _ in 0..<veces {
            testigo.tic += 1
            ventana.layoutIfNeeded()
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    func testAsiSePerdiaElEncuadre() {
        let testigo = Testigo()
        repinta(PantallaVieja(testigo: testigo), testigo)
        XCTAssertGreaterThan(testigo.apariciones, 1,
                             "con la identidad al vuelo, cada repintado rehacía la hoja")
    }

    func testAhoraElEncuadreAguantaLosRepintados() {
        let testigo = Testigo()
        repinta(PantallaNueva(testigo: testigo), testigo)
        XCTAssertEqual(testigo.apariciones, 1,
                       "la hoja se crea UNA vez, por mucho que el editor se repinte")
    }
}
