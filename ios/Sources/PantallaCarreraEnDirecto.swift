import SwiftUI

/**
 La tarjeta de carrera con una RUTA propia (ver `CarreraConTrazado`): elegir la
 ruta y la hora de salida, verla simulada y empezarla; y, en marcha, cómo va y
 terminarla. Se entra desde la pantalla principal y al tocar la tarjeta.

 La de una carrera no se empieza aquí: va con su baliza. Si es esa la que está
 en marcha, aquí se dice, y se termina al parar la baliza.
 */
struct PantallaCarreraEnDirecto: View {
    @ObservedObject private var tracking = TrackingStore.shared
    @ObservedObject private var trazado = CarreraConTrazado.shared
    @ObservedObject private var carrera = CarreraEnDirecto.shared

    @State private var planId: String?
    @State private var cuando = Cuando.ahora
    @State private var hora = Date().addingTimeInterval(3600)

    enum Cuando: Hashable { case ahora, aUnaHora }

    private let fondo = Color(hexContador: "#0f1729")

    private var plan: PlanSummary? { tracking.plans.first { $0.id == planId } }
    private var salida: Date { cuando == .ahora ? Date() : hora }

    var body: some View {
        List {
            if trazado.enMarcha {
                enMarcha
            } else if carrera.enMarcha && carrera.origen == .baliza {
                deLaBaliza
            } else {
                formulario
            }
        }
        .navigationTitle("Carrera en directo")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        .onAppear {
            if planId == nil { planId = tracking.plans.first?.id }
        }
        .alert("Carrera en directo", isPresented: Binding(
            get: { trazado.error != nil }, set: { if !$0 { trazado.error = nil } }
        )) {
            Button("Aceptar", role: .cancel) { trazado.error = nil }
        } message: {
            Text(trazado.error ?? "")
        }
    }

    // MARK: En marcha

    @ViewBuilder
    private var tarjetaViva: some View {
        if let e = carrera.estadoActual {
            Section {
                TarjetaDeCarrera(estado: e)
                    .background(fondo)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } header: {
                Text("EN LA PANTALLA DE BLOQUEO").font(.caption).foregroundStyle(Theme.slate400)
            }
        }
    }

    @ViewBuilder
    private var enMarcha: some View {
        tarjetaViva
        Section {
            LabeledContent("Ruta") { Text(carrera.nombre).foregroundStyle(Theme.slate400) }
            let d = trazado.diagnostico
            LabeledContent("Posiciones del GPS") { Text("\(d.posiciones)").monospacedDigit() }
            if let u = d.ultima {
                LabeledContent("La última") {
                    (Text(u, style: .time) + Text(d.ultimoError.map { " · ±\(Int($0)) m" } ?? ""))
                        .monospacedDigit()
                }
            }
            if d.fueraDeRuta {
                LabeledContent("En la ruta") { Text("fuera de ella").foregroundStyle(.orange) }
            } else if let km = d.km {
                LabeledContent("En la ruta") { Text("km \(TarjetaCarreraGlobal.km(km))").monospacedDigit() }
            }
            Button(role: .destructive) {
                trazado.termina()
            } label: {
                Label("Terminar la tarjeta", systemImage: "stop.fill")
            }
            .foregroundStyle(.red)
        } header: {
            Text("EN MARCHA").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Sigue tu posición con el GPS, sin baliza y sin compartirla con nadie. Puedes cerrar la app: la tarjeta sigue. En meta se queda un rato con tu tiempo y se va sola.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }

    @ViewBuilder
    private var deLaBaliza: some View {
        tarjetaViva
        Section {
            Label("Va con la baliza de \(carrera.nombre)", systemImage: "dot.radiowaves.left.and.right")
        } footer: {
            Text("La tarjeta de una carrera empieza y se termina con su baliza. Para usar aquí una ruta tuya, para antes la baliza.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }

    // MARK: Formulario

    @ViewBuilder
    private var formulario: some View {
        Section {
            if tracking.plans.isEmpty {
                Text("No tienes rutas todavía. Créala en la web, o carga un GPX desde la baliza.")
                    .font(.footnote).foregroundStyle(Theme.slate400)
            } else {
                Picker("Ruta", selection: $planId) {
                    ForEach(tracking.plans) { p in
                        Text(p.name).tag(Optional(p.id))
                    }
                }
                if let p = plan, let km = p.distanceKm {
                    LabeledContent("Distancia") { Text("\(TarjetaCarreraGlobal.km(km)) km").monospacedDigit() }
                }
            }
        } header: {
            Text("RUTA").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Una de tus rutas, sin carrera. Los tramos van de punto a punto de la ruta; si tiene controles con hora de corte, también dice el margen. No hay vista de corredores: nadie más va por ella.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            Picker("Salida", selection: $cuando) {
                Text("Ahora").tag(Cuando.ahora)
                Text("A una hora").tag(Cuando.aUnaHora)
            }
            .pickerStyle(.segmented)
            if cuando == .aUnaHora {
                DatePicker("Hora de salida", selection: $hora)
            }
        } header: {
            Text("SALIDA").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Con hora, la tarjeta hace la cuenta atrás hasta entonces. La previsión de paso sale del plan de la ruta, contando desde la salida.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            if let p = plan {
                NavigationLink {
                    PantallaCarreraSimulada(plan: p, salida: salida)
                } label: {
                    Label("Ver cómo se verá", systemImage: "play.rectangle")
                }
            }
            Button {
                guard let p = plan else { return }
                Task { await trazado.empieza(plan: p, salida: salida, token: tracking.token) }
            } label: {
                HStack {
                    if trazado.preparando { ProgressView().padding(.trailing, 4) }
                    Label(trazado.preparando ? "Preparando la ruta…" : "Empezar",
                          systemImage: "play.fill")
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(plan == nil || trazado.preparando)
        } footer: {
            Text("Hace falta cobertura para empezar (se baja la ruta); después, no.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }
}
