import SwiftUI
import CoreLocation

/// Sheet to capture a field note at the current position. The user picks a POI
/// type and (optionally) writes a body; TrackingStore stamps it with the live fix
/// (coords, altitude, accuracy, distance). Uploaded when coverage allows.
struct AddNoteView: View {
    @ObservedObject private var store = TrackingStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var type = PoiTypes.defaultSlug
    @FocusState private var bodyFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("Tipo de punto") {
                    Picker("Tipo", selection: $type) {
                        ForEach(PoiTypes.all) { t in
                            Text("\(t.emoji)  \(t.label)").tag(t.slug)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                Section("Nota") {
                    TextField("Escribe una nota (opcional)…", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($bodyFocused)
                }

                Section {
                    contextRow
                } footer: {
                    Text("Se ancla a tu posición actual y se sube al recuperar cobertura. En el GPX de la guía será un POI.")
                }
            }
            .navigationTitle("Añadir nota")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        store.addNote(text: text.trimmingCharacters(in: .whitespacesAndNewlines), type: type)
                        dismiss()
                    }
                    .disabled(!canSave)
                }
            }
        }
    }

    /// Save needs a position, and either a specific type or some text (a generic
    /// note with no text carries nothing).
    private var canSave: Bool {
        store.lastLocation != nil
            && (type != PoiTypes.defaultSlug || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    @ViewBuilder private var contextRow: some View {
        if let loc = store.lastLocation {
            HStack {
                Label(timeString, systemImage: "clock")
                Spacer()
                if loc.horizontalAccuracy >= 0 {
                    Text("± \(Int(loc.horizontalAccuracy)) m").foregroundStyle(.secondary)
                }
            }
            .font(.footnote)
            if loc.verticalAccuracy >= 0 {
                Label("\(Int(loc.altitude)) m", systemImage: "mountain.2")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            Label("Esperando posición GPS…", systemImage: "location.slash")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var timeString: String {
        let f = DateFormatter()
        f.timeStyle = .short
        return f.string(from: Date())
    }
}
