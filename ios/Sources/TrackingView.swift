import SwiftUI
import CoreLocation
import UIKit

struct TrackingView: View {
    @EnvironmentObject var auth: AuthStore
    @ObservedObject private var store = TrackingStore.shared
    @ObservedObject private var guideLibrary = GuideLibrary.shared
    @State private var title = ""
    @State private var pendingDelete: TrackSessionSummary?
    @State private var pendingRename: TrackSessionSummary?
    /// The expired-and-nothing-kept sessions queued for the bulk "Limpiar".
    @State private var pendingCleanup: [TrackSessionSummary]?
    /// Present the in-app viewer OFFLINE for a finished session whose trail is
    /// still on this device (its notes and photos included; no coverage needed).
    @State private var reviewSession: TrackSessionSummary?
    @State private var renameText = ""
    /// Present the in-app "live" viewer for the current (offline) session.
    @State private var showLiveMap = false
    /// Present the in-app viewer online for a finished session in the list.
    @State private var mapSession: TrackSessionSummary?
    /// Offline-map download reachable BEFORE sharing (prepare the map the night
    /// before), driven by the selected plan.
    @State private var showMapDownload = false
    @State private var downloadPolyline: [(lat: Double, lon: Double)]?
    @State private var downloadRouteName: String?
    @State private var resolvingRoute = false
    @State private var pendingLogout = false
    @State private var showGuideImporter = false
    @State private var selectedGuide: LocalGuide?
    @State private var guideShareItem: GuideShareItem?
    @State private var guideError: String?
    @State private var guideWorking = false
    /// Plegado de las dos secciones de decisiones. Las dos nacen cerradas: su
    /// resumen ya dice lo que hay puesto, que es lo que se viene a mirar, y
    /// abrir cuesta un toque.
    @State private var outingOpen = false
    @State private var recordingOpen = false

    private let intervalSteps: [Double] = [5, 10, 15, 30, 60, 120, 180, 300, 600]
    private let distanceSteps: [Double] = [25, 50, 100, 250, 500]

    /// Maps the linear slider position (0…n) to/from the chosen interval.
    private var modeBinding: Binding<SendMode> {
        Binding(get: { store.sendMode }, set: { store.sendMode = $0; store.profile = .custom })
    }

    /// Activity selection (nil = Automático). Routes through `setActivity` so a
    /// change made while sharing also updates the server and the embedded viewer.
    private var activityBinding: Binding<BeaconActivity?> {
        Binding(get: { store.activity }, set: { store.setActivity($0) })
    }

    /// Elegir evento: antes de salir es local, en marcha lo negocia con el
    /// servidor (ver TrackingStore.setEvent).
    private var eventBinding: Binding<String?> {
        Binding(get: { store.selectedEventId }, set: { store.setEvent($0) })
    }

    /// Lo que se lee sin desplegar "Qué salida es esta".
    ///
    /// Es la razón de ser de una sección plegada: si el resumen no dice lo que
    /// hay elegido, plegarla solo esconde información. Se nombran el evento, el
    /// recorrido y la hora, en ese orden, porque es el orden en que se decide.
    private var outingSummary: String {
        var parts: [String] = []
        if let ev = store.events.first(where: { $0.id == store.selectedEventId }) {
            parts.append("🏁 \(ev.name)")
        }
        if let plan = store.plans.first(where: { $0.id == store.selectedPlanId }) {
            parts.append(plan.name)
        } else if store.selectedEventId != nil {
            parts.append("Recorrido del evento")
        } else {
            parts.append("Sin ruta · trazado en vivo")
        }
        if store.startAtTouched {
            parts.append(store.startAt.formatted(date: .abbreviated, time: .shortened))
        }
        return parts.joined(separator: " · ")
    }

