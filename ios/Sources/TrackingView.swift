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
    private var modeBinding: Binding<SendMode> {
        Binding(get: { store.sendMode }, set: { store.sendMode = $0; store.profile = .custom })
    }

    private var intervalIndexBinding: Binding<Double> {
        Binding(
            get: { Double(intervalSteps.firstIndex(of: store.intervalSeconds) ?? 2) },
            set: {
                store.intervalSeconds = intervalSteps[min(intervalSteps.count - 1, max(0, Int($0.rounded())))]
                store.profile = .custom
            }
        )
    }

    private var distanceIndexBinding: Binding<Double> {
        Binding(
            get: { Double(distanceSteps.firstIndex(of: store.distanceMeters) ?? 2) },
            set: {
                store.distanceMeters = distanceSteps[min(distanceSteps.count - 1, max(0, Int($0.rounded())))]
                store.profile = .custom
            }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    statusContent
                }
                .listRowBackground(Theme.slate900)

                Section {
                    if !store.isSharing {
                        TextField("Nombre (opcional)", text: $title)
                    }
                    profileRow(.balanced, title: "Equilibrado",
                               detail: "Por distancia (~100 m). Buena precisión y batería.",
                               autonomy: "Buena autonomía", color: .green, recommended: true)
                    profileRow(.saver, title: "Ahorro · ultra",
                               detail: "Por distancia (~500 m). Parado no gasta batería.",
                               autonomy: "Máxima autonomía", color: .green)
                    profileRow(.precision, title: "Alta precisión",
                               detail: "Por tiempo (cada 10 s). Máximo detalle.",
                               autonomy: "Menor autonomía", color: .orange)

                    DisclosureGroup("Avanzado") {
                        Picker("Enviar", selection: modeBinding) {
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
                        }
                        .padding(.vertical, 4)
                    }
                    .tint(Theme.sky500)
                    Picker("Conservar al finalizar", selection: $store.retainHours) {
                        Text("6 h").tag(6.0)
                        Text("12 h").tag(12.0)
                        Text("24 h").tag(24.0)
                        Text("48 h").tag(48.0)
                        Text("72 h").tag(72.0)
                        Text("1 semana").tag(168.0)
                    }
                    if !store.isSharing {
                        DatePicker("Hora de salida prevista", selection: $store.startAt, displayedComponents: [.date, .hourAndMinute])
                            .onChange(of: store.startAt) { _ in store.startAtTouched = true }
                        Text("Por defecto, ahora. Si activas el seguimiento más tarde, ajústala a la hora real de salida para mantener ritmos y previsiones correctos.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                } header: {
                    Text("Modo de seguimiento").foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                Section {
                    lowPowerTip
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

    /// Status header: state (armed / live / stopped), selected route, battery.
    @ViewBuilder
    private var statusContent: some View {
        if store.isStandby {
            VStack(alignment: .leading, spacing: 2) {
                Label("Armado · ahorrando batería", systemImage: "moon.zzz.fill")
                    .foregroundStyle(.yellow)
                Text("Empieza solo hacia las \(store.startAt.formatted(date: .omitted, time: .shortened)). Deja la app abierta en segundo plano (no la cierres).")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
        } else if store.isSharing {
            Label("Compartiendo en directo", systemImage: "dot.radiowaves.left.and.right")
                .foregroundStyle(.green)
        } else {
            Label("Detenido", systemImage: "pause.circle")
                .foregroundStyle(Theme.slate400)
        }
        if store.isSharing {
            if let plan = store.plans.first(where: { $0.id == store.selectedPlanId }) {
                Label(plan.name, systemImage: "map.fill")
                    .font(.subheadline)
            } else {
                Label("Sin ruta · trazado en vivo", systemImage: "scribble.variable")
                    .font(.subheadline)
                    .foregroundStyle(Theme.slate400)
            }
        }
        if store.isSharing, store.batteryLevel >= 0 {
            batteryRow
        }
    }

    /// Race tip: enabling iOS Low Power Mode extends autonomy and does NOT break
    /// GPS or uploads. Reflects whether it's currently on.
    @ViewBuilder
    private var lowPowerTip: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: store.lowPowerMode ? "checkmark.circle.fill" : "lightbulb.fill")
                .foregroundStyle(store.lowPowerMode ? .green : .yellow)
            VStack(alignment: .leading, spacing: 2) {
                if store.lowPowerMode {
                    Text("Modo de Bajo Consumo activo")
                        .fontWeight(.semibold).foregroundStyle(.green)
                    Text("Perfecto: alarga la batería y no afecta al GPS ni al envío de tu ubicación.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                } else {
                    Text("Consejo para ultras")
                        .fontWeight(.semibold)
                    Text("Activa el Modo de Bajo Consumo (Ajustes › Batería). Alarga mucho la autonomía y NO afecta al GPS ni al envío de tu posición.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
            }
        }
    }

    /// Live battery readout with the MEASURED drain and estimated autonomy.
    @ViewBuilder
    private var batteryRow: some View {
        let pct = Int((store.batteryLevel * 100).rounded())
        HStack(spacing: 8) {
            Image(systemName: store.isCharging ? "battery.100.bolt" : batteryIcon(store.batteryLevel))
                .foregroundStyle(store.isCharging ? .green : batteryTint(store.batteryLevel))
            if store.isCharging {
                Text("Cargando · \(pct)%").foregroundStyle(.green)
            } else if let drain = store.batteryDrainPerHour {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(pct)% · gasto real ~\(String(format: "%.1f", drain))%/h")
                        .fontWeight(.semibold)
                    if let h = store.estimatedHoursRemaining {
                        Text("Autonomía estimada ~\(autonomyLabel(h))")
                            .font(.caption).foregroundStyle(autonomyTint(h))
                    }
                }
            } else {
                Text("\(pct)% · calculando consumo…")
                    .foregroundStyle(Theme.slate400)
            }
        }
    }

    private func batteryIcon(_ level: Double) -> String {
        switch level {
        case ..<0.1: return "battery.0"
        case ..<0.4: return "battery.25"
        case ..<0.7: return "battery.50"
        case ..<0.95: return "battery.75"
        default: return "battery.100"
        }
    }

    private func batteryTint(_ level: Double) -> Color {
        level < 0.15 ? .red : (level < 0.30 ? .orange : .green)
    }

    /// "~18 h" or "~5 h 30 min" for shorter estimates.
    private func autonomyLabel(_ hours: Double) -> String {
        if hours >= 10 { return "\(Int(hours.rounded())) h" }
        let h = Int(hours)
        let m = Int((hours - Double(h)) * 60)
        return m > 0 ? "\(h) h \(m) min" : "\(h) h"
    }

    private func autonomyTint(_ hours: Double) -> Color {
        hours < 3 ? .red : (hours < 6 ? .orange : Theme.slate400)
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

    @ViewBuilder
    private func profileRow(_ p: SendProfile, title: String, detail: String, autonomy: String, color: Color, recommended: Bool = false) -> some View {
        Button {
            store.selectProfile(p)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: store.profile == p ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(store.profile == p ? Theme.sky500 : Theme.slate400)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title).foregroundStyle(Theme.slate100)
                        if recommended {
                            Text("Recomendado")
                                .font(.caption2).fontWeight(.semibold)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.sky600.opacity(0.25))
                                .foregroundStyle(Theme.sky500)
                                .clipShape(Capsule())
                        }
                    }
                    Text(detail).font(.caption).foregroundStyle(Theme.slate400)
                    Text(autonomy).font(.caption2).foregroundStyle(color)
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}
