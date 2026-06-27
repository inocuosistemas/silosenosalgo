import SwiftUI
import CoreLocation

struct TrackingView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var store: TrackingStore
    @State private var title = ""

    init(token: String) {
        _store = StateObject(wrappedValue: TrackingStore(token: token))
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
                    Picker("Intervalo de envío", selection: $store.intervalSeconds) {
                        Text("5 s").tag(5.0)
                        Text("10 s").tag(10.0)
                        Text("15 s").tag(15.0)
                        Text("30 s").tag(30.0)
                        Text("1 min").tag(60.0)
                        Text("2 min").tag(120.0)
                        Text("3 min").tag(180.0)
                        Text("5 min").tag(300.0)
                        Text("10 min").tag(600.0)
                    }
                    Text(store.intervalSeconds >= 180
                        ? "Ahorro de batería: GPS menos preciso. Ideal para ultras."
                        : "Más frecuente = más preciso, pero más batería.")
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                } header: {
                    Text("Ajustes").foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

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
                }
                .listRowBackground(Color.clear)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .tint(Theme.sky500)
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
}
