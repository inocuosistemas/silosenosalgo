import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 Una pantalla abierta no puede cerrarse sola porque cambie la lista de detrás.

 Viene de que «Cuenta atrás y widget» se abría y volvía enseguida a la
 pantalla principal. El destino de navegación colgaba de la FILA que lo abre, y
 esa fila cambia de sección en cuanto terminan de cargar las carreras; ahora
 cuelga de la lista, que está siempre.

 Aviso honesto sobre el alcance: colgarla de la fila NO reproduce aquí la
 caída —se intentó y la pantalla aguantaba—, así que esto no demuestra cuál
 era la causa. Lo que sí deja clavado es la condición que tiene que cumplirse
 pase lo que pase: una pantalla abierta sobrevive a que la lista de detrás
 cambie de secciones.
 */
@MainActor
final class NavegacionQueSeCaeTests: XCTestCase {
    /// Lo que decide si la fila está o no, como lo decide de verdad que haya
    /// carreras cargadas.
    private final class Estado: ObservableObject {
        @Published var hayCarreras = false
        @Published var abierta = false
    }

    /// El detalle avisa de cuándo lo quitan de en medio.
    private struct Detalle: View {
        let alIrse: () -> Void
        var body: some View {
            Text("cuenta atrás").onDisappear(perform: alIrse)
        }
    }

    private struct Pantalla: View {
        @ObservedObject var estado: Estado
        /// Dónde se cuelga el destino: de la fila (como estaba) o de la lista.
        let enLaFila: Bool
        let alIrse: () -> Void

        var body: some View {
            NavigationStack {
                List {
                    if !estado.hayCarreras {
                        fila.listRowBackground(Color.clear)
                    }
                    if estado.hayCarreras {
                        Text("Mis carreras")
                        fila.listRowBackground(Color.clear)
                    }
                }
                .navigationDestination(isPresented: enLaFila ? .constant(false) : $estado.abierta) {
                    Detalle(alIrse: alIrse)
                }
            }
        }

        @ViewBuilder
        private var fila: some View {
            let f = Button("Cuenta atrás") { estado.abierta = true }
            if enLaFila {
                f.navigationDestination(isPresented: $estado.abierta) { Detalle(alIrse: alIrse) }
            } else {
                f
            }
        }
    }

    /// Abre el detalle, hace aparecer las carreras y dice si el detalle se cayó.
    private func seCaeAlCargarLasCarreras(enLaFila: Bool) -> Bool {
        let estado = Estado()
        var sefue = false
        let host = UIHostingController(
            rootView: Pantalla(estado: estado, enLaFila: enLaFila, alIrse: { sefue = true }))
        host.view.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        let v = UIWindow(frame: host.view.frame)
        v.rootViewController = host
        v.isHidden = false
        v.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))

        estado.abierta = true                     // se entra en la pantalla
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        sefue = false                             // desde aquí, lo que cuente
        estado.hayCarreras = true                 // terminan de cargar las carreras
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        return sefue || !estado.abierta
    }

    /// Y así aguanta: colgando de la lista, que está siempre.
    func testColgadaDeLaListaAguanta() {
        XCTAssertFalse(seCaeAlCargarLasCarreras(enLaFila: false),
                       "la pantalla abierta tiene que sobrevivir a que cambie la lista")
    }
}
