import SwiftUI

/**
 La tarjeta de la carrera en directo, SIMULADA: un deslizador de tiempo que
 recorre la carrera entera —de la cuenta atrás a la meta— y la tarjeta tal
 como se vería en la pantalla de bloqueo en cada momento.

 Los botones del selector funcionan de verdad (Tramo · Carrera · 👥), y el
 botón de reproducir avanza la carrera deprisa, pasando por todos los tramos.
 El ritmo cambia cómo de rápido va el corredor respecto al plan, y con él el
 margen a los cortes: así se ve también el verde, el ámbar y el rojo.

 Se puede simular la carrera de ejemplo o una de las propias (con su recorrido,
 sus puntos y sus cortes de verdad; la hoja la calcula la web, como en carrera).
 */
struct PantallaCarreraSimulada: View {
    @ObservedObject private var tracking = TrackingStore.shared

    /// La carrera de la que se abre, desde su menú: sin elegir otra.
    var evento: EventSummary?
    /// O una ruta propia con su hora de salida, desde la tarjeta con ruta
    /// (ver `CarreraConTrazado`): sin corredores.
    var plan: PlanSummary?
    var salidaDelPlan: Date?

    @State private var fuente: String

    init(evento: EventSummary? = nil) {
        self.evento = evento
        _fuente = State(initialValue: evento?.id ?? "ejemplo")
    }

    init(plan: PlanSummary, salida: Date) {
        self.plan = plan
        self.salidaDelPlan = salida
        _fuente = State(initialValue: "plan-" + plan.id)
    }
    @State private var sim: SimulacionDeCarrera?
    @State private var cargando = false
    @State private var error: String?
    @State private var reproduciendo = false

    private let fondo = Color(hexContador: "#0f1729")

    /// Las carreras propias que tienen recorrido publicado.
    private var carreras: [EventSummary] {
        tracking.events.filter { $0.planShareId != nil && $0.endedAt == nil }
    }