    /// Lo que se lee sin desplegar "Cómo se registra".
    private var recordingSummary: String {
        let activity = store.effectiveActivity.map {
            "\($0.emoji) \($0.label)" + (store.activity == nil ? " · auto" : "")
        } ?? "🤖 Automático"
        let pace: String
        switch store.profile {
        case .balanced: pace = "Equilibrado"
        case .saver: pace = "Ahorro"
        case .precision: pace = "Alta precisión"
        case .custom:
            pace = store.sendMode == .distance
                ? "Cada \(distanceLabel(store.distanceMeters))"
                : "Cada \(intervalLabel(store.intervalSeconds))"
        }
        let keep = store.retainHours >= 168 ? "1 semana" : "\(Int(store.retainHours)) h"
        return "\(activity) · \(pace) · \(keep)"
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

                if store.isSharing {
                    Section {
                        Button { showLiveMap = true } label: {
                            Label("Ver mi ruta en el mapa (offline)", systemImage: "map.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .foregroundStyle(Theme.sky500)
                    } footer: {
                        Text(store.noteCount > 0
                             ? "\(store.noteCount) \(store.noteCount == 1 ? "nota anclada" : "notas ancladas") en esta ruta. Se exportan como POIs en el GPX de la guía."
                             : "Marca puntos (agua, cruce, peligro…) anclados a tu posición. Se exportan como POIs en el GPX. Tu previsión y mapa funcionan sin cobertura.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                // Las decisiones, agrupadas por NATURALEZA y plegadas: cada
                // sección enseña lo elegido y se abre para cambiarlo. Antes
                // estaban todas desplegadas —actividad, evento, perfil, mandos,
                // retención, hora, ruta— y eso es un muro de mandos donde cuesta
                // encontrar el que se busca y, peor, cuesta ver de un vistazo QUÉ
                // está puesto.
                //
                // Son dos preguntas distintas y por eso son dos secciones: "qué
                // salida es esta" y "cómo se registra".
                Section {
                    DisclosureGroup(isExpanded: $outingOpen) {
                        if !store.events.isEmpty {
                            Picker("Evento", selection: eventBinding) {
                                Text("Ninguno · salida suelta").tag(String?.none)
                                ForEach(store.events) { ev in
                                    Text(ev.name).tag(Optional(ev.id))
                                }
                            }
                        }
                        if !store.isSharing {
                            // Con evento elegido, la ruta cambia de significado: lo
                            // que se elige ya no es "por dónde voy" —eso lo pone la
                            // carrera— sino CON QUÉ RITMOS. Por eso las previsiones
                            // hechas sobre ese recorrido van primero y aparte: son
                            // las únicas que cuadran con el evento.
                            Picker(store.selectedEventId == nil ? "Ruta (previsión)" : "Mi previsión", selection: $store.selectedPlanId) {
                                Text(store.selectedEventId == nil
                                     ? "Sin ruta · trazado en vivo"
                                     : "La del evento").tag(String?.none)
                                if store.selectedEventId != nil {
                                    Section("De este evento") {
                                        ForEach(store.plansOfEvent) { plan in
                                            Text(plan.name).tag(Optional(plan.id))
                                        }
                                    }
                                    Section("Otras previsiones") {
                                        ForEach(store.plansNotOfEvent) { plan in
                                            Text(plan.name).tag(Optional(plan.id))
                                        }
                                    }
                                } else {
                                    ForEach(store.plans) { plan in
                                        Text(plan.name).tag(Optional(plan.id))
                                    }
                                }
                            }
                            // Elegir una previsión ajena al evento no rompe nada
                            // —la tuya siempre manda— pero deja el visor calculando
                            // contra un recorrido que no estás corriendo, y eso no
                            // puede pasar en silencio.
                            if store.planMismatchesEvent {
                                Label("Esta previsión no es del recorrido del evento: tus ritmos y cortes se calcularán sobre otra ruta.",
                                      systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            if store.selectedPlanId != nil || store.selectedEventId != nil {
                                Button {
                                    openMapDownloadForSelectedPlan()
                                } label: {
                                    HStack {
                                        Label("Descargar mapa offline", systemImage: "arrow.down.circle")
                                        if resolvingRoute { Spacer(); ProgressView().tint(Theme.sky500) }
                                    }
                                }
                                .foregroundStyle(Theme.sky500)
                                .disabled(resolvingRoute)
                            }
                            TextField("Nombre (opcional)", text: $title)
                            DatePicker("Hora de salida prevista", selection: $store.startAt, displayedComponents: [.date, .hourAndMinute])
                                .onChange(of: store.startAt) { _ in store.startAtTouched = true }
                        }
                    } label: {
                        Text(outingSummary)
                            .font(.subheadline)
                            .foregroundStyle(Theme.slate100)
                            .lineLimit(2)
                    }
                    .tint(Theme.sky500)
                } header: {
                    Text("Qué salida es esta").foregroundStyle(Theme.slate400)
                } footer: {
                    if outingOpen {
                        Text(store.selectedEventId != nil
                             ? "Apareces en el mapa del evento con tu color. Sin previsión propia corres con el recorrido y los cortes de la carrera."
                             : "La hora de salida es la referencia de tus ritmos y previsiones; por defecto, el momento de empezar.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                // La actividad y el ritmo se ajustan TAMBIÉN en marcha: el perfil
                // que se elige antes de salir es una apuesta, y a mitad de ruta es
                // cuando de verdad se sabe si sobra precisión o falta batería.
                Section {
                    DisclosureGroup(isExpanded: $recordingOpen) {
                        Picker("Actividad", selection: activityBinding) {
                            Label("Automático", systemImage: "wand.and.stars").tag(BeaconActivity?.none)
                            ForEach(BeaconActivity.allCases) { a in
                                Text("\(a.emoji)  \(a.label)").tag(Optional(a))
                            }
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
                    } label: {
                        Text(recordingSummary)
                            .font(.subheadline)
                            .foregroundStyle(Theme.slate100)
                            .lineLimit(2)
                    }
                    .tint(Theme.sky500)
                } header: {
                    Text("Cómo se registra").foregroundStyle(Theme.slate400)
                } footer: {
                    if recordingOpen {
                        Text("El gasto lo manda el GPS, no la frecuencia de envío: ahorrar es pedirle menos al GPS, y parado no gasta.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Theme.slate900)

                Section {
                    lowPowerTip
                }
                .listRowBackground(Theme.slate900)

                if !store.isSharing {
                    Section {
                        Button { showGuideImporter = true } label: {
                            Label("Importar .slsnsguide", systemImage: "square.and.arrow.down")
                        }
                        .disabled(guideWorking)

                        ForEach(guideLibrary.guides) { guide in
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(guide.title)
                                        .foregroundStyle(Theme.slate100)
                                        .lineLimit(1)
                                    Text("\(guide.noteCount) notas · \(guide.mediaCount) archivos · \(startedLabel(guide.startedAt))")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.slate400)
                                }
                                Spacer()
                                Button { openGuide(guide) } label: {
                                    Image(systemName: "map")
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Abrir guía offline")
                                Menu {
                                    Button(role: .destructive) { guideLibrary.delete(guide) } label: {
                                        Label("Eliminar guía", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Más opciones de la guía")
                            }
                        }
                    } header: {
                        Text("Guías offline").foregroundStyle(Theme.slate400)
                    } footer: {
                        Text("Incluyen ruta, recorrido real, notas, fotos y audios. No incluyen teselas de mapa.")
                            .font(.caption).foregroundStyle(Theme.slate400)
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
                            // Las que ya no sirven para nada: el servidor borró su
                            // ruta y en el móvil no queda traza. Borrarlas de una
                            // en una por una lista larga es un trabajo tonto.
                            let unusable = store.sessions.filter {
                                !store.isActive($0) && store.isPurged($0) && !LocalStore.hasTrail($0.id)
                            }
                            if !unusable.isEmpty {
                                HStack {
                                    Text("\(unusable.count) caducadas sin nada guardado")
                                        .font(.caption)
                                        .foregroundStyle(Theme.slate400)
                                    Spacer()
                                    Button("Limpiar") { pendingCleanup = unusable }
                                        .buttonStyle(.borderless)
                                        .font(.caption)
                                        .foregroundStyle(Theme.sky500)
                                }
                            }
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
                        if let viewers = store.activeViewers {
                            LabeledContent("Seguidores activos") {
                                Label("\(viewers)", systemImage: "eye.fill")
                                    .foregroundStyle(viewers > 0 ? .green : Theme.slate400)
                            }
                        }
                        LabeledContent("Posiciones enviadas", value: "\(store.pingCount)")
                        if let last = store.lastSentAt {
                            // Show the clock time AND how long ago it was, colour-coded
                            // by freshness so a glance tells whether followers are
                            // getting live updates (green) or falling behind (red).
                            let elapsed = Date().timeIntervalSince(last)
                            LabeledContent("Último envío") {
                                Text("\(last.formatted(date: .omitted, time: .shortened)) · hace \(gapTimeLabel(elapsed))")
                                    .foregroundStyle(sendFreshnessTint(elapsed))
                            }
                        }
                        if let loc = store.lastLocation, loc.horizontalAccuracy >= 0 {
                            LabeledContent("Precisión GPS", value: String(format: "± %.0f m", loc.horizontalAccuracy))
                        }
                        if store.pendingCount > 0 {
                            LabeledContent("En cola (sin cobertura)", value: "\(store.pendingCount)")
                                .foregroundStyle(.orange)
                        }
                        if store.heldReadings > 0 {
                            // Lecturas que no superaron el ruido del GPS y se
                            // registraron manteniendo la posición (como Android):
                            // si andando salen muchas, el umbral está alto.
                            LabeledContent("Lecturas descartadas", value: "\(store.heldReadings)")
                        }
                        if let gap = store.followerGapMeters {
                            let stale = store.lastSentAt.map { Date().timeIntervalSince($0) } ?? 0
                            let behind = store.pendingCount > 0 || gap > 150
                            LabeledContent("Seguidores te ven a", value: "\(distanceLabel(gap)) · hace \(gapTimeLabel(stale))")
                                .foregroundStyle(behind ? .orange : Theme.slate400)
                        }
                    } header: {
                        Text("Estado").foregroundStyle(Theme.slate400)
                    } footer: {
                        if let gap = store.followerGapMeters, store.pendingCount > 0 || gap > 150 {
                            Text("Sin cobertura: tu posición real va por delante de la que ven tus seguidores. Se pondrá al día al recuperar señal.")
                                .font(.caption).foregroundStyle(Theme.slate400)
                        }
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
                        Text("Al iniciar uno nuevo, el seguimiento anterior se conserva 48 h para poder consultarlo (o para siempre si lo fijas con la chincheta).")
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
            .alert("¿Limpiar seguimientos?", isPresented: Binding(
                get: { pendingCleanup != nil },
                set: { if !$0 { pendingCleanup = nil } }
            ), presenting: pendingCleanup) { sessions in
                Button("Limpiar", role: .destructive) {
                    let ids = sessions.map(\.id)
                    pendingCleanup = nil
                    Task { await store.deleteSessions(ids) }
                }
                Button("Cancelar", role: .cancel) { pendingCleanup = nil }
            } message: { sessions in
                Text("Son \(sessions.count): las que ya han caducado y de las que no queda nada en este móvil. No se puede ver su mapa ni exportarlas, y su enlace ya no funciona. Solo se quita la entrada de la lista.")
            }
            .alert("Renombrar seguimiento", isPresented: Binding(
                get: { pendingRename != nil },
                set: { if !$0 { pendingRename = nil } }
            ), presenting: pendingRename) { session in
                TextField("Nombre", text: $renameText)
                Button("Guardar") {
                    let id = session.id
                    let name = renameText.trimmingCharacters(in: .whitespaces)
                    pendingRename = nil
                    Task { await store.rename(id, name.isEmpty ? nil : name) }
                }
                Button("Cancelar", role: .cancel) { pendingRename = nil }
            } message: { _ in
                Text("Ponle un nombre para identificar este seguimiento más tarde.")
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .tint(Theme.sky500)
            .task {
                store.configure(token: auth.token ?? "")
                store.viewerUsername = auth.user?.username
                store.restoreActiveSession() // resume the last active beacon if not explicitly stopped
                // Cheer alerts need permission; asked here, on opening the
                // portal (like Android's POST_NOTIFICATIONS), not mid-route.
                CheerNotifier.shared.requestAuthorization()
                await store.loadPlans()
                await store.loadEvents()
                await store.loadSessions()
            }
            .refreshable {
                // Pull down to pick up changes made elsewhere (e.g. a route just
                // created on the web, o un evento al que te acaban de invitar)
                // without leaving the screen.
                await store.loadPlans()
                await store.loadEvents()
                await store.loadSessions()
            }
            .fullScreenCover(isPresented: $showLiveMap) {
                if let t = store.sessionToken {
                    LiveMapView(source: .offline(token: t), offlineToken: t)
                }
            }
            .fullScreenCover(item: $mapSession) { session in
                if let url = URL(string: store.shareLink(for: session.id)) {
                    LiveMapView(source: .online(url: url), offlineToken: nil)
                }
            }
            .fullScreenCover(item: $reviewSession) { session in
                // A finished session with its trail still on this device: served
                // locally like a guide, read-only (it's already over).
                LiveMapView(
                    source: .offline(token: session.id), offlineToken: session.id,
                    allowsEditing: false, title: session.title ?? "Seguimiento"
                )
            }
            .fullScreenCover(item: $selectedGuide) { guide in
                LiveMapView(
                    source: .offline(token: guide.id), offlineToken: guide.id,
                    allowsEditing: false, title: "Guía offline"
                )
            }
            .sheet(isPresented: $showMapDownload) {
                MapDownloadView(routeName: downloadRouteName, polyline: downloadPolyline)
            }
            .sheet(item: $guideShareItem) { item in
                GuideShareSheet(url: item.url)
            }
            .fileImporter(isPresented: $showGuideImporter, allowedContentTypes: [.slsnsGuide]) { result in
                guard case .success(let url) = result else {
                    if case .failure(let error) = result { guideError = error.localizedDescription }
                    return
                }
                guideWorking = true
                Task {
                    do {
                        let guide = try await guideLibrary.importGuide(from: url)
                        try guideLibrary.prepareForViewing(guide)
                        selectedGuide = guide
                    } catch {
                        guideError = error.localizedDescription
                    }
                    guideWorking = false
                }
            }
            .alert("Guías offline", isPresented: Binding(
                get: { guideError != nil },
                set: { if !$0 { guideError = nil } }
            )) {
                Button("Aceptar", role: .cancel) { guideError = nil }
            } message: {
                Text(guideError ?? "")
            }
            .alert("Salir de la cuenta", isPresented: $pendingLogout) {
                Button(store.isSharing ? "Detener y salir" : "Salir", role: .destructive) {
                    Task {
                        await store.stopSharing()
                        await auth.logout()
                    }
                }
                Button("Cancelar", role: .cancel) { }
            } message: {
                Text(store.isSharing
                     ? "Estás compartiendo tu ubicación. Al salir se detiene el seguimiento y se cierra la sesión."
                     : "Se cerrará tu sesión en este dispositivo.")
            }
            .navigationTitle(auth.user?.username ?? "Seguimiento")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Salir") { pendingLogout = true }
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
            if let name = store.activePlanName, !name.isEmpty {
                Label(name, systemImage: "map.fill")
                    .font(.subheadline)
            } else {
                Label("Sin ruta · trazado en vivo", systemImage: "scribble.variable")
                    .font(.subheadline)
                    .foregroundStyle(Theme.slate400)
            }
        }
        // En qué carrera se está emitiendo: al abrir la app a mitad de ruta,
        // saber que la baliza cuenta para el evento es tan importante como
        // saber que sigue transmitiendo.
        if store.isSharing, let ev = store.activeEvent {
            Label(ev.name, systemImage: "flag.checkered")
                .font(.subheadline)
                .foregroundStyle(Theme.sky500)
        }
        if store.isSharing, let act = store.effectiveActivity {
            HStack(spacing: 6) {
                Text(act.emoji)
                Text(store.activity == nil ? "\(act.label) · auto" : act.label)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.slate100)
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
        // Purged = route already gone server-side (unpinned + past retention). Its
        // public link is dead, so we flag it "Caducado" and drop link-sharing.
        let purged = !active && store.isPurged(session)
        // Whether its trail is still on this device — what decides that an
        // expired session can still show its map offline and be exported.
        let hasLocal = LocalStore.hasTrail(session.id)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    if session.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption2)
                            .foregroundStyle(Theme.sky500)
                    }
                    Text(session.title ?? "Sin nombre")
                        .foregroundStyle(Theme.slate100)
                        .lineLimit(1)
                    if let act = session.activity {
                        // Movement type this session had (declared, or inferred at the
                        // moment it last stopped). Compact chip so it reads at a glance.
                        Text("\(act.emoji) \(act.label)")
                            .font(.caption2)
                            .foregroundStyle(Theme.slate400)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Theme.slate800.opacity(0.7))
                            .clipShape(Capsule())
                    }
                }
                HStack(spacing: 8) {
                    Text(active ? "Activo" : (purged ? "Caducado" : "Finalizado"))
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background((active ? Color.green : (purged ? Color.orange : Theme.slate700)).opacity(0.25))
                        .foregroundStyle(active ? .green : (purged ? .orange : Theme.slate400))
                        .clipShape(Capsule())
                    if hasLocal {
                        // Lo que decide si una sesión caducada sirve para algo:
                        // con traza en el móvil su mapa se sigue viendo offline.
                        Text("En el móvil")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Theme.sky600.opacity(0.25))
                            .foregroundStyle(Theme.sky500)
                            .clipShape(Capsule())
                    }
                    Text("Salida \(startedLabel(session.startedAt))")
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                }
                if purged {
                    Text("Ruta ya no disponible")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                } else if let activity = activityLabel(session, active: active) {
                    Text(activity)
                        .font(.caption2)
                        .foregroundStyle(Theme.slate400)
                }
                // Retention countdown: how long a finished session stays viewable
                // before its route is purged. Pinned ones are kept indefinitely
                // (the chincheta says so); active ones keep extending, so neither
                // shows a countdown.
                if !active && !purged {
                    if session.isPinned {
                        Text("Sin caducidad (fijado)")
                            .font(.caption2)
                            .foregroundStyle(Theme.slate400)
                    } else if let exp = expiryRemainingLabel(session.expiresAt) {
                        Text("Caduca \(exp)")
                            .font(.caption2)
                            .foregroundStyle(expiryTint(session.expiresAt))
                    }
                }
            }
            Spacer(minLength: 8)
            if active {
                Button("Continuar") { store.continueSession(session.id) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.sky500)
            } else if !purged {
                // Reanudar keeps the original started_at, so it only makes sense for
                // a recently-ended session with data intact ("stop & re-share").
                // A purged one would resume with a stale start and no route — start
                // a new session instead — so it offers no primary action.
                Button("Reanudar") { store.resumeSession(session.id) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.sky500)
            }
            // A purged session can't be preserved (its data is already gone), so
            // the chincheta is meaningless — hide it.
            if !purged {
                Button {
                    Task { await store.setPinned(session.id, !session.isPinned) }
                } label: {
                    Image(systemName: session.isPinned ? "pin.fill" : "pin")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(session.isPinned ? Theme.sky500 : Theme.slate400)
                .accessibilityLabel(session.isPinned ? "Quitar chincheta" : "Fijar con chincheta")
            }
            sessionMenu(session, purged: purged, hasLocal: hasLocal)
        }
    }

    /// Secondary actions for a session: rename it so it's identifiable later, and
    /// recover its follower link to consult the route (no need to reanudar), plus
    /// delete. Consolidated in a "⋯" menu to keep the row uncluttered. A purged
    /// session's link is dead, so link-sharing is dropped for it.
    @ViewBuilder
    private func sessionMenu(_ session: TrackSessionSummary, purged: Bool, hasLocal: Bool) -> some View {
        let link = store.shareLink(for: session.id)
        Menu {
            Button {
                renameText = session.title ?? ""
                pendingRename = session
            } label: {
                Label("Renombrar", systemImage: "pencil")
            }
            // Ver su mapa: con la traza en el móvil se abre el visor incrustado
            // sin cobertura (con sus notas y fotos); si no, queda el enlace
            // público, que solo existe mientras la ruta no haya caducado.
            if hasLocal || !purged {
                Button { openSessionMap(session, hasLocal: hasLocal, purged: purged) } label: {
                    Label("Ver mapa", systemImage: "map")
                }
            }
            if !purged {
                Button {
                    UIPasteboard.general.string = link
                } label: {
                    Label("Copiar enlace", systemImage: "link")
                }
                ShareLink(item: link) {
                    Label("Compartir enlace", systemImage: "square.and.arrow.up")
                }
            }
            Button { exportGuide(session) } label: {
                Label("Exportar guía offline", systemImage: "archivebox")
            }
            Divider()
            Button(role: .destructive) {
                pendingDelete = session
            } label: {
                Label("Eliminar", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Theme.slate400)
        .accessibilityLabel("Más opciones")
    }

    /// "Ver mapa" for a finished session: offline (from the local trail) when
    /// this device still keeps it, else the public link in the online viewer.
    private func openSessionMap(_ session: TrackSessionSummary, hasLocal: Bool, purged: Bool) {
        if hasLocal {
            do {
                try store.prepareOfflineReview(session)
                reviewSession = session
                return
            } catch {
                // A corrupt local trail shouldn't dead-end the action: fall back
                // to the online viewer while the route still exists server-side.
                if purged { guideError = "No se pudo leer la traza guardada en este móvil."; return }
            }
        }
        mapSession = session
    }

    private func exportGuide(_ session: TrackSessionSummary) {
        guideWorking = true
        Task {
            do {
                let url = try await guideLibrary.export(session: session)
                guideShareItem = GuideShareItem(url: url)
            } catch {
                guideError = error.localizedDescription
            }
            guideWorking = false
        }
    }

    private func openGuide(_ guide: LocalGuide) {
        do {
            try guideLibrary.prepareForViewing(guide)
            selectedGuide = guide
        } catch {
            guideError = error.localizedDescription
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

    /// Distinguishing per-session activity: when it was last seen / when it ended.
    /// This is what separates two sessions that share the same planned departure.
    private func activityLabel(_ s: TrackSessionSummary, active: Bool) -> String? {
        if active {
            if let u = s.updatedAt { return "visto \(startedLabel(u))" }
            return nil
        }
        if let e = s.endedAt { return "finalizada \(startedLabel(e))" }
        if let u = s.updatedAt { return "última pos. \(startedLabel(u))" }
        return nil
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

    /// Compact elapsed label for the follower-gap staleness ("hace 8 min").
    private func gapTimeLabel(_ s: TimeInterval) -> String {
        if s < 60 { return "\(Int(s)) s" }
        if s < 3600 { return "\(Int(s / 60)) min" }
        let h = Int(s / 3600); let m = Int((s - Double(h) * 3600) / 60)
        return m > 0 ? "\(h) h \(m) min" : "\(h) h"
    }

    /// Time left before a finished, unpinned session's route is purged
    /// ("en 25 min", "en 8 h", "en 2 d"). nil once already past — the row then
    /// shows "Caducado" instead. `expiresAtMs` is epoch MILLISECONDS.
    private func expiryRemainingLabel(_ expiresAtMs: Double) -> String? {
        let remaining = expiresAtMs / 1000 - Date().timeIntervalSince1970
        if remaining <= 0 { return nil }
        if remaining < 3600 { return "en \(max(1, Int(remaining / 60))) min" }
        if remaining < 24 * 3600 { return "en \(Int(remaining / 3600)) h" }
        return "en \(Int(remaining / (24 * 3600))) d"
    }

    /// Amber when the retention window is nearly up, so it reads as a warning.
    private func expiryTint(_ expiresAtMs: Double) -> Color {
        let remaining = expiresAtMs / 1000 - Date().timeIntervalSince1970
        return remaining < 6 * 3600 ? .orange : Theme.slate400
    }

    /// Colour for the "last upload" freshness: green while followers are getting
    /// live updates, amber as it lags, red once clearly behind (e.g. no coverage).
    private func sendFreshnessTint(_ elapsed: TimeInterval) -> Color {
        if elapsed < 120 { return .green }
        if elapsed < 360 { return .orange }
        return .red
    }

    /// Resolve the selected plan's route (fetches + decodes its geometry) and open
    /// the offline-map screen — usable before sharing, to prepare the map ahead.
    private func openMapDownloadForSelectedPlan() {
        guard let id = store.selectedPlanId else { return }
        resolvingRoute = true
        downloadRouteName = store.plans.first(where: { $0.id == id })?.name
        Task {
            downloadPolyline = await store.planPolyline(for: id)
            resolvingRoute = false
            showMapDownload = true
        }
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
