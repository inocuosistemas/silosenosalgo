import SwiftUI
import CoreLocation

struct TrackingView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var store: TrackingStore
    @State private var title = ""
    @State private var pendingDelete: TrackSessionSummary?

    init(token: String) {
        _store = StateObject(wrappedValue: TrackingStore(token: token))
    }

    private let intervalSteps: [Double] = [5, 10, 15, 30, 60, 120, 180, 300, 600]
    private let distanceSteps: [Double] = [25, 50, 100, 250, 500]

    /// Maps the linear slider position (0…n) to/from the chosen interval.
    private var intervalIndexBinding: Binding<Double> {
        Binding(
            get: { Double(intervalSteps.firstIndex(of: store.intervalSeconds) ?? 2) },
            set: { store.intervalSeconds = intervalSteps[min(intervalSteps.count - 1, max(0, Int($0.rounded())))] }
        )
    }

    private var distanceIndexBinding: Binding<Double> {
        Binding(
            get: { Double(distanceSteps.firstIndex(of: store.distanceMeters) ?? 2) },
            set: { store.distanceMeters = distanceSteps[min(distanceSteps.count - 1, max(0, Int($0.rounded())))] }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if store.isSharing {
                        Label("Compartiendo en directo", systemImage: "dot.radiowaves.left.and.right")
                            .foregroundStyle(.green)
                    } else {
                        Label("Detenido", systemImage: "pause.circle")
                            .foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                Section {
                    if !store.isSharing {
                        TextField("Nombre (opcional)", text: $title)
                    }
                    Picker("Enviar", selection: $store.sendMode) {
                        Text("Por tiempo").tag(SendMode.time)
                        Text("Por distancia").tag(SendMode.distance)
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 6) {
                        if store.sendMode == .time {
                            HStack {
                                Text("Cada \(intervalLabel(store.intervalSeconds))").fontWeight(.semibold)
                                Spacer()
                                Text(batteryLabel(store.intervalSeconds))
                                    .font(.caption).fontWeight(.semibold)
                                    .foregroundStyle(batteryColor(store.intervalSeconds))
                            }
                            Slider(value: intervalIndexBinding, in: 0...Double(intervalSteps.count - 1), step: 1)
                        } else {
                            HStack {
                                Text("Cada \(distanceLabel(store.distanceMeters))").fontWeight(.semibold)
                                Spacer()
                                Text(batteryLabelDist(store.distanceMeters))
                                    .font(.caption).fontWeight(.semibold)
                                    .foregroundStyle(batteryColorDist(store.distanceMeters))
                            }
                            Slider(value: distanceIndexBinding, in: 0...Double(distanceSteps.count - 1), step: 1)
                        }
                        HStack {
                            Text("Más precisión").font(.caption2).foregroundStyle(Theme.slate400)
                            Spacer()
                            Text("Más batería").font(.caption2).foregroundStyle(Theme.slate400)
                        }
                        if store.sendMode == .distance {
                            Text("Parado, igualmente se emite cada pocos minutos para que no parezcas sin señal.")
                                .font(.caption).foregroundStyle(Theme.slate400)
                        } else if store.intervalSeconds >= 180 {
                            Text("GPS menos preciso para ahorrar batería. Ideal para ultras.")
                                .font(.caption).foregroundStyle(Theme.slate400)
                        }
                    }
                    .padding(.vertical, 4)
                    Picker("Conservar al finalizar", selection: $store.retainHours) {
                        Text("6 h").tag(6.0)
                        Text("12 h").tag(12.0)
                        Text("24 h").tag(24.0)
                        Text("48 h").tag(48.0)
                        Text("72 h").tag(72.0)
                        Text("1 semana").tag(168.0)
                    }
                } header: {
                    Text("Ajustes").foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                if !store.isSharing {
                    Section {
                        Picker("Ruta (previsión)", selection: $store.selectedPlanId) {
                            Text("Sin ruta · trazado en vivo").tag(String?.none)
                            ForEach(store.plans) { plan in
                                Text(plan.name).tag(Optional(plan.id))
                            }
                        }
                        if store.selectedPlanId != nil {
                            Text("Tus seguidores verán la ruta planificada y tu progreso.")
                                .font(.caption)
                                .foregroundStyle(Theme.slate400)
                        }
                    } header: {
                        Text("Ruta").foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if !store.isSharing {
                    Section {
                        if store.sessions.isEmpty {
                            Text("No tienes seguimientos.")
                                .font(.caption)
                                .foregroundStyle(Theme.slate400)
                        } else {
                            ForEach(store.sessions) { session in
                                sessionRow(session)
                            }
                        }
                    } header: {
                        Text("Mis seguimientos").foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if store.isSharing, let link = store.shareLink {
                    Section {
                        Text(link)
                            .font(.footnote)
                            .foregroundStyle(Theme.slate400)
                            .textSelection(.enabled)
                        ShareLink("Compartir enlace", item: link)
                            .foregroundStyle(Theme.sky500)
                    } header: {
                        Text("Enlace para compartir").foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)

                    Section {
                        LabeledContent("Posiciones enviadas", value: "\(store.pingCount)")
                        if let last = store.lastSentAt {
                            LabeledContent("Último envío", value: last.formatted(date: .omitted, time: .standard))
                        }
                        if let loc = store.lastLocation, loc.horizontalAccuracy >= 0 {
                            LabeledContent("Precisión GPS", value: String(format: "± %.0f m", loc.horizontalAccuracy))
                        }
                        if store.pendingCount > 0 {
                            LabeledContent("En cola (sin cobertura)", value: "\(store.pendingCount)")
                                .foregroundStyle(.orange)
                        }
                    } header: {
                        Text("Estado").foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if let err = store.lastError {
                    Section {
                        Text(err).foregroundStyle(.red).font(.footnote)
                    }
                    .listRowBackground(Theme.slate900)
                }

                if store.authStatus == .authorizedWhenInUse {
                    Section {
                        Text("Tienes permiso \"Mientras se usa\". Para seguir compartiendo con la pantalla apagada, cambia a \"Siempre\" en Ajustes → SiLoSeNoSalgo → Ubicación.")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                    .listRowBackground(Theme.slate900)
                } else if store.authStatus == .denied || store.authStatus == .restricted {
                    Section {
                        Text("El permiso de ubicación está desactivado. Actívalo en Ajustes → SiLoSeNoSalgo → Ubicación.")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(Theme.slate900)
                }

                Section {
                    Text("Mantén la app abierta (puede ser en segundo plano) con el indicador de ubicación activo. iOS detiene el GPS si cierras la app por completo.")
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                Section {
                    Button {
                        Task {
                            if store.isSharing {
                                await store.stopSharing()
                            } else {
                                await store.startSharing(title: title.trimmingCharacters(in: .whitespaces).isEmpty ? nil : title)
                            }
                        }
                    } label: {
                        Text(store.isSharing ? "Dejar de compartir" : "Compartir mi ubicación")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .background(store.isSharing ? Color.red.opacity(0.85) : Theme.sky600)
                    .foregroundStyle(.white)
                    .cornerRadius(12)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                    if !store.isSharing {
                        Text("Al iniciar uno nuevo, el seguimiento anterior se conserva 24 h para poder consultarlo.")
                            .font(.caption)
                            .foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Color.clear)
            }
            .alert("Eliminar seguimiento", isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ), presenting: pendingDelete) { session in
                Button("Eliminar", role: .destructive) {
                    pendingDelete = nil
                    Task { await store.deleteSession(session.id) }
                }
                Button("Cancelar", role: .cancel) { pendingDelete = nil }
            } message: { session in
                Text("Se borrará por completo \"\(session.title ?? "Sin nombre")\". Esta acción no se puede deshacer.")
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .tint(Theme.sky500)
            .task {
                await store.loadPlans()
                await store.loadSessions()
            }
            .navigationTitle(auth.user?.username ?? "Seguimiento")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Salir") {
                        Task {
                            await store.stopSharing()
                            await auth.logout()
                        }
                    }
                    .tint(Theme.sky500)
                }
            }
        }
    }

    @ViewBuilder
    private func sessionRow(_ session: TrackSessionSummary) -> some View {
        let active = store.isActive(session)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title ?? "Sin nombre")
                    .foregroundStyle(Theme.slate100)
                HStack(spacing: 8) {
                    Text(active ? "Activo" : "Finalizado")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background((active ? Color.green : Theme.slate700).opacity(0.25))
                        .foregroundStyle(active ? .green : Theme.slate400)
                        .clipShape(Capsule())
                    Text(startedLabel(session.startedAt))
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                }
            }
            Spacer(minLength: 8)
            if active {
                Button("Continuar") { store.continueSession(session.id) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.sky500)
            }
            Button {
                pendingDelete = session
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.red)
        }
    }

    /// Formats an epoch-MILLISECONDS instant as a short relative time
    /// (e.g. "hace 5 min"), falling back to HH:MM for older sessions.
    private func startedLabel(_ epochMs: Double) -> String {
        let date = Date(timeIntervalSince1970: epochMs / 1000)
        if Date().timeIntervalSince(date) < 24 * 3600 {
            return date.formatted(.relative(presentation: .named))
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func intervalLabel(_ s: Double) -> String {
        if s < 60 { return "\(Int(s)) s" }
        if s < 3600 { return "\(Int(s / 60)) min" }
        return "\(Int(s / 3600)) h"
    }

    private func batteryLabel(_ s: Double) -> String {
        if s <= 15 { return "Consumo alto" }
        if s <= 120 { return "Consumo medio" }
        return "Ahorro batería"
    }

    private func batteryColor(_ s: Double) -> Color {
        if s <= 15 { return .orange }
        if s <= 120 { return .yellow }
        return .green
    }

    private func distanceLabel(_ m: Double) -> String {
        m < 1000 ? "\(Int(m)) m" : String(format: "%.1f km", m / 1000)
    }

    private func batteryLabelDist(_ m: Double) -> String {
        if m <= 50 { return "Consumo alto" }
        if m <= 250 { return "Consumo medio" }
        return "Ahorro batería"
    }

    private func batteryColorDist(_ m: Double) -> Color {
        if m <= 50 { return .orange }
        if m <= 250 { return .yellow }
        return .green
    }
}