    var body: some View {
        List {
            Section {
                tarjeta
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } header: {
                Text("EN LA PANTALLA DE BLOQUEO").font(.caption).foregroundStyle(Theme.slate400)
            } footer: {
                Text(plan != nil
                     ? "Los botones de arriba cambian de vista, como en la tarjeta de verdad. Lo demás es una simulación: vas según el plan de la ruta al ritmo elegido."
                     : "Los botones de arriba cambian de vista, como en la tarjeta de verdad. Lo demás es una simulación: el corredor sigue el plan de la carrera al ritmo elegido, y los demás corredores son inventados.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }

            if sim != nil { controles }

            if evento == nil && plan == nil {
            Section {
                Picker("Carrera", selection: $fuente) {
                    Text("Trail 42K (ejemplo)").tag("ejemplo")
                    ForEach(carreras) { ev in Text(ev.name).tag(ev.id) }
                }
                if cargando {
                    HStack { ProgressView(); Text("Preparando la carrera…").foregroundStyle(Theme.slate400) }
                }
                if let error {
                    Text(error).font(.caption).foregroundStyle(.orange)
                }
            } header: {
                Text("QUÉ CARRERA").font(.caption).foregroundStyle(Theme.slate400)
            }
            .listRowBackground(Theme.slate900)
            } else {
                if cargando {
                    HStack { ProgressView(); Text("Preparando la carrera…").foregroundStyle(Theme.slate400) }
                        .listRowBackground(Theme.slate900)
                }
                if let error {
                    Text(error).font(.caption).foregroundStyle(.orange)
                        .listRowBackground(Theme.slate900)
                }
            }
        }
        .navigationTitle(evento?.name ?? plan?.name ?? "Carrera en directo")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        .task(id: fuente) { await carga() }
        // La reproducción: la carrera entera en unos 30 segundos.
        .task(id: reproduciendo) {
            while reproduciendo, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard var s = sim else { break }
                let paso = (s.rango.upperBound - s.rango.lowerBound) / 600
                s.minuto = min(s.rango.upperBound, s.minuto + paso)
                sim = s
                if s.minuto >= s.rango.upperBound { reproduciendo = false }
            }
        }
    }

    @ViewBuilder
    private var tarjeta: some View {
        if let sim, let estado = sim.estado {
            TarjetaDeCarrera(estado: estado, ahoraVirtual: sim.ahora) { v in
                self.sim?.vistaElegida = v
            }
            .background(fondo)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(fondo)
                .frame(height: 150)
                .overlay(ProgressView())
        }
    }

    private var controles: some View {
        Section {
            if let s = sim {
                HStack(spacing: 12) {
                    Button {
                        if s.minuto >= s.rango.upperBound { sim?.minuto = s.rango.lowerBound }
                        reproduciendo.toggle()
                    } label: {
                        Image(systemName: reproduciendo ? "pause.fill" : "play.fill")
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(Theme.sky600))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(reproduciendo ? "Pausar" : "Reproducir")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(momento(s)).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text("km \(TarjetaCarreraGlobal.km(s.km)) de \(TarjetaCarreraGlobal.km(s.hoja.totalKm))")
                            .font(.caption).foregroundStyle(Theme.slate400).monospacedDigit()
                    }
                    Spacer()
                }
                // El tiempo virtual: lo manda el deslizador.
                Slider(value: Binding(
                    get: { s.minuto },
                    set: { reproduciendo = false; sim?.minuto = $0 }
                ), in: s.rango)
                .accessibilityIdentifier("tiempoDeLaSimulacion")

                Picker("Ritmo", selection: Binding(
                    get: { s.ritmo }, set: { sim?.ritmo = $0 }
                )) {
                    Text("Rápido").tag(0.85)
                    Text("Plan").tag(1.0)
                    Text("Lento").tag(1.2)
                    Text("Muy lento").tag(1.4)
                }
                .pickerStyle(.segmented)

                if s.vistaElegida != nil {
                    Button("Volver a la vista automática") { sim?.vistaElegida = nil }
                        .font(.footnote)
                }
            }
        } header: {
            Text("SIMULACIÓN").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("La vista automática es la de la carrera antes de la salida y la del tramo después. Elegir una a mano la fija, como en la tarjeta de verdad.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }

    private func momento(_ s: SimulacionDeCarrera) -> String {
        if s.minuto < 0 { return "Salida en \(RelojDeCarrera.duracion(-s.minuto * 60))" }
        if s.estado?.tramo.enMeta == true { return "En meta" }
        return "\(RelojDeCarrera.duracion(s.minuto * 60)) en carrera"
    }

    /// La carrera elegida: la de ejemplo, o una propia con su hoja de tramos
    /// calculada por la web (hace falta cobertura para bajar el recorrido).
    private func carga() async {
        reproduciendo = false
        error = nil
        if let plan, let salida = salidaDelPlan {
            cargando = true
            defer { cargando = false }
            do {
                let hoja = try await CarreraConTrazado.hoja(plan: plan, salida: salida, token: tracking.token)
                var s = SimulacionDeCarrera(hoja: hoja, carrera: plan.name)
                s.conCorredores = false
                sim = s
            } catch {
                self.error = "No se ha podido preparar la ruta (¿sin cobertura?)."
            }
            return
        }
        guard fuente != "ejemplo", let ev = evento ?? carreras.first(where: { $0.id == fuente }),
              let shareId = ev.planShareId
        else {
            let salida = Date().addingTimeInterval(20 * 60)
            sim = SimulacionDeCarrera(hoja: .ejemplo(salida: salida), carrera: "Trail 42K")
            return
        }
        cargando = true
        defer { cargando = false }
        do {
            let plan = try await API.fetchSharePayload(shareId: shareId)
            let ajustes = try? await API.ajustesDelEvento(token: tracking.token, eventId: ev.id)
            let web = GpxImporter()
            defer { web.suelta() }
            let datos = try await web.hojaDeTramos(planGz: plan, ajustes: ajustes, salidaMs: ev.startsAt)
            let hoja = try JSONDecoder().decode(HojaDeTramos.self, from: datos)
            sim = SimulacionDeCarrera(hoja: hoja, carrera: ev.name)
        } catch {
            self.error = "No se ha podido preparar esa carrera (¿sin cobertura?). Se enseña la de ejemplo."
            sim = SimulacionDeCarrera(hoja: .ejemplo(salida: Date().addingTimeInterval(20 * 60)),
                                      carrera: "Trail 42K")
        }
    }
}
